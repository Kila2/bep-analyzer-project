import * as fs from "fs";
import * as readline from "readline";
import { fileURLToPath } from "url";
import chalk from "chalk";
import {
  BepEvent,
  Action,
  TestSummary,
  BuildFinished,
  BuildStarted,
  Problem,
  WorkspaceStatus,
  Configuration,
  BuildMetrics,
  BuildToolLogs,
  OptionsParsed,
  StructuredCommandLine,
  NamedSetOfFiles,
  ConvenienceSymlink,
  TargetCompleted,
  ReportData,
} from "./types";

function stripAnsi(str: string): string {
  // This helper is used locally for filtering logic, not for the final output
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]|\\r/g,
    "",
  );
}

function getFileStem(filePath: string): string {
  if (!filePath) return "";
  // Get 'file.ext' from '/path/to/file.ext'
  const basename = filePath.split(/[\\/]/).pop() || "";
  // Get 'file' from 'file.ext'
  return basename.split(".").shift() || "";
}

export class StaticBepAnalyzer {
  protected buildStarted: BuildStarted | null = null;
  protected buildFinished: BuildFinished | null = null;
  protected buildMetrics: BuildMetrics | null = null;
  protected buildToolLogs: BuildToolLogs | null = null;
  protected readonly actions: Action[] = [];
  protected readonly testSummaries: TestSummary[] = [];
  protected readonly problems: Problem[] = [];
  protected readonly failedTargets: { label: string; configId?: string }[] = [];
  protected workspaceStatus: WorkspaceStatus | null = null;
  protected readonly configurations: Map<string, Configuration> = new Map();
  protected optionsParsed: OptionsParsed | null = null;
  protected structuredCommandLine: StructuredCommandLine | null = null;
  protected buildPatterns: string[] = [];
  private readonly namedSets: Map<string, NamedSetOfFiles> = new Map();
  private readonly convenienceSymlinks: ConvenienceSymlink[] = [];
  private readonly topLevelOutputSets: Map<string, string[]> = new Map();
  private readonly progressStderrCache: Map<string, string> = new Map();
  private readonly actionStrategyCache: Map<string, string> = new Map();

  constructor(
    protected actionDetails: "none" | "failed" | "all" = "failed",
    protected wideLevel: number = 0,
  ) {}

