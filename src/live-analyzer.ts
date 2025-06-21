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
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return chalk.green("█".repeat(filled)) + chalk.gray("░".repeat(empty));
}

function stripAnsi(str: string): string {
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
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
  const strippedText = stripAnsi(text);
  const lines = strippedText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let completed = 0;
  let total = 0;
  const runningActions: { name: string; duration: string }[] = [];
  const logs: string[] = [];

  const progressMatch = strippedText.match(/\(\[([\d,]+)\s*\/\s*([\d,]+)\]\)/);
  if (progressMatch) {
    completed = parseInt(progressMatch[1].replace(/,/g, ""), 10);
    total = parseInt(progressMatch[2].replace(/,/g, ""), 10);
  }

  for (const line of lines) {
    const actionMatch = line.match(/^(\s*\w+\s+.+?);\s+(\d+s)/i);
    if (actionMatch && !line.startsWith("From")) {
      const name = actionMatch[1].trim();
      const duration = actionMatch[2];
      runningActions.push({ name, duration });
      continue;
    }

    if (
      /^(info|warning|error|from|in file included from)/i.test(line) ||
      /^\d+\s+warning(s)?\s+generated\./.test(line)
    ) {
      logs.push(line);
    } else if (line.includes("warning:") || line.includes("error:")) {
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
  private readonly spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private spinnerIndex = 0;
  private recentLogs: string[] = [];

  constructor(actionDetails: "none" | "failed" | "all" = "failed") {
    super(actionDetails);
  }

  public tailFile(filePath: string): Promise<void> {
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

  protected processEvent(event: BepEvent): void {
    super.processEvent(event);
    const id = event.id;
    const data = event.payload || event;

    if (id.buildStarted || id.started) {
      if (!this.timer) {
        const startTime =
          data.started?.startTimeMillis || Date.now().toString();
        this.startTimer(startTime);
      }
    } else if (id.actionCompleted) {
      const lastAction = this.actions[this.actions.length - 1];
      if (lastAction && !lastAction.success && this.actionDetails !== "none") {
        const errorHeader = chalk.red.bold(
          `❌ FAILED: ${lastAction.mnemonic} ${lastAction.label}`,
        );
        this.recentLogs.push(errorHeader);
        if (lastAction.stderrContent) {
          const stderrLines = lastAction.stderrContent
            .trim()
            .split("\n")
            .slice(0, 3);
          stderrLines.forEach((line) =>
            this.recentLogs.push(chalk.red(`  ${line}`)),
          );
          if (lastAction.stderrContent.trim().split("\n").length > 3) {
            this.recentLogs.push(
              chalk.red("  ... (Full stderr in final report)"),
            );
          }
        }
        while (this.recentLogs.length > 5) this.recentLogs.shift();
      }
    } else if (id.problem) {
      const problemMsg = `Problem: ${data.problem?.message.split("\n")[0]}`;
      this.recentLogs.push(chalk.red(problemMsg));
      if (this.recentLogs.length > 5) this.recentLogs.shift();
    } else if (id.progress) {
      this.progressText = data.progress?.stderr || data.progress?.stdout || "";
      const parsed = parseProgress(this.progressText);
      parsed.logs.forEach((log) => {
        if (
          !this.recentLogs.some(
            (existing) => stripAnsi(existing) === stripAnsi(log),
          )
        ) {
          this.recentLogs.push(log);
        }
      });
      while (this.recentLogs.length > 5) this.recentLogs.shift();
    } else if (id.buildFinished || id.finished) {
      this.isFinished = true;
    }
  }

  private startTimer(startTimeMillis: string) {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (!this.isFinished) {
        const duration = Date.now() - parseInt(startTimeMillis, 10);
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

  private renderLiveUpdate(): void {
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
      if (progressInfo.total > 0) {
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

      if (progressInfo.runningActions.length > 0) {
        output.push("");
        output.push(chalk.bold.cyan("--- Running Actions ---"));
        const table = new Table({
          colWidths: [70, 10],
          style: {
            head: [],
            border: [],
            "padding-left": 0,
            "padding-right": 0,
          },
        });
        progressInfo.runningActions.slice(0, 5).forEach((action) => {
          table.push([chalk.gray(action.name), chalk.yellow(action.duration)]);
        });
        output.push(table.toString());
      }

      if (this.recentLogs.length > 0) {
        output.push("");
        output.push(chalk.bold.cyan("--- Recent Logs ---"));
        this.recentLogs.forEach((log) => {
          const cleanLog =
            stripAnsi(log).length > 90
              ? stripAnsi(log).substring(0, 87) + "..."
              : stripAnsi(log);
          if (
            log.toLowerCase().includes("warning") ||
            log.includes("warning:")
          ) {
            output.push(chalk.yellow(`  ${cleanLog}`));
          } else if (
            log.toLowerCase().includes("error") ||
            log.includes("error:") ||
            log.includes("FAILED")
          ) {
            output.push(chalk.red(`  ${cleanLog}`));
          } else {
            output.push(chalk.dim(`  ${cleanLog}`));
          }
        });
      }
    }

    logUpdate(output.join("\n"));
  }
}
