import * as fs from "fs";
import chalk from "chalk";
import Table from "cli-table3";
import { Tail } from "tail";
import logUpdate from "log-update";
import { BepEvent } from "./types";
import { StaticBepAnalyzer } from "./analyzer";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function renderProgressBar(percent: number, width: number = 20): string {
  const clampedPercent = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clampedPercent / 100) * width);
  const empty = width - filled;
  return chalk.green("█".repeat(filled)) + chalk.gray("░".repeat(empty));
}

function stripAnsi(str: string): string {
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]|\r/g,
    "",
  );
}

interface ProgressInfo {
  completed: number;
  total: number;
  runningActions: { name: string; duration: string }[];
  logs: string[];
  currentLabel?: string;
}

function parseProgress(text: string): ProgressInfo {
  const blocks = text.split(/\r\u001b\[1A\u001b\[K/);
  const lastBlock = blocks[blocks.length - 1];

  const lines = lastBlock.split("\n");
  let completed = 0;
  let total = 0;
  let currentLabel: string | undefined;
  const runningActions: { name: string; duration: string }[] = [];
  const logs: string[] = [];

  for (const line of lines) {
    const strippedLine = stripAnsi(line).trim();
    if (!strippedLine) continue;

    const progressMatch = strippedLine.match(/^\[([\d,]+)\s*\/\s*([\d,]+)\]/);
    if (progressMatch) {
      completed = parseInt(progressMatch[1].replace(/,/g, ""), 10);
      total = parseInt(progressMatch[2].replace(/,/g, ""), 10);
      const labelMatch = strippedLine.match(
        /\]\s+(?:Building|Compiling|Executing|Linking|Testing|Action)\s+(.+)/,
      );
      if (labelMatch) {
        currentLabel = labelMatch[1].split(";")[0].trim();
      }
      continue;
    }

    const actionMatch = strippedLine.match(/^(\s*\w+\s+.+?);\s+(\d+s)/i);
    if (actionMatch) {
      runningActions.push({
        name: actionMatch[1].trim(),
        duration: actionMatch[2],
      });
      continue;
    }

    if (
      strippedLine.toLowerCase().includes("warning:") ||
      strippedLine.toLowerCase().includes("error:")
    ) {
      logs.push(line);
    }
  }

  runningActions.sort(
    (a, b) => parseInt(b.duration, 10) - parseInt(a.duration, 10),
  );

  return { completed, total, runningActions, logs, currentLabel };
}

export type LiveDisplayMode = "dashboard" | "vscode-log" | "vscode-status";

export class LiveBepAnalyzer extends StaticBepAnalyzer {
  private progressText: string = "Initializing...";
  private runningTime: string = "0.00s";
  private isFinished: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly spinner = ["⠋", "⠙", "⠹", "⸸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private spinnerIndex = 0;
  private recentLogs: string[] = [];
  private dashboardStartTime: number = 0;
  private lastProgressTotal: number = 0;
  private lastProgressCompleted: number = 0;
  private lastCurrentLabel: string | undefined;

  constructor(
    actionDetails: "none" | "failed" | "all" = "failed",
    wideLevel: number = 0,
    private readonly displayMode: LiveDisplayMode = "dashboard",
  ) {
    super(actionDetails, wideLevel);
  }

  public tailFile(filePath: string): Promise<void> {
    this.dashboardStartTime = Date.now();
    if (!fs.existsSync(filePath) && this.displayMode === "dashboard") {
      console.log(
        chalk.yellow(`Waiting for file to be created: ${filePath}...`),
      );
    }

    return new Promise((resolve, reject) => {
      const tail = new Tail(filePath, { fromBeginning: true, follow: true });

      tail.on("line", (line: string) => {
        try {
          if (line.trim() === "") return;
          const event: BepEvent = JSON.parse(line);
          this.processEvent(event);
        } catch (e) {}
      });

      tail.on("error", (error: any) => {
        this.stop();
        if (this.displayMode !== "vscode-log") {
          console.error(chalk.red("Error reading file:"), error);
        }
        reject(error);
      });

      const checkFinished = setInterval(() => {
        if (this.isFinished) {
          this.stop();
          if (tail.unwatch) tail.unwatch();
          // Final render call for modes that need it
          if (this.displayMode === "vscode-status") {
            this.renderVscodeStatus();
            logUpdate.done();
          } else if (this.displayMode === "dashboard") {
            this.renderLiveUpdate();
            logUpdate.done();
          }
          clearInterval(checkFinished);
          resolve();
        }
      }, 250);
    });
  }

  private addRecentLog(log: string) {
    if (this.recentLogs[this.recentLogs.length - 1] === log) return;
    this.recentLogs.push(log);
    while (this.recentLogs.length > 5) {
      this.recentLogs.shift();
    }
  }

  protected processEvent(event: BepEvent): void {
    super.processEvent(event);

    const id = event.id;
    const data = event.payload || event;

    if (id.buildStarted || id.started) {
      if (!this.timer) this.startTimer();
      if (this.displayMode === "vscode-log" && data.started) {
        console.log(`[START] Build started. Command: ${data.started.command}`);
        console.log(`---`);
      }
    } else if (id.actionCompleted) {
      const lastAction = this.actions[this.actions.length - 1];
      if (lastAction && this.displayMode === "vscode-log") {
        const duration = parseInt(
          lastAction.actionResult?.executionInfo.wallTimeMillis || "0",
          10,
        );
        const status = lastAction.success ? "SUCCESS" : "FAILURE";

        console.log(
          `[ACTION] ${status} | ${lastAction.mnemonic} | ${formatDuration(duration)} | ${lastAction.label}`,
        );
        if (lastAction.argv) {
          console.log(`  CMD: ${lastAction.argv.join(" ")}`);
        }
        if (!lastAction.success && lastAction.stderrContent) {
          console.log(
            `  STDERR:\n${stripAnsi(lastAction.stderrContent).trim()}`,
          );
        }
        console.log(`---`);
      }
      if (lastAction && this.displayMode === "dashboard") {
        if (lastAction.success) {
          this.addRecentLog(`${chalk.green("✔")} ${lastAction.label}`);
        } else if (this.actionDetails !== "none") {
          this.addRecentLog(
            chalk.red.bold(
              `❌ FAILED: ${lastAction.mnemonic} ${lastAction.label}`,
            ),
          );
        }
      }
    } else if (id.problem) {
      if (this.displayMode === "vscode-log" && data.problem) {
        console.log(`[PROBLEM] ${data.problem.message.trim()}`);
        console.log(`---`);
      }
      if (this.displayMode === "dashboard" && data.problem) {
        const problemMsg = `Problem: ${data.problem.message.split("\n")[0]}`;
        this.addRecentLog(chalk.red(problemMsg));
      }
    } else if (id.progress) {
      this.progressText = data.progress?.stderr || data.progress?.stdout || "";
      const parsed = parseProgress(this.progressText);

      if (parsed.total > 0 && parsed.completed >= 0) {
        this.lastProgressTotal = parsed.total;
        this.lastProgressCompleted = parsed.completed;
      }
      if (parsed.currentLabel) this.lastCurrentLabel = parsed.currentLabel;

      if (this.displayMode === "dashboard") {
        parsed.logs.forEach((log) => {
          if (stripAnsi(log).trim()) this.addRecentLog(`  ${log}`);
        });
      }
    } else if (id.buildFinished || id.finished) {
      this.isFinished = true;
      if (this.displayMode === "vscode-log" && data.finished) {
        const finishTime = parseInt(data.finished.finishTimeMillis, 10);
        const startTime = this.buildStarted
          ? parseInt(this.buildStarted.startTimeMillis, 10)
          : 0;
        const totalTime =
          startTime > 0 ? formatDuration(finishTime - startTime) : "N/A";
        console.log(
          `[FINISH] ${data.finished.overallSuccess ? "SUCCESS" : "FAILURE"} | Total Time: ${totalTime}`,
        );
      }
    }
  }

  private startTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (!this.isFinished) {
        this.spinnerIndex = (this.spinnerIndex + 1) % this.spinner.length;

        // --- CORRECTED LOGIC ---
        // Only run render loops for the modes that need them.
        // 'vscode-log' does NOT need a render loop.
        switch (this.displayMode) {
          case "vscode-status":
            this.renderVscodeStatus();
            break;
          case "dashboard":
            const duration = Date.now() - this.dashboardStartTime;
            this.runningTime = formatDuration(duration);
            this.renderLiveUpdate();
            break;
        }
      } else {
        clearInterval(this.timer!);
        this.timer = null;
      }
    }, 100);
  }

  private stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isFinished = true;
  }

  private renderVscodeStatus() {
    let status = `$(sync~spin) RUNNING`;
    let topActionInfo = "";

    if (this.isFinished && this.buildFinished) {
      status = this.buildFinished.overallSuccess
        ? `$(check) SUCCESS`
        : `$(error) FAILURE`;
    } else {
      const progressInfo = parseProgress(this.progressText);
      if (progressInfo.runningActions.length > 0) {
        topActionInfo = `| ${progressInfo.runningActions[0].name}`;
      }
    }

    const progress =
      this.lastProgressTotal > 0
        ? `[${this.lastProgressCompleted}/${this.lastProgressTotal}]`
        : "";

    const label = this.lastCurrentLabel ? `| ${this.lastCurrentLabel}` : "";

    logUpdate(`${status} ${progress} ${label} ${topActionInfo}`);
  }

  public renderLiveUpdate(): void {
    const output: string[] = [];
    let status = chalk.yellow("RUNNING");
    let totalTime = this.runningTime;
    const currentSpinner = this.spinner[this.spinnerIndex];

    if (this.isFinished && this.buildFinished && this.buildStarted) {
      status = this.buildFinished.overallSuccess
        ? chalk.green("SUCCESS")
        : chalk.red("FAILURE");
      const duration =
        parseInt(this.buildFinished.finishTimeMillis, 10) -
        parseInt(this.buildStarted.startTimeMillis, 10);
      totalTime = formatDuration(duration);
    }

    const statusLine = this.isFinished
      ? `Status: ${status}`
      : `Status: ${status} ${chalk.cyan(currentSpinner)}`;
    output.push(chalk.bold.cyan("--- Real-Time Build Dashboard ---"));
    output.push(`${statusLine}  |  Elapsed Time: ${chalk.yellow(totalTime)}`);

    if (!this.isFinished) {
      if (this.lastProgressTotal > 0) {
        const percent = Math.floor(
          (this.lastProgressCompleted / this.lastProgressTotal) * 100,
        );
        const bar = renderProgressBar(percent, 30);
        output.push(
          chalk.bold(
            `Overall Progress: [${bar}] ${percent}% (${this.lastProgressCompleted.toLocaleString()}/${this.lastProgressTotal.toLocaleString()})`,
          ),
        );
      } else {
        output.push(" ");
      }

      output.push("");
      output.push(chalk.bold.cyan("--- Running Actions ---"));

      let runningActionColWidths: (number | null)[];
      if (this.wideLevel >= 2) {
        runningActionColWidths = [200, 10];
      } else if (this.wideLevel === 1) {
        runningActionColWidths = [120, 10];
      } else {
        runningActionColWidths = [70, 10];
      }

      const runningActionsTable = new Table({
        colWidths: runningActionColWidths,
        style: { head: [], border: [], "padding-left": 0, "padding-right": 0 },
      });

      const maxActionsToShow = 5;
      const actionsToDisplay = parseProgress(
        this.progressText,
      ).runningActions.slice(0, maxActionsToShow);

      for (let i = 0; i < maxActionsToShow; i++) {
        const action = actionsToDisplay[i];
        if (action) {
          runningActionsTable.push([
            chalk.gray(action.name),
            chalk.yellow(action.duration),
          ]);
        } else {
          runningActionsTable.push(["", ""]);
        }
      }
      output.push(runningActionsTable.toString());

      output.push("");
      output.push(chalk.bold.cyan("--- Recent Activity ---"));

      const maxLogsToShow = 5;
      const displayLogs = [...this.recentLogs];
      while (displayLogs.length < maxLogsToShow) {
        displayLogs.unshift(" ");
      }

      const maxWidth =
        this.wideLevel >= 2 ? Infinity : this.wideLevel === 1 ? 150 : 90;

      displayLogs.forEach((log) => {
        if (log.trim() === "") {
          output.push(log);
          return;
        }
        if (maxWidth === Infinity) {
          output.push(log);
          return;
        }
        const cleanLog = stripAnsi(log);
        output.push(
          cleanLog.length > maxWidth
            ? `${cleanLog.substring(0, maxWidth - 3)}...`
            : log,
        );
      });
    }

    logUpdate(output.join("\n"));
  }
}