  public async analyze(filePath: string) {
    if (!fs.existsSync(filePath)) {
      console.error(chalk.red(`Error: File not found at ${filePath}`));
      process.exit(1);
    }

    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      try {
        if (line.trim() === "") continue;
        const event: BepEvent = JSON.parse(line);
        this.processEvent(event);
      } catch (e) {
        console.warn(
          chalk.yellow(
            `Warning: Could not parse or process line: ${line.substring(
              0,
              100,
            )}...`,
          ),
        );
        if (e instanceof Error) console.warn(chalk.gray(e.message));
      }
    }
  }

  protected processEvent(event: BepEvent): void {
    const id = event.id;
    const data = event.payload || event;

    if (id.buildStarted || id.started) {
      if (data.started) this.buildStarted = data.started;
      return;
    }

    if (id.buildFinished || id.finished) {
      if (data.finished) this.buildFinished = data.finished;
      return;
    }

    if (id.progress && (data.progress?.stderr || data.progress?.stdout)) {
      const fullStderr = data.progress.stderr || data.progress.stdout || "";

      // --- New: Parse stderr for execution strategies ---
      const actionLines = fullStderr.split("\n");
      for (const line of actionLines) {
        const strippedLine = stripAnsi(line).trim();
        // Regex to find lines like: `Compiling path/to/file.cpp; 1s local`
        const actionMatch = strippedLine.match(
          /^(\s*\w+\s+.+?);.*?(?:(\d+s)\s+([a-zA-Z\s-]+\w))?$/i,
        );
        if (actionMatch && actionMatch[3]) {
          const description = actionMatch[1].trim();
          const strategy = actionMatch[3].trim();
          const stem = getFileStem(description);
          if (stem && strategy) {
            this.actionStrategyCache.set(stem, strategy);
          }
        }
      }
      const rawLines = fullStderr.split("\n");

      // Strict filtering for static analysis: only keep lines with explicit "warning:" or "error:".
      // This provides the cleanest possible output for reports.
      const relevantLines = rawLines.filter((line: any) => {
        const cleanLine = stripAnsi(line).toLowerCase();
        return cleanLine.includes("warning:") || cleanLine.includes("error:");
      });

      const cleanedStderr = relevantLines.join("\n").trim();

      if (cleanedStderr && event.children) {
        for (const child of event.children) {
          if (child.actionCompleted?.label) {
            this.progressStderrCache.set(
              child.actionCompleted.label,
              cleanedStderr,
            );
          }
        }
      }
    }

    const eventType = Object.keys(id)[0];
    switch (eventType) {
      case "actionCompleted":
        const actionData = data.completed || data.action;
        if (actionData) {
          const action = actionData as Action;
          action.label =
            id.actionCompleted!.label || id.actionCompleted!.primaryOutput;
          if (id.actionCompleted!.primaryOutput) {
            action.primaryOutput = {
              uri: `file://${id.actionCompleted!.primaryOutput}`,
            };
          }

          if (!action.mnemonic && action.type) action.mnemonic = action.type;

          if (!action.actionResult) {
            let wallTimeMillis = "0";
            if (action.startTime && action.endTime) {
              try {
                const start = new Date(action.startTime).getTime();
                const end = new Date(action.endTime).getTime();
                wallTimeMillis = (end - start).toString();
              } catch (e) {}
            }
            action.actionResult = {
              executionInfo: {
                startTimeMillis: "0",
                wallTimeMillis: wallTimeMillis,
              },
            };
          }

          // --- New: Attach cached strategy ---
          const outputUri = action.primaryOutput?.uri || "";
          if (outputUri) {
            const stem = getFileStem(outputUri);
            if (this.actionStrategyCache.has(stem)) {
              action.strategy = this.actionStrategyCache.get(stem);
              this.actionStrategyCache.delete(stem); // Clean up cache
            }
          }

          const shouldProcessDetails =
            this.actionDetails === "all" ||
            (this.actionDetails === "failed" && !action.success);

          if (shouldProcessDetails) {
            const fullActionPayload = data.action || data.completed;
            action.argv =
              fullActionPayload.commandLine || fullActionPayload.argv;

            const cachedStderr = action.label
              ? this.progressStderrCache.get(action.label)
              : undefined;
            if (cachedStderr) {
              action.stderrContent = cachedStderr;
              this.progressStderrCache.delete(action.label!);
            } else if (fullActionPayload.stderr?.uri) {
              try {
                const stderrPath = fileURLToPath(fullActionPayload.stderr.uri);
                if (fs.existsSync(stderrPath)) {
                  action.stderrContent = fs.readFileSync(stderrPath, "utf-8");
                } else {
                  if (action.success) {
                    action.stderrContent = `[Info] Stderr file not found (likely cleaned up by Bazel).`;
                  } else {
                    action.stderrContent = `[Error] Stderr file for FAILED action not found. URI: ${fullActionPayload.stderr.uri}`;
                  }
                }
              } catch (e) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                action.stderrContent = `[Error] Failed to process stderr URI: ${fullActionPayload.stderr.uri}. Reason: ${errorMessage}`;
              }
            }
          }
          this.actions.push(action);
        }
        break;
      case "testSummary":
        if (data.summary) {
          const summary = data.summary as TestSummary;
          summary.label = id.testSummary!.label;
          const existingIndex = this.testSummaries.findIndex(
            (s) => s.label === summary.label,
          );
          if (existingIndex > -1) this.testSummaries[existingIndex] = summary;
          else this.testSummaries.push(summary);
        }
        break;
      case "problem":
        if (data.problem) this.problems.push(data.problem as Problem);
        break;
      case "targetCompleted":
        const completedData = data.completed as TargetCompleted;
        if (completedData) {
          if (!completedData.success) {
            this.failedTargets.push({
              label: id.targetCompleted!.label,
              configId: id.targetCompleted!.configuration?.id,
            });
          } else {
            const cleanLabel = id.targetCompleted!.label.replace(/^(@@?)/, "");
            if (
              this.buildPatterns.some((p) =>
                cleanLabel.startsWith(p.replace(/^(@@?)/, "")),
              )
            ) {
              const fileSetIds =
                completedData.outputGroup?.flatMap(
                  (group) => group.fileSets?.map((fs) => fs.id) || [],
                ) || [];
              if (fileSetIds.length > 0) {
                this.topLevelOutputSets.set(
                  id.targetCompleted!.label,
                  fileSetIds,
                );
              }
            }
          }
        }
        break;
      case "workspaceStatus":
        if (data.workspaceStatus) this.workspaceStatus = data.workspaceStatus;
        break;
      case "optionsParsed":
        if (data.optionsParsed) this.optionsParsed = data.optionsParsed;
        break;
      case "structuredCommandLine":
        if (
          data.structuredCommandLine &&
          data.structuredCommandLine.commandLineLabel === "canonical"
        ) {
          this.structuredCommandLine = data.structuredCommandLine;
        }
        break;
      case "pattern":
        if (id.pattern?.pattern) this.buildPatterns.push(...id.pattern.pattern);
        break;
      case "namedSet":
        if (id.namedSet?.id && data.namedSetOfFiles) {
          this.namedSets.set(id.namedSet.id, data.namedSetOfFiles);
        }
        break;
      case "convenienceSymlinksIdentified":
        if (data.convenienceSymlinksIdentified?.convenienceSymlinks) {
          this.convenienceSymlinks.push(
            ...data.convenienceSymlinksIdentified.convenienceSymlinks,
          );
        }
        break;
      case "configuration":
        if (data.configuration)
          this.configurations.set(id.configuration!.id, data.configuration);
        break;
      case "buildMetrics":
        if (event.buildMetrics)
          this.buildMetrics = event.buildMetrics as BuildMetrics;
        break;
      case "buildToolLogs":
        if (event.buildToolLogs)
          this.buildToolLogs = event.buildToolLogs as BuildToolLogs;
        break;
      default:
        // Not handling other event types for now
        break;
    }
  }

  private resolveFileSet(fileSetId: string): { name: string; uri: string }[] {
    const seen = new Set<string>();
    const queue = [fileSetId];
    const result: { name: string; uri: string }[] = [];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (seen.has(currentId)) continue;
      seen.add(currentId);

      const fileSet = this.namedSets.get(currentId);
      if (!fileSet) continue;

      if (fileSet.files) {
        result.push(...fileSet.files);
      }
      if (fileSet.fileSets) {
        queue.push(...fileSet.fileSets.map((fs) => fs.id));
      }
    }
    return result;
  }

  public getReportData(): ReportData {
    const resolvedOutputs = new Map<string, string[]>();
    this.topLevelOutputSets.forEach((fileSetIds, target) => {
      const files = new Set<string>();
      fileSetIds.forEach((id) => {
        this.resolveFileSet(id).forEach((file) => files.add(file.name));
      });
      resolvedOutputs.set(target, Array.from(files));
    });

    return {
      buildStarted: this.buildStarted,
      buildFinished: this.buildFinished,
      buildMetrics: this.buildMetrics,
      buildToolLogs: this.buildToolLogs,
      actions: this.actions,
      testSummaries: this.testSummaries,
      problems: this.problems,
      failedTargets: this.failedTargets,
      workspaceStatus: this.workspaceStatus,
      configurations: this.configurations,
      optionsParsed: this.optionsParsed,
      structuredCommandLine: this.structuredCommandLine,
      buildPatterns: this.buildPatterns,
      resolvedOutputs: resolvedOutputs,
      convenienceSymlinks: this.convenienceSymlinks,
      actionDetails: this.actionDetails,
    };
  }
}
