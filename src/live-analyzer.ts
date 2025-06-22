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
}

function parseProgress(text: string): ProgressInfo {
  // Bazel's progress stderr can contain multiple blocks separated by cursor movement codes.
  // We only care about the last, most up-to-date block.
  const blocks = text.split(/\r\u001b\[1A\u001b\[K/);
  const lastBlock = blocks[blocks.length - 1];

  const lines = lastBlock.split("\n");
  let completed = 0;
  let total = 0;
  const runningActions: { name: string; duration: string }[] = [];
  const logs: string[] = [];

  for (const line of lines) {
    const strippedLine = stripAnsi(line).trim();
    if (!strippedLine) continue;

    const progressMatch = strippedLine.match(/^\[([\d,]+)\s*\/\s*([\d,]+)\]/);
    if (progressMatch) {
      completed = parseInt(progressMatch[1].replace(/,/g, ""), 10);
      total = parseInt(progressMatch[2].replace(/,/g, ""), 10);
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

    // For live analysis, only show explicit warnings/errors to avoid layout clutter.
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

  return { completed, total, runningActions, logs };
}

export class LiveBepAnalyzer extends StaticBepAnalyzer {
  private progressText: string = "Initializing...";
  private runningTime: string = "0.00s";
  private isFinished: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly spinner = ["⠋", "⠙", "⠹", "⸸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private spinnerIndex = 0;
  private recentLogs: string[] = [];
  private dashboardStartTime: number = 0;

  constructor(
    actionDetails: "none" | "failed" | "all" = "failed",
    wideLevel: number = 0,
  ) {
    super(actionDetails, wideLevel);
  }

  public tailFile(filePath: string): Promise<void> {
    this.dashboardStartTime = Date.now();
    if (!fs.existsSync(filePath)) {
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
        console.error(chalk.red("Error reading file:"), error);
        reject(error);
      });

      const checkFinished = setInterval(() => {
        if (this.isFinished) {
          this.stop();
          if (tail.unwatch) tail.unwatch();
          this.renderLiveUpdate();
          logUpdate.done();
          clearInterval(checkFinished);
          resolve();
        }
      }, 250);
    });
  }

  private addRecentLog(log: string) {
    if (this.recentLogs[this.recentLogs.length - 1] === log) {
      return;
    }
    this.recentLogs.push(log);
    while (this.recentLogs.length > 5) {
      this.recentLogs.shift();
    }
  }

  protected processEvent(event: BepEvent): void {
    super.processEvent(event); // This still populates the static data
    const id = event.id;
    const data = event.payload || event;

    if (id.buildStarted || id.started) {
      if (!this.timer) {
        this.startTimer();
      }
    } else if (id.actionCompleted) {
      const lastAction = this.actions[this.actions.length - 1];
      if (lastAction) {
        if (lastAction.success) {
          this.addRecentLog(`${chalk.green("✔")} ${lastAction.label}`);
        } else if (this.actionDetails !== "none") {
          this.addRecentLog(
            chalk.red.bold(
              `❌ FAILED: ${lastAction.mnemonic} ${lastAction.label}`,
            ),
          );
          if (lastAction.stderrContent) {
            const stderrLines = stripAnsi(lastAction.stderrContent)
              .trim()
              .split("\n")
              .slice(0, 3);
            stderrLines.forEach((line) =>
              this.addRecentLog(chalk.red(`  ${line}`)),
            );
            if (lastAction.stderrContent.trim().split("\n").length > 3) {
              this.addRecentLog(
                chalk.red("  ... (Full stderr in final report)"),
              );
            }
          }
        }
      }
    } else if (id.problem) {
      const problemMsg = `Problem: ${data.problem?.message.split("\n")[0]}`;
      this.addRecentLog(chalk.red(problemMsg));
    } else if (id.progress) {
      this.progressText = data.progress?.stderr || data.progress?.stdout || "";
      const parsed = parseProgress(this.progressText);
      parsed.logs.forEach((log) => {
        if (stripAnsi(log).trim()) {
          this.addRecentLog(`  ${log}`);
        }
      });
    } else if (id.buildFinished || id.finished) {
      this.isFinished = true;
    }
  }

  private startTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (!this.isFinished) {
        const duration = Date.now() - this.dashboardStartTime;
        this.runningTime = formatDuration(duration);
        this.spinnerIndex = (this.spinnerIndex + 1) % this.spinner.length;
        this.renderLiveUpdate();
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

    const progressInfo = parseProgress(this.progressText);

    if (!this.isFinished) {
      // Overall Progress Bar (always shows if data is available)
      if (progressInfo.total > 0 && progressInfo.completed >= 0) {
        const percent = Math.floor(
          (progressInfo.completed / progressInfo.total) * 100,
        );
        const bar = renderProgressBar(percent, 30);
        output.push(
          chalk.bold(
            `Overall Progress: [${bar}] ${percent}% (${progressInfo.completed.toLocaleString()}/${progressInfo.total.toLocaleString()})`,
          ),
        );
      }

      // --- Running Actions Section (always visible to prevent flicker) ---
      output.push("");
      output.push(chalk.bold.cyan("--- Running Actions ---"));
      const runningActionsTable = new Table({
        colWidths: [70, 10],
        style: { head: [], border: [], "padding-left": 0, "padding-right": 0 },
      });

      const maxActionsToShow = 5;
      const actionsToDisplay = progressInfo.runningActions.slice(
        0,
        maxActionsToShow,
      );

      for (let i = 0; i < maxActionsToShow; i++) {
        const action = actionsToDisplay[i];
        if (action) {
          runningActionsTable.push([
            chalk.gray(action.name),
            chalk.yellow(action.duration),
          ]);
        } else {
          // Add a blank row to maintain a fixed table height
          runningActionsTable.push(["", ""]);
        }
      }
      output.push(runningActionsTable.toString());

      // --- Recent Activity Section (always visible with fixed height) ---
      output.push("");
      output.push(chalk.bold.cyan("--- Recent Activity ---"));

      const maxLogsToShow = 5;
      const displayLogs = [...this.recentLogs]; // Create a copy

      // Pad with blank lines to ensure a fixed height for this section
      while (displayLogs.length < maxLogsToShow) {
        // Use a non-empty string that renders as blank space to ensure the line is created
        displayLogs.unshift(" ");
      }

      const maxWidth =
        this.wideLevel >= 2 ? Infinity : this.wideLevel === 1 ? 150 : 90;

      displayLogs.forEach((log) => {
        if (log.trim() === "") {
          output.push(log); // Push the blank line
          return;
        }
        if (maxWidth === Infinity) {
          output.push(log);
          return;
        }
        const cleanLog = stripAnsi(log);
        if (cleanLog.length > maxWidth) {
          output.push(`${cleanLog.substring(0, maxWidth - 3)}...`);
        } else {
          output.push(log);
        }
      });
    }

    logUpdate(output.join("\n"));
  }
}
