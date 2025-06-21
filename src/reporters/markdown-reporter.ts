import { ReportData, Action } from "../types";
import { Translator } from "../i18n/translator";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
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

function mdCode(text: string | undefined | null): string {
  if (text === null || text === undefined) return "`N/A`";
  return `\`${String(text).replace(/`/g, "\\`")}\``;
}

export class MarkdownReporter {
  private output: string[] = [];

  constructor(
    private data: ReportData,
    private wideLevel: number,
    private t: Translator,
  ) {}

  private a(line: string): void {
    this.output.push(line);
  }

  public getReport(): string {
    this.generate();
    return this.output.join("\n");
  }

  private generate(): void {
    const {
      buildStarted,
      buildFinished,
      buildMetrics,
      actions,
      problems,
      failedTargets,
      workspaceStatus,
      configurations,
      optionsParsed,
      buildPatterns,
      resolvedOutputs,
    } = this.data;

    if (!buildStarted || !buildFinished) {
      this.a(`# ${this.t.t("buildSummary.title")} - Error`);
      this.a("");
      this.a(
        "**Error: Build start or finish event not found. The BEP file may be incomplete or invalid.**",
      );
      return;
    }

    this.a(`# ${this.t.t("buildSummary.title")}`);
    this.a("");

    const success = buildFinished.overallSuccess;
    const exitCodeName =
      buildFinished.exitCode?.name ||
      (success
        ? this.t.t("buildSummary.exitCodeSuccess")
        : this.t.t("buildSummary.exitCodeFailure"));
    this.a(
      `- **${this.t.t("buildSummary.status")}**: ${success ? "✅" : "❌"} ${exitCodeName}`,
    );
    const startTime = parseInt(buildStarted.startTimeMillis, 10);
    const finishTime = parseInt(buildFinished.finishTimeMillis, 10);
    this.a(
      `- **${this.t.t("buildSummary.totalTime")}**: ${formatDuration(finishTime - startTime)}`,
    );
    if (buildMetrics?.timingMetrics) {
      this.a(
        `  - **${this.t.t("buildSummary.analysisPhase")}**: ${formatDuration(Number(buildMetrics.timingMetrics.analysisPhaseTimeInMs))}`,
      );
      this.a(
        `  - **${this.t.t("buildSummary.executionPhase")}**: ${formatDuration(Number(buildMetrics.timingMetrics.executionPhaseTimeInMs))}`,
      );
    }
    this.a("");

    this.a(`## ${this.t.t("buildEnv.title")}`);
    this.a("");
    this.a(
      `**${this.t.t("buildEnv.command")}**: ${mdCode(buildStarted.command)}`,
    );
    if (buildPatterns.length > 0) {
      this.a(
        `**${this.t.t("buildEnv.targets")}**: ${mdCode(buildPatterns.join(", "))}`,
      );
    }
    this.a("");
    if (workspaceStatus) {
      this.a("| Key | Value |");
      this.a("|---|---|");
      workspaceStatus.item.forEach((item) => {
        this.a(`| ${mdCode(item.key)} | ${mdCode(item.value)} |`);
      });
      this.a("");
    }
    if (
      optionsParsed?.explicitCmdLine &&
      optionsParsed.explicitCmdLine.length > 0
    ) {
      this.a(`### ${this.t.t("buildEnv.explicitOptions")}`);
      this.a("```");
      optionsParsed.explicitCmdLine.forEach((opt) => this.a(opt));
      this.a("```");
      this.a("");
    }

    if (buildMetrics) {
      this.a(`## ${this.t.t("performanceMetrics.title")}`);
      this.a("");
      this.a(`| Metric | Value |`);
      this.a(`|---|---|`);
      this.a(`| **${this.t.t("performanceMetrics.executionCaching")}** | |`);
      this.a(
        `| ${this.t.t("performanceMetrics.actionsCreated")} | ${formatNumber(buildMetrics.actionSummary.actionsCreated || "N/A")} |`,
      );
      this.a(
        `| ${this.t.t("performanceMetrics.actionsExecuted")} | ${formatNumber(buildMetrics.actionSummary.actionsExecuted)} |`,
      );
      if (buildMetrics.actionSummary.actionCacheStatistics) {
        const stats = buildMetrics.actionSummary.actionCacheStatistics;
        const misses = stats.missDetails.reduce(
          (s, d) => s + (Number(d.count) || 0),
          0,
        );
        const hits = Number(
          buildMetrics.artifactMetrics?.outputArtifactsFromActionCache?.count ||
            stats.hits ||
            0,
        );
        const totalLookups = hits + misses;
        const hitRate =
          totalLookups > 0 ? ((hits / totalLookups) * 100).toFixed(2) : "0.00";
        this.a(
          `| ${this.t.t("performanceMetrics.actionCache")} | ${hitRate}% ${this.t.t("performanceMetrics.actionCacheHit")} |`,
        );
      }
      if (buildMetrics.memoryMetrics) {
        this.a(`| **${this.t.t("performanceMetrics.memoryUsage")}** | |`);
        if (buildMetrics.memoryMetrics.peakPostGcHeapSize)
          this.a(
            `| ${this.t.t("performanceMetrics.peakHeap")} | ${formatBytes(buildMetrics.memoryMetrics.peakPostGcHeapSize)} |`,
          );
        if (buildMetrics.memoryMetrics.usedHeapSizePostBuild)
          this.a(
            `| ${this.t.t("performanceMetrics.usedHeapPostBuild")} | ${formatBytes(buildMetrics.memoryMetrics.usedHeapSizePostBuild)} |`,
          );
      }
      this.a("");

      // FIX: Added a robust check for missDetails to satisfy TypeScript's strict null checks.
      const missDetails =
        buildMetrics?.actionSummary?.actionCacheStatistics?.missDetails;
      if (missDetails && missDetails.length > 0) {
        this.a(`<div class="info-card">`);
        this.a(`<h3>${this.t.t("performanceMetrics.cacheMissBreakdown")}</h3>`);
        this.a(`<div class="info-card-content">`);
        this.a(
          `<p>${this.t.t("performanceMetrics.cacheMissReason.explanation")}</p>`,
        );
        this.a("| Reason | Count |");
        this.a("|---|---|");
        missDetails
          .filter((d) => Number(d.count) > 0)
          .sort((a, b) => Number(b.count) - Number(a.count))
          .filter((detail) => detail.reason != undefined)
          .forEach((detail) => {
            const pascalCaseReason = detail
              .reason!.replace(/_/g, " ")
              .toLowerCase()
              .replace(/(?:^|\s)\S/g, (a) => a.toUpperCase())
              .replace(/\s/g, "");
            const reasonKey = `performanceMetrics.cacheMissReason.${pascalCaseReason}`;
            const reason = this.t.t(reasonKey, { reason: detail.reason! });
            this.a(`| ${reason} | ${formatNumber(detail.count ?? 0)} |`);
          });
        this.a(`</div></div>`);
        this.a("");
      }
    }

    if (buildMetrics?.buildGraphMetrics?.builtValues) {
      this.a(`<div class="info-card">`);
      this.a(`<h3>${this.t.t("buildGraphMetrics.topSkyFunctions")}</h3>`);
      this.a(`<div class="info-card-content">`);
      this.a(`<p>${this.t.t("buildGraphMetrics.skyFunctionsExplanation")}</p>`);
      this.a(
        `| ${this.t.t("buildGraphMetrics.skyFunction")} | ${this.t.t("buildGraphMetrics.evalCount")} |`,
      );
      this.a("|---|---|");
      buildMetrics.buildGraphMetrics.builtValues
        .sort((a, b) => Number(b.count) - Number(a.count))
        .slice(0, 10)
        .forEach((v) => {
          this.a(`| ${mdCode(v.skyfunctionName)} | ${formatNumber(v.count)} |`);
        });
      this.a(`</div></div>`);
      this.a("");
    }

    if (actions.length > 0) {
      this.a(`## ${this.t.t("slowestActions.title")}`);
      this.a("");
      this.a(
        `| ${this.t.t("slowestActions.duration")} | ${this.t.t("slowestActions.actionType")} | ${this.t.t("slowestActions.outputTarget")} |`,
      );
      this.a("|---|---|---|");
      actions.sort(
        (a, b) =>
          parseInt(b.actionResult?.executionInfo.wallTimeMillis || "0", 10) -
          parseInt(a.actionResult?.executionInfo.wallTimeMillis || "0", 10),
      );
      actions.slice(0, 10).forEach((action) => {
        this.a(
          `| ${formatDuration(parseInt(action.actionResult?.executionInfo.wallTimeMillis || "0", 10))} | ${mdCode(action.mnemonic)} | ${mdCode(action.primaryOutput?.uri.replace("file://", "") || action.label)} |`,
        );
      });
      this.a("");
    }

    if (problems.length > 0 || failedTargets.length > 0) {
      this.a(`## ${this.t.t("problemsFailures.problemsTitle")}`);
      this.a("");
      problems.forEach((p) => this.a(`- **Error**: ${mdCode(p.message)}`));
      failedTargets.forEach((target) => {
        const config = target.configId
          ? configurations.get(target.configId)
          : null;
        const configInfo = config ? ` (${config.mnemonic})` : "";
        this.a(`- ❌ ${mdCode(target.label + configInfo)}`);
      });
      this.a("");
    }

    if (resolvedOutputs.size > 0) {
      this.a(`## ${this.t.t("buildOutputs.title")}`);
      this.a("");
      resolvedOutputs.forEach((files, target) => {
        this.a(`### ${mdCode(target)}`);
        this.a("```");
        files.forEach((f) => this.a(f));
        this.a("```");
        this.a("");
      });
    }

    if (this.data.actionDetails !== "none") {
      const actionsToDetail =
        this.data.actionDetails === "all"
          ? actions
          : actions.filter((a) => !a.success);

      if (actionsToDetail.length > 0) {
        const title =
          this.data.actionDetails === "all"
            ? this.t.t("actionDetails.titleAll")
            : this.t.t("actionDetails.titleFailed");
        this.a(`## ${title}`);
        this.a(`<div id="search-box-placeholder"></div>`); // Placeholder for JS to inject the search box
        this.a("");

        const groupedActions = new Map<string, Action[]>();
        actionsToDetail.forEach((action) => {
          const key = action.label || "Unknown Label";
          if (!groupedActions.has(key)) groupedActions.set(key, []);
          groupedActions.get(key)!.push(action);
        });

        groupedActions.forEach((actions, label) => {
          const anyFailed = actions.some((a) => !a.success);
          const statusIcon = anyFailed ? "❌" : "✔";

          const failedCount = actions.filter((a) => !a.success).length;
          const totalDuration = actions.reduce(
            (sum, a) =>
              sum +
              parseInt(a.actionResult?.executionInfo.wallTimeMillis || "0", 10),
            0,
          );

          const headerStats = [
            `<span class="stat-badge">${this.t.t("actionDetails.badgeActions", { count: actions.length })}</span>`,
            failedCount > 0
              ? `<span class="stat-badge failed">${this.t.t("actionDetails.badgeFailed", { count: failedCount })}</span>`
              : "",
            `<span class="stat-badge">${this.t.t("actionDetails.badgeTotalTime")}: ${formatDuration(totalDuration)}</span>`,
          ]
            .filter(Boolean)
            .join("");

          this.a(`<div class="action-group">`);
          this.a(`  <div class="action-group-header">`);
          this.a(
            `    <div class="header-label">${statusIcon} ${mdCode(label)}</div>`,
          );
          this.a(`    <div class="header-stats">${headerStats}</div>`);
          this.a(`  </div>`);
          this.a(`  <div class="action-group-content">`);

          actions.sort(
            (a, b) =>
              parseInt(
                b.actionResult?.executionInfo.wallTimeMillis || "0",
                10,
              ) -
              parseInt(a.actionResult?.executionInfo.wallTimeMillis || "0", 10),
          );

          actions.forEach((action) => {
            const actionStatusIcon = action.success ? "✔" : "❌";
            const duration = formatDuration(
              parseInt(
                action.actionResult?.executionInfo.wallTimeMillis || "0",
                10,
              ),
            );
            const primaryOutput =
              action.primaryOutput?.uri.replace("file://", "") ||
              action.label ||
              "N/A";

            const summary = `${actionStatusIcon} <strong>${action.mnemonic}</strong> | ${duration} | ${mdCode(primaryOutput)}`;

            this.a(`<details>`);
            this.a(`  <summary>${summary}</summary>`);
            this.a(`  <div class="details-content">`);
            this.a(``);

            if (action.argv && action.argv.length > 0) {
              this.a(`- **${this.t.t("actionDetails.commandLine")}:**`);
              this.a("  ```sh");
              this.a("  " + action.argv.join(" "));
              this.a("  ```");
            }
            if (action.stderrContent && action.stderrContent.trim()) {
              this.a(`- **${this.t.t("actionDetails.stderr")}:**`);
              this.a("  ```");
              this.a(
                "  " + action.stderrContent.trim().split("\n").join("\n  "),
              );
              this.a("  ```");
            }
            this.a(``);
            this.a(`  </div>`);
            this.a(`</details>`);
          });
          this.a(`  </div>`);
          this.a(`</div>`);
          this.a(``);
        });
      }
    }
  }
}
