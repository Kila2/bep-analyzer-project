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
  const lines = stripAnsi(text)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let completed = 0;
  let total = 0;
  const runningActions: { name: string; duration: string }[] = [];
  const logs: string[] = [];

  const progressMatch = text.match(/\(\[([\d,]+)\s*\/\s*([\d,]+)\]\)/);
  if (progressMatch) {
    completed = parseInt(progressMatch[1].replace(/,/g, ""), 10);
    total = parseInt(progressMatch[2].replace(/,/g, ""), 10);
  }

  for (const line of lines) {
    const actionMatch = line.match(
      /^(Compiling|Linking|Generating|Testing|Action)\s+(.+?);\s*(\d+s)\s+\w+$/,
    );
    if (actionMatch) {
      runningActions.push({
        name: `${actionMatch[1]} ${actionMatch[2]}`,
        duration: actionMatch[3],
      });
      continue;
    }

    if (
      line.startsWith("INFO:") ||
      line.startsWith("warning:") ||
      line.startsWith("ERROR:")
    ) {
      logs.push(line);
    }
  }

  return { completed, total, runningActions, logs };
}

export class LiveBepAnalyzer extends StaticBepAnalyzer {
  private progressText: string = "Initializing...";
  private runningTime: string = "0.00s";
  private isFinished: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private spinnerIndex = 0;
  private lastEventDescription = "Waiting for build to start...";
  private recentLogs: string[] = [];

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
    const id = event.id;
    const data = event.payload || event;

    if (id.buildStarted || id.started) {
      if (!this.timer) {
        const startTime =
          data.started?.startTimeMillis || Date.now().toString();
        this.startTimer(startTime);
      }
      this.lastEventDescription = `Build started. Command: ${chalk.gray(data.started?.command)}`;
    } else if (id.actionCompleted) {
      this.lastEventDescription = `Action Finished: ${chalk.blue(data.completed?.mnemonic)} ${id.actionCompleted.label}`;
    } else if (id.testSummary) {
      this.lastEventDescription = `Test Summary: ${chalk.magenta(id.testSummary.label)}`;
    } else if (id.problem) {
      const problemMsg = `Problem: ${data.problem?.message.split("\n")[0]}`;
      this.lastEventDescription = chalk.red(problemMsg);
      this.recentLogs.push(problemMsg);
      if (this.recentLogs.length > 5) this.recentLogs.shift();
    } else if (id.progress) {
      this.progressText = data.progress?.stderr || data.progress?.stdout || "";
      const parsed = parseProgress(this.progressText);
      if (parsed.logs.length > 0) {
        this.recentLogs.push(...parsed.logs);
        while (this.recentLogs.length > 5) this.recentLogs.shift();
      }
    } else if (id.buildFinished || id.finished) {
      this.isFinished = true;
      this.lastEventDescription = chalk.bold.green("Build finished.");
    }

    super.processEvent(event);
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
            `Overall Progress: [${bar}] ${percent}% (${progressInfo.completed}/${progressInfo.total})`,
          ),
        );
      }

      if (progressInfo.runningActions.length > 0) {
        output.push("");
        output.push(chalk.bold.cyan("--- Running Actions ---"));
        const table = new Table({
          colWidths: [80, 10],
          style: { head: [], border: [] },
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
          if (log.toLowerCase().includes("warning")) {
            output.push(chalk.yellow(log));
          } else if (log.toLowerCase().includes("error")) {
            output.push(chalk.red(log));
          } else {
            output.push(chalk.dim(log));
          }
        });
      }
    }

    logUpdate(output.join("\n"));
  }
}
