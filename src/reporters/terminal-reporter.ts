import chalk from "chalk";
import Table from "cli-table3";
import { ReportData, Action } from "../types";
import { Translator } from "../i18n/translator";

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(2)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = (seconds % 60).toFixed(0).padStart(2, "0");
  return `${minutes}m ${remainingSeconds}s`;
}

function formatNumber(num: number | string): string {
  return Number(num).toLocaleString();
}

function formatBytes(bytes: number | string): string {
  const num = Number(bytes);
  if (num === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(num) / Math.log(k));
  return parseFloat((num / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatDate(ms: number, lang: "en" | "zh"): string {
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  // Always use Shanghai timezone for consistency as requested
  const timeZone = "Asia/Shanghai";

  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      timeZone,
      timeZoneName: "short",
    }).format(new Date(ms));
  } catch (e) {
    return new Date(ms).toLocaleString(); // Fallback
  }
}

export class TerminalReporter {
  constructor(
    private data: ReportData,
    private wideLevel: number,
    private t: Translator,
  ) {}

  public printReport(): void {
    const {
      buildStarted,
      buildFinished,
      buildMetrics,
      buildToolLogs,
      actions,
      testSummaries,
      problems,
      failedTargets,
      workspaceStatus,
      configurations,
      optionsParsed,
      structuredCommandLine,
      buildPatterns,
      resolvedOutputs,
      convenienceSymlinks,
      actionDetails,
    } = this.data;

    if (!buildStarted || !buildFinished) {
      console.error(
        chalk.red(
          "Error: Build start or finish event not found. The BEP file may be incomplete or invalid.",
        ),
      );
      return;
    }

    // --- Build Summary ---
    console.log(chalk.bold.cyan(`\n--- ${this.t.t("buildSummary.title")} ---`));
    const success = buildFinished.overallSuccess;
    const exitCodeName =
      buildFinished.exitCode?.name ||
      (success
        ? this.t.t("buildSummary.exitCodeSuccess")
        : this.t.t("buildSummary.exitCodeFailure"));
    const status = success
      ? chalk.green(exitCodeName)
      : chalk.red(exitCodeName);
    const startTime = parseInt(buildStarted.startTimeMillis, 10);
    const finishTime = parseInt(buildFinished.finishTimeMillis, 10);

    const summaryTable = new Table({ style: { head: [], border: [] } });
    summaryTable.push(
      [`${this.t.t("buildSummary.status")}:`, status],
      [
        `${this.t.t("buildSummary.buildTime")}:`,
        chalk.gray(formatDate(startTime, this.t.getLanguage())),
      ],
      [
        `${this.t.t("buildSummary.totalTime")}:`,
        chalk.yellow(formatDuration(finishTime - startTime)),
      ],
    );
    if (buildMetrics?.timingMetrics) {
      const metrics = buildMetrics.timingMetrics;
      summaryTable.push(
        [
          `  - ${this.t.t("buildSummary.analysisPhase")}:`,
          chalk.magenta(formatDuration(Number(metrics.analysisPhaseTimeInMs))),
        ],
        [
          `  - ${this.t.t("buildSummary.executionPhase")}:`,
          chalk.magenta(formatDuration(Number(metrics.executionPhaseTimeInMs))),
        ],
      );
    }
    console.log(summaryTable.toString());

    // --- Build Environment & Options ---
    console.log(chalk.bold.cyan(`\n--- ${this.t.t("buildEnv.title")} ---`));
    const envTable = new Table({
      colWidths: [30, 70],
      style: { border: ["gray"], head: [] },
      wordWrap: true,
    });
    envTable.push([
      {
        colSpan: 2,
        content: chalk.bold.white(this.t.t("buildEnv.invocationDetails")),
      },
    ]);
    envTable.push([
      this.t.t("buildEnv.command"),
      chalk.gray(buildStarted.command),
    ]);
    if (buildPatterns.length > 0) {
      envTable.push([
        this.t.t("buildEnv.targets"),
        chalk.gray(buildPatterns.join(", ")),
      ]);
    }
    if (workspaceStatus) {
      workspaceStatus.item.forEach((item) => {
        envTable.push([item.key, chalk.gray(item.value || "")]);
      });
    }
    if (envTable.length > 1) console.log(envTable.toString());

    if (
      optionsParsed?.explicitCmdLine &&
      optionsParsed.explicitCmdLine.length > 0
    ) {
      console.log(
        chalk.bold.white(`\n${this.t.t("buildEnv.explicitOptions")}:`),
      );
      optionsParsed.explicitCmdLine.forEach((opt) =>
        console.log(chalk.gray(`  ${opt}`)),
      );
    }

    if (structuredCommandLine) {
      console.log(
        chalk.bold.white(`\n${this.t.t("buildEnv.canonicalCommandLine")}:`),
      );
      const cmd = structuredCommandLine.sections
        .flatMap(
          (s) =>
            s.chunkList?.chunk ||
            s.optionList?.option.map((o) => o.combinedForm) ||
            [],
        )
        .join(" ");
      console.log(chalk.gray(cmd));
    } else if (buildStarted.optionsDescription) {
      console.log(
        chalk.bold.white(`\n${this.t.t("buildEnv.optionsDescription")}:`),
      );
      console.log(chalk.gray(buildStarted.optionsDescription));
    }

    // --- Performance Metrics ---
    if (buildMetrics) {
      console.log(
        chalk.bold.cyan(`\n--- ${this.t.t("performanceMetrics.title")} ---`),
      );
      const metrics = buildMetrics;
      const perfTable = new Table({
        style: { head: ["cyan"], border: ["gray"] },
      });
      perfTable.push(
        [
          {
            colSpan: 2,
            content: chalk.bold.white(
              this.t.t("performanceMetrics.executionCaching"),
            ),
          },
        ],
        [
          this.t.t("performanceMetrics.actionsCreated"),
          chalk.blue(
            formatNumber(metrics.actionSummary.actionsCreated || "N/A"),
          ),
        ],
        [
          this.t.t("performanceMetrics.actionsExecuted"),
          chalk.blue(formatNumber(metrics.actionSummary.actionsExecuted)),
        ],
      );
      if (metrics.actionSummary.actionCacheStatistics) {
        const stats = metrics.actionSummary.actionCacheStatistics;
        const misses = stats.missDetails.reduce(
          (s, d) => s + (Number(d.count) || 0),
          0,
        );
        const hits = Number(
          metrics.artifactMetrics?.outputArtifactsFromActionCache?.count ||
            stats.hits ||
            0,
        );
        const totalLookups = hits + misses;
        const hitRate =
          totalLookups > 0 ? ((hits / totalLookups) * 100).toFixed(2) : "0.00";
        const hitRateColor = hits > 0 ? chalk.green : chalk.yellow;
        const hitsLabel = this.t.t("performanceMetrics.actionCacheHits");
        const missesLabel = this.t.t("performanceMetrics.actionCacheMisses");
        perfTable.push([
          this.t.t("performanceMetrics.actionCache"),
          `${hitRateColor(hitRate + "%")} ${this.t.t("performanceMetrics.actionCacheHit")} (${formatNumber(hits)} ${hitsLabel} / ${formatNumber(misses)} ${missesLabel})`,
        ]);

        if (stats.missDetails && stats.missDetails.length > 0) {
          const missRows = stats.missDetails
            .filter((d) => Number(d.count) > 0)
            .sort((a, b) => Number(b.count) - Number(a.count));

          if (missRows.length > 0) {
            perfTable.push([
              {
                colSpan: 2,
                content: chalk.white(
                  `  ${this.t.t("performanceMetrics.cacheMissBreakdown")}:`,
                ),
              },
            ]);
            missRows
              .filter((detail) => detail.reason != undefined)
              .forEach((detail) => {
                const pascalCaseReason = detail
                  .reason!.replace(/_/g, " ")
                  .toLowerCase()
                  .replace(/(?:^|\s)\S/g, (a) => a.toUpperCase())
                  .replace(/\s/g, "");
                const reasonKey = `performanceMetrics.cacheMissReason.${pascalCaseReason}`;
                const reason = this.t.t(reasonKey, { reason: detail.reason! });
                perfTable.push([
                  `    - ${reason}`,
                  chalk.yellow(formatNumber(detail.count ?? 0)),
                ]);
              });
          }
        }
      }
      if (metrics.memoryMetrics) {
        const memRows: any[] = [];
        if (metrics.memoryMetrics.peakPostGcHeapSize) {
          memRows.push([
            this.t.t("performanceMetrics.peakHeap"),
            chalk.magenta(
              formatBytes(metrics.memoryMetrics.peakPostGcHeapSize),
            ),
          ]);
        }
        if (metrics.memoryMetrics.usedHeapSizePostBuild) {
          memRows.push([
            this.t.t("performanceMetrics.usedHeapPostBuild"),
            chalk.magenta(
              formatBytes(metrics.memoryMetrics.usedHeapSizePostBuild),
            ),
          ]);
        }
        if (memRows.length > 0) {
          perfTable.push([
            {
              colSpan: 2,
              content: chalk.bold.white(
                this.t.t("performanceMetrics.memoryUsage"),
              ),
            },
          ]);
          perfTable.push(...memRows);
        }

        if (
          metrics.memoryMetrics.garbageMetrics &&
          metrics.memoryMetrics.garbageMetrics.length > 0
        ) {
          const gcRows: any[] = [];
          metrics.memoryMetrics.garbageMetrics
            .sort(
              (a, b) => Number(b.garbageCollected) - Number(a.garbageCollected),
            )
            .forEach((metric) => {
              const originalType = metric.type;
              const pascalCaseType = originalType.replace(/[^a-zA-Z0-9]/g, "");
              const typeKey = `performanceMetrics.gcType.${pascalCaseType}`;
              const translatedType = this.t.t(typeKey);

              let displayType: string;
              if (translatedType !== typeKey) {
                // Translation found
                if (this.t.getLanguage() === "zh") {
                  displayType = `${translatedType} (${originalType})`;
                } else {
                  displayType = translatedType;
                }
              } else {
                // No translation, fallback to original
                displayType = originalType;
              }

              gcRows.push([
                `  ${displayType}`,
                chalk.magenta(formatBytes(metric.garbageCollected)),
              ]);
            });
          if (gcRows.length > 0) {
            perfTable.push([
              {
                colSpan: 2,
                content: chalk.bold.white(
                  this.t.t("performanceMetrics.gcByType"),
                ),
              },
            ]);
            perfTable.push(...gcRows);
          }
        }
      }
      console.log(perfTable.toString());
    }

    // --- Artifact Metrics ---
    if (buildMetrics?.artifactMetrics) {
      console.log(
        chalk.bold.cyan(`\n--- ${this.t.t("artifactMetrics.title")} ---`),
      );
      const { sourceArtifactsRead, outputArtifactsSeen, topLevelArtifacts } =
        buildMetrics.artifactMetrics;
      const artifactTable = new Table({
        head: [
          this.t.t("artifactMetrics.metric"),
          this.t.t("artifactMetrics.count"),
          this.t.t("artifactMetrics.size"),
        ],
        style: { head: ["cyan"] },
      });
      artifactTable.push([
        this.t.t("artifactMetrics.sourceRead"),
        formatNumber(sourceArtifactsRead.count),
        formatBytes(sourceArtifactsRead.sizeInBytes),
      ]);
      artifactTable.push([
        this.t.t("artifactMetrics.outputSeen"),
        formatNumber(outputArtifactsSeen.count),
        formatBytes(outputArtifactsSeen.sizeInBytes),
      ]);
      if (topLevelArtifacts)
        artifactTable.push([
          this.t.t("artifactMetrics.topLevel"),
          formatNumber(topLevelArtifacts.count),
          formatBytes(topLevelArtifacts.sizeInBytes),
        ]);
      console.log(artifactTable.toString());
    }

    // --- Build Graph Metrics ---
    if (buildMetrics?.buildGraphMetrics) {
      console.log(
        chalk.bold.cyan(`\n--- ${this.t.t("buildGraphMetrics.title")} ---`),
      );
      const { actionCount, outputArtifactCount, builtValues } =
        buildMetrics.buildGraphMetrics;
      const graphTable = new Table({ style: { border: ["gray"] } });
      graphTable.push(
        [
          this.t.t("buildGraphMetrics.totalActions"),
          chalk.blue(formatNumber(actionCount)),
        ],
        [
          this.t.t("buildGraphMetrics.totalOutputs"),
          chalk.blue(formatNumber(outputArtifactCount)),
        ],
      );
      console.log(graphTable.toString());
      if (builtValues && builtValues.length > 0) {
        console.log(
          chalk.bold.cyan(
            `\n--- ${this.t.t("buildGraphMetrics.topSkyFunctions")} ---`,
          ),
        );
        const skyFunctionTable = new Table({
          head: [
            this.t.t("buildGraphMetrics.skyFunction"),
            this.t.t("buildGraphMetrics.evalCount"),
          ],
          style: { head: ["cyan"] },
        });
        builtValues
          .sort((a, b) => Number(b.count) - Number(a.count))
          .slice(0, 10)
          .forEach((v) =>
            skyFunctionTable.push([v.skyfunctionName, formatNumber(v.count)]),
          );
        console.log(skyFunctionTable.toString());
      }
    }

    // --- Worker & Network Metrics ---
    if (buildMetrics) {
      const hasWorkerMetrics =
        buildMetrics.workerMetrics && buildMetrics.workerMetrics.length > 0;
      const hasNetworkMetrics =
        buildMetrics.networkMetrics &&
        buildMetrics.networkMetrics.systemNetworkStats;
      if (hasWorkerMetrics || hasNetworkMetrics) {
        console.log(
          chalk.bold.cyan(
            `\n--- ${this.t.t("workerNetworkMetrics.title")} ---`,
          ),
        );
        const workerNetworkTable = new Table({ style: { border: ["gray"] } });
        if (hasWorkerMetrics) {
          const totalActions = buildMetrics.workerMetrics!.reduce(
            (sum, w) => sum + Number(w.actionsExecuted),
            0,
          );
          workerNetworkTable.push([
            this.t.t("workerNetworkMetrics.totalWorkerActions"),
            formatNumber(totalActions),
          ]);
        }
        if (hasNetworkMetrics) {
          const { bytesSent, bytesRecv } =
            buildMetrics.networkMetrics!.systemNetworkStats!;
          workerNetworkTable.push([
            this.t.t("workerNetworkMetrics.networkTraffic"),
            `${this.t.t("workerNetworkMetrics.sent")}: ${formatBytes(bytesSent)}, ${this.t.t("workerNetworkMetrics.received")}: ${formatBytes(bytesRecv)}`,
          ]);
        }
        if (workerNetworkTable.length > 0)
          console.log(workerNetworkTable.toString());
      }
    }

    // --- Build Tool Logs ---
    if (buildToolLogs) {
      console.log(
        chalk.bold.cyan(`\n--- ${this.t.t("buildToolLogs.title")} ---`),
      );
      buildToolLogs.log.forEach((log) => {
        if (log.contents) {
          try {
            const decoded = Buffer.from(log.contents, "base64").toString(
              "utf-8",
            );
            if (log.name === "critical path") {
              console.log(
                chalk.yellow(
                  `${this.t.t("buildToolLogs.criticalPathSummary")}:`,
                ),
              );
              const criticalPathContent = decoded
                .split("\n")
                .filter((line) => line.trim().length > 0);
              console.log(
                chalk.gray(criticalPathContent.map((l) => `  ${l}`).join("\n")),
              );
            } else {
              console.log(`${chalk.yellow(log.name)}: ${chalk.gray(decoded)}`);
            }
          } catch (e) {}
        } else if (log.uri) {
          console.log(`${chalk.yellow(log.name)}: ${chalk.gray(log.uri)}`);
        }
      });
    }

    // --- Problems & Failures ---
    if (problems.length > 0) {
      console.log(
        chalk.bold.red(
          `\n--- ${this.t.t("problemsFailures.problemsTitle")} ---`,
        ),
      );
      problems.forEach((p) => console.log(chalk.red(`- ${p.message}`)));
    }

    if (failedTargets.length > 0) {
      console.log(
        chalk.bold.red(
          `\n--- ${this.t.t("problemsFailures.failedTargetsTitle")} ---`,
        ),
      );
      failedTargets.forEach((target) => {
        const config = target.configId
          ? configurations.get(target.configId)
          : null;
        const configInfo = config ? chalk.gray(` (${config.mnemonic})`) : "";
        console.log(chalk.red(`- ${target.label}${configInfo}`));
      });
    }

    // --- Action Details ---
    if (actionDetails !== "none") {
      const actionsToDetail =
        actionDetails === "all" ? actions : actions.filter((a) => !a.success);

      if (actionsToDetail.length > 0) {
        const title =
          actionDetails === "all"
            ? this.t.t("actionDetails.titleAll")
            : this.t.t("actionDetails.titleFailed");
        console.log(chalk.bold.cyan(`\n--- ${title} ---`));
        const groupedActions = new Map<string, Action[]>();
        actionsToDetail.forEach((action) => {
          const key = action.label || "Unknown Label";
          if (!groupedActions.has(key)) groupedActions.set(key, []);
          groupedActions.get(key)!.push(action);
        });

        groupedActions.forEach((actions, label) => {
          const anyFailed = actions.some((a) => !a.success);
          const statusText = anyFailed
            ? this.t.t("actionDetails.statusFailure")
            : this.t.t("actionDetails.statusSuccess");
          const status = anyFailed
            ? chalk.red.bold(`❌ ${statusText}`)
            : chalk.green.bold(`✔ ${statusText}`);
          const countLabel =
            actions.length > 1
              ? this.t.t("actionDetails.actionCountPlural")
              : this.t.t("actionDetails.actionCount");
          console.log(
            `\n${chalk.bold.white(`${status} | ${label} (${actions.length} ${countLabel})`)}`,
          );

          actions.sort(
            (a, b) =>
              parseInt(
                b.actionResult?.executionInfo.wallTimeMillis || "0",
                10,
              ) -
              parseInt(a.actionResult?.executionInfo.wallTimeMillis || "0", 10),
          );

          actions.forEach((action, index) => {
            const duration = formatDuration(
              parseInt(
                action.actionResult?.executionInfo.wallTimeMillis || "0",
                10,
              ),
            );
            console.log(
              `  [${index + 1}] ${this.t.t("actionDetails.type")}: ${chalk.blue(action.mnemonic)} | ${this.t.t("actionDetails.duration")}: ${chalk.yellow(duration)}`,
            );

            if (action.primaryOutput?.uri) {
              const outputPath = action.primaryOutput.uri.replace(
                "file://",
                "",
              );
              console.log(
                chalk.yellow(`    ${this.t.t("actionDetails.primaryOutput")}:`),
              );
              console.log(chalk.gray(`      ${outputPath}`));
            }

            if (action.argv && action.argv.length > 0) {
              const command = action.argv.join(" ");
              let displayedCommand: string;

              if (this.wideLevel >= 2) {
                // -ww
                displayedCommand = command;
              } else if (this.wideLevel === 1) {
                // -w
                displayedCommand =
                  command.length > 500
                    ? `${command.substring(0, 500)}...`
                    : command;
              } else {
                // default
                displayedCommand =
                  command.length > 200
                    ? `${command.substring(0, 200)}...`
                    : command;
              }

              console.log(
                chalk.yellow(`    ${this.t.t("actionDetails.commandLine")}:`),
              );
              console.log(chalk.gray(`      ${displayedCommand}`));
            }
            if (action.stderrContent && action.stderrContent.trim()) {
              console.log(
                chalk.yellow(`    ${this.t.t("actionDetails.stderr")}:`),
              );
              console.log(
                chalk.white(
                  action.stderrContent
                    .trim()
                    .split("\n")
                    .map((line) => `      ${line}`)
                    .join("\n"),
                ),
              );
            }
          });
        });
      }
    }

    // --- Test Summary ---
    if (testSummaries.length > 0) {
      console.log(
        chalk.bold.cyan(`\n--- ${this.t.t("testSummary.title")} ---`),
      );
      const table = new Table({
        head: [
          this.t.t("testSummary.target"),
          this.t.t("testSummary.status"),
          this.t.t("testSummary.total"),
          this.t.t("testSummary.passed"),
          this.t.t("testSummary.failed"),
        ],
        colWidths: [40, 15, 10, 10, 10],
      });
      testSummaries.forEach((summary) => {
        const status =
          summary.overallStatus === "PASSED"
            ? chalk.green(summary.overallStatus)
            : chalk.red(summary.overallStatus);
        table.push([
          summary.label,
          status,
          summary.totalRunCount,
          chalk.green(summary.passed?.length || 0),
          chalk.red(summary.failed?.length || 0),
        ]);
      });
      console.log(table.toString());
    }

    // --- Top 10 Slowest Actions ---
    if (actions.length > 0) {
      console.log(
        chalk.bold.cyan(`\n--- ${this.t.t("slowestActions.title")} ---`),
      );

      let colWidths: (number | null)[];
      if (this.wideLevel >= 2) {
        // -ww
        colWidths = [12, 20, null]; // Let the last column auto-size
      } else if (this.wideLevel === 1) {
        // -w
        colWidths = [12, 20, 100];
      } else {
        // default
        colWidths = [12, 20, 60];
      }

      const table = new Table({
        head: [
          this.t.t("slowestActions.duration"),
          this.t.t("slowestActions.actionType"),
          this.t.t("slowestActions.outputTarget"),
        ],
        colWidths,
      });

      actions.sort(
        (a, b) =>
          parseInt(b.actionResult?.executionInfo.wallTimeMillis || "0", 10) -
          parseInt(a.actionResult?.executionInfo.wallTimeMillis || "0", 10),
      );
      actions.slice(0, 10).forEach((action) => {
        table.push([
          chalk.yellow(
            formatDuration(
              parseInt(
                action.actionResult?.executionInfo.wallTimeMillis || "0",
                10,
              ),
            ),
          ),
          action.mnemonic,
          action.primaryOutput?.uri.replace("file://", "") ||
            action.label ||
            "N/A",
        ]);
      });
      console.log(table.toString());
    }

    // --- Build Outputs (Resolved at the end) ---
    if (resolvedOutputs.size > 0) {
      console.log(
        chalk.bold.cyan(`\n--- ${this.t.t("buildOutputs.title")} ---`),
      );
      const outputsTable = new Table({
        head: [this.t.t("buildOutputs.target"), this.t.t("buildOutputs.files")],
        style: { head: ["cyan"] },
        colWidths: [40, 60],
        wordWrap: true,
      });
      resolvedOutputs.forEach((files, target) => {
        outputsTable.push([target, files.join("\n")]);
      });
      console.log(outputsTable.toString());
    }

    // --- Convenience Symlinks ---
    if (convenienceSymlinks.length > 0) {
      console.log(
        chalk.bold.cyan(`\n--- ${this.t.t("convenienceSymlinks.title")} ---`),
      );
      const symlinksTable = new Table({
        head: [
          this.t.t("convenienceSymlinks.path"),
          this.t.t("convenienceSymlinks.action"),
          this.t.t("convenienceSymlinks.target"),
        ],
        style: { head: ["cyan"] },
      });
      convenienceSymlinks.forEach((link) => {
        const action =
          link.action === "CREATE"
            ? chalk.green(link.action)
            : chalk.red(link.action);
        symlinksTable.push([link.path, action, link.target || ""]);
      });
      console.log(symlinksTable.toString());
    }
  }
}
