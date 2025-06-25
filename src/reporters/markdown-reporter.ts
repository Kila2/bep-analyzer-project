import { ReportData, Action } from "../types";
import { Translator } from "../i18n/translator";
import { actionCacheStatistics_MissReasonToJSON } from "../proto/generated/src/main/protobuf/action_cache";

// Helper class for building Markdown content
class MarkdownBuilder {
  private output: string[] = [];

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(2)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = (seconds % 60).toFixed(0).padStart(2, "0");
    return `${minutes}m ${remainingSeconds}s`;
  }

  private formatNumber(num: number | string): string {
    return Number(num).toLocaleString();
  }

  private formatBytes(bytes: number | string): string {
    const num = Number(bytes);
    if (num === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(num) / Math.log(k));
    return parseFloat((num / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  private formatDate(ms: number, lang: "en" | "zh"): string {
    const locale = lang === "zh" ? "zh-CN" : "en-US";
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
      return new Date(ms).toLocaleString();
    }
  }

  private mdCode(text: string | undefined | null): string {
    if (text === null || text === undefined) return "`N/A`";
    // Replace backticks with single quotes to avoid breaking markdown code spans.
    const cleanedText = String(text).replace(/`/g, "'");
    return `\`${cleanedText}\``;
  }

  constructor(
    private data: ReportData,
    private t: Translator,
  ) {}

  private a(line: string = ""): void {
    this.output.push(line);
  }

  private h1(titleKey: string): void {
    this.a(`# ${this.t.t(titleKey)}`);
    this.a();
  }

  private h2(titleKey: string): void {
    this.a(`## ${this.t.t(titleKey)}`);
    this.a();
  }

  private h3(title: string): void {
    this.a(`### ${title}`);
    this.a();
  }

  private infoCard(explanationKey: string): void {
    const explanation = this.t.t(explanationKey);
    if (explanation && explanation.startsWith(">")) {
      this.a("---");
      this.a(explanation);
      this.a("---");
      this.a();
    }
  }

  public build(): string {
    const { buildStarted, buildFinished } = this.data;

    if (!buildStarted || !buildFinished) {
      this.h1("buildSummary.title");
      this.a(
        "**Error: Build start or finish event not found. The BEP file may be incomplete or invalid.**",
      );
      return this.output.join("\n");
    }

    this.buildSummary();
    this.buildEnvironment();
    this.buildPerformance();
    this.buildArtifacts();
    this.buildGraph();
    this.buildWorkerAndNetwork();
    this.buildSlowestActions();
    this.buildProblems();
    this.buildOutputs();
    this.buildActionDetails();

    return this.output.join("\n");
  }

  private buildSummary(): void {
    this.h1("buildSummary.title");
    const { buildStarted, buildFinished, buildMetrics } = this.data;
    const success = buildFinished!.overallSuccess;
    const exitCodeName =
      buildFinished!.exitCode?.name ||
      (success
        ? this.t.t("buildSummary.exitCodeSuccess")
        : this.t.t("buildSummary.exitCodeFailure"));
    const startTime = parseInt(buildStarted!.startTimeMillis, 10);
    const finishTime = parseInt(buildFinished!.finishTimeMillis, 10);

    this.a(
      `- **${this.t.t("buildSummary.status")}**: ${success ? "✅" : "❌"} ${exitCodeName}`,
    );
    this.a(
      `- **${this.t.t("buildSummary.buildTime")}**: ${this.formatDate(startTime, this.t.getLanguage())}`,
    );
    this.a(
      `- **${this.t.t("buildSummary.totalTime")}**: ${this.formatDuration(finishTime - startTime)}`,
    );
    if (buildMetrics?.timingMetrics) {
      this.a(
        `  - **${this.t.t("buildSummary.analysisPhase")}**: ${this.formatDuration(Number(buildMetrics.timingMetrics.analysisPhaseTimeInMs))}`,
      );
      this.a(
        `  - **${this.t.t("buildSummary.executionPhase")}**: ${this.formatDuration(Number(buildMetrics.timingMetrics.executionPhaseTimeInMs))}`,
      );
    }
    this.a();
  }

  private buildEnvironment(): void {
    this.h2("buildEnv.title");
    const {
      buildStarted,
      buildPatterns,
      workspaceStatus,
      optionsParsed,
      structuredCommandLine,
    } = this.data;

    this.a(
      `**${this.t.t("buildEnv.command")}**: ${this.mdCode(buildStarted!.command)}`,
    );
    if (buildPatterns.length > 0) {
      this.a(
        `**${this.t.t("buildEnv.targets")}**: ${this.mdCode(buildPatterns.join(", "))}`,
      );
    }
    this.a();

    if (workspaceStatus) {
      this.a("| Key | Value |");
      this.a("|---|---|");
      const timestampItem = workspaceStatus.item.find(
        (item) => item.key === "BUILD_TIMESTAMP",
      );
      workspaceStatus.item.forEach((item) => {
        let value = item.value;
        if (item.key === "FORMATTED_DATE" && timestampItem) {
          const timestamp = parseInt(timestampItem.value, 10) * 1000;
          value = this.formatDate(timestamp, this.t.getLanguage());
        }
        this.a(`| ${this.mdCode(item.key)} | ${this.mdCode(value)} |`);
      });
      this.a();
    }
    if (
      optionsParsed?.explicitCmdLine &&
      optionsParsed.explicitCmdLine.length > 0
    ) {
      this.h3(this.t.t("buildEnv.explicitOptions"));
      this.a("```");
      optionsParsed.explicitCmdLine.forEach((opt) => this.a(opt));
      this.a("```");
      this.a();
    }
    if (structuredCommandLine) {
      const cmd = structuredCommandLine.sections
        .flatMap(
          (s) =>
            s.chunkList?.chunk ||
            s.optionList?.option.map((o) => o.combinedForm) ||
            [],
        )
        .join(" ");
      this.h3(this.t.t("buildEnv.canonicalCommandLine"));
      this.a("```sh");
      this.a(cmd);
      this.a("```");
      this.a();
    }
  }

  private buildPerformance(): void {
    const { buildMetrics } = this.data;
    if (!buildMetrics?.actionSummary) return;

    this.h2("performanceMetrics.title");
    this.a("| Metric | Value |");
    this.a("|---|---|");
    this.a(
      `| ${this.t.t("performanceMetrics.actionsCreated")} | ${this.formatNumber(buildMetrics.actionSummary.actionsCreated || "N/A")} |`,
    );
    this.a(
      `| ${this.t.t("performanceMetrics.actionsExecuted")} | ${this.formatNumber(buildMetrics.actionSummary.actionsExecuted)} |`,
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
      const total = hits + misses;
      const hitRate = total > 0 ? ((hits / total) * 100).toFixed(2) : "0.00";
      this.a(
        `| ${this.t.t("performanceMetrics.actionCache")} | ${hitRate}% hits (${this.formatNumber(hits)} / ${this.formatNumber(total)}) |`,
      );
    }
    if (buildMetrics.memoryMetrics) {
      if (buildMetrics.memoryMetrics.peakPostGcHeapSize)
        this.a(
          `| ${this.t.t("performanceMetrics.peakHeap")} | ${this.formatBytes(buildMetrics.memoryMetrics.peakPostGcHeapSize)} |`,
        );
    }
    this.a();

    const missDetails =
      buildMetrics.actionSummary.actionCacheStatistics?.missDetails;
    if (missDetails && missDetails.length > 0) {
      this.h2("performanceMetrics.cacheMissBreakdown");
      this.infoCard("performanceMetrics.cacheMissReason.explanation");
      this.a("| Reason | Count |");
      this.a("|---|---|");
      missDetails
        .filter((d) => (d.count ?? 0) > 0)
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
        .forEach((d) => {
          const reasonString = actionCacheStatistics_MissReasonToJSON(d.reason);
          const pascalCaseReason = reasonString
            .replace(/_/g, " ")
            .toLowerCase()
            .replace(/(?:^|\s)\S/g, (a: string) => a.toUpperCase())
            .replace(/\s/g, "");
          const reasonKey = `performanceMetrics.cacheMissReason.${pascalCaseReason}`;
          const reason = this.t.t(reasonKey, { reason: reasonString });
          this.a(`| ${reason} | ${this.formatNumber(d.count ?? 0)} |`);
        });
      this.a();
    }

    if (buildMetrics.memoryMetrics?.garbageMetrics) {
      this.h2("performanceMetrics.gcByType");
      this.infoCard("performanceMetrics.gcExplanation");
      this.a("| Type | Collected |");
      this.a("|---|---|");
      buildMetrics.memoryMetrics.garbageMetrics.forEach((m) => {
        const originalType = m.type;
        const pascalCaseType = originalType.replace(/[^a-zA-Z0-9]/g, "");
        const typeKey = `performanceMetrics.gcType.${pascalCaseType}`;
        const translatedType = this.t.t(typeKey);

        let displayType =
          translatedType !== typeKey && this.t.getLanguage() === "zh"
            ? `${translatedType} (${originalType})`
            : originalType;

        this.a(`| ${displayType} | ${this.formatBytes(m.garbageCollected)} |`);
      });
      this.a();
    }
  }

  private buildArtifacts(): void {
    const { buildMetrics } = this.data;
    if (!buildMetrics?.artifactMetrics) return;

    this.h2("artifactMetrics.title");
    const { sourceArtifactsRead, outputArtifactsSeen, topLevelArtifacts } =
      buildMetrics.artifactMetrics;
    this.a(
      `| ${this.t.t("artifactMetrics.metric")} | ${this.t.t("artifactMetrics.count")} | ${this.t.t("artifactMetrics.size")} |`,
    );
    this.a("|---|---|---|");
    if (sourceArtifactsRead) {
      this.a(
        `| ${this.t.t("artifactMetrics.sourceRead")} | ${this.formatNumber(sourceArtifactsRead.count)} | ${this.formatBytes(sourceArtifactsRead.sizeInBytes)} |`,
      );
    }
    if (outputArtifactsSeen) {
      this.a(
        `| ${this.t.t("artifactMetrics.outputSeen")} | ${this.formatNumber(outputArtifactsSeen.count)} | ${this.formatBytes(outputArtifactsSeen.sizeInBytes)} |`,
      );
    }
    if (topLevelArtifacts)
      this.a(
        `| ${this.t.t("artifactMetrics.topLevel")} | ${this.formatNumber(topLevelArtifacts.count)} | ${this.formatBytes(topLevelArtifacts.sizeInBytes)} |`,
      );
    this.a();
  }

  private buildGraph(): void {
    const { buildMetrics } = this.data;
    if (!buildMetrics?.buildGraphMetrics) return;

    this.h2("buildGraphMetrics.title");
    const { actionCount, outputArtifactCount, builtValues } =
      buildMetrics.buildGraphMetrics;
    this.a(`| Metric | Value |`);
    this.a(`|---|---|`);
    this.a(
      `| ${this.t.t("buildGraphMetrics.totalActions")} | ${this.formatNumber(actionCount)} |`,
    );
    this.a(
      `| ${this.t.t("buildGraphMetrics.totalOutputs")} | ${this.formatNumber(outputArtifactCount)} |`,
    );
    this.a();

    if (builtValues && builtValues.length > 0) {
      this.h3(this.t.t("buildGraphMetrics.topSkyFunctions"));
      this.infoCard("buildGraphMetrics.skyFunctionsExplanation");
      this.a(
        `| ${this.t.t("buildGraphMetrics.skyFunction")} | ${this.t.t("buildGraphMetrics.evalCount")} |`,
      );
      this.a("|---|---|");
      builtValues
        .sort((a, b) => Number(b.count) - Number(a.count))
        .slice(0, 10)
        .forEach((v) => {
          this.a(
            `| ${this.mdCode(v.skyfunctionName)} | ${this.formatNumber(v.count)} |`,
          );
        });
      this.a();
    }
  }

  private buildWorkerAndNetwork(): void {
    const { buildMetrics } = this.data;
    if (!buildMetrics) return;

    const hasWorker =
      buildMetrics.workerMetrics && buildMetrics.workerMetrics.length > 0;
    const hasNetwork =
      buildMetrics.networkMetrics &&
      buildMetrics.networkMetrics.systemNetworkStats;

    if (!hasWorker && !hasNetwork) return;

    this.h2("workerNetworkMetrics.title");
    this.infoCard("workerNetworkMetrics.explanation");
    this.a(`| Metric | Value |`);
    this.a(`|---|---|`);
    if (hasWorker) {
      const totalActions = buildMetrics.workerMetrics!.reduce(
        (sum, w) => sum + Number(w.actionsExecuted),
        0,
      );
      this.a(
        `| ${this.t.t("workerNetworkMetrics.totalWorkerActions")} | ${this.formatNumber(totalActions)} |`,
      );
    }
    if (hasNetwork) {
      const { bytesSent, bytesRecv } =
        buildMetrics.networkMetrics!.systemNetworkStats!;
      const traffic = `${this.t.t("workerNetworkMetrics.sent")}: ${this.formatBytes(bytesSent)}, ${this.t.t("workerNetworkMetrics.received")}: ${this.formatBytes(bytesRecv)}`;
      this.a(
        `| ${this.t.t("workerNetworkMetrics.networkTraffic")} | ${traffic} |`,
      );
    }
    this.a();
  }

  private buildSlowestActions(): void {
    const { actions } = this.data;
    if (actions.length === 0) return;

    this.h2("slowestActions.title");
    this.a(
      `| ${this.t.t("slowestActions.duration")} | ${this.t.t("slowestActions.actionType")} | Strategy | ${this.t.t("slowestActions.outputTarget")} |`,
    );
    this.a("|---|---|---|---|");
    actions
      .slice()
      .sort(
        (a, b) =>
          parseInt(b.actionResult?.executionInfo.wallTimeMillis || "0", 10) -
          parseInt(a.actionResult?.executionInfo.wallTimeMillis || "0", 10),
      )
      .slice(0, 10)
      .forEach((action) => {
        const output =
          action.primaryOutput?.uri?.replace("file://", "") || action.label;
        this.a(
          `| ${this.formatDuration(parseInt(action.actionResult?.executionInfo.wallTimeMillis || "0", 10))} | ${this.mdCode(action.mnemonic)} | ${this.mdCode(action.strategy || "N/A")} | ${this.mdCode(output)} |`,
        );
      });
    this.a();
  }

  private buildProblems(): void {
    const { problems, failedTargets, configurations } = this.data;
    if (problems.length === 0 && failedTargets.length === 0) return;

    this.h2("problemsFailures.problemsTitle");
    problems.forEach((p) =>
      this.a(`- **Error**: ${this.mdCode(p.description)}`),
    );
    failedTargets.forEach((target) => {
      const config = target.configId
        ? configurations.get(target.configId)
        : null;
      const configInfo = config ? ` (${config.mnemonic})` : "";
      this.a(`- ❌ ${this.mdCode(target.label + configInfo)}`);
    });
    this.a();
  }

  private buildOutputs(): void {
    const { resolvedOutputs } = this.data;
    if (resolvedOutputs.size === 0) return;

    this.h2("buildOutputs.title");
    resolvedOutputs.forEach((files, target) => {
      this.h3(this.mdCode(target));
      this.a("```");
      files.forEach((f) => this.a(f));
      this.a("```");
      this.a();
    });
  }

  private buildActionDetails(): void {
    const { actions, actionDetails } = this.data;
    if (actionDetails === "none") return;

    const actionsToDetail =
      actionDetails === "all" ? actions : actions.filter((a) => !a.success);
    if (actionsToDetail.length === 0) return;

    const titleKey =
      actionDetails === "all"
        ? "actionDetails.titleAll"
        : "actionDetails.titleFailed";
    this.h2(titleKey);

    actionsToDetail.forEach((action) => {
      const statusIcon = action.success ? "✔" : "❌";
      const duration = this.formatDuration(
        parseInt(action.actionResult?.executionInfo.wallTimeMillis || "0", 10),
      );
      const primaryOutput =
        action.primaryOutput?.uri?.replace("file://", "") ||
        action.label ||
        "N/A";

      this.h3(`${statusIcon} ${this.mdCode(action.mnemonic)}`);
      this.a(
        `- **${this.t.t("actionDetails.primaryOutput")}**: ${this.mdCode(primaryOutput)}`,
      );
      this.a(`- **${this.t.t("actionDetails.duration")}**: ${duration}`);
      if (action.strategy) {
        this.a(`- **Strategy**: ${this.mdCode(action.strategy)}`);
      }

      if (action.argv && action.argv.length > 0) {
        this.a(`<details>`);
        this.a(
          `  <summary><strong>${this.t.t("actionDetails.commandLine")}</strong></summary>`,
        );
        this.a();
        this.a("```sh");
        this.a(action.argv.join(" "));
        this.a("```");
        this.a(`</details>`);
      }
      if (action.stderrContent && action.stderrContent.trim()) {
        this.a(`<details>`);
        this.a(
          `  <summary><strong>${this.t.t("actionDetails.stderr")}</strong></summary>`,
        );
        this.a();
        this.a("```");
        this.a(action.stderrContent.trim());
        this.a("```");
        this.a(`</details>`);
      }
      this.a();
      this.a("---");
      this.a();
    });
  }
}

export class MarkdownReporter {
  constructor(
    private data: ReportData,
    private wideLevel: number, // Keep for constructor consistency, though not used here
    private t: Translator,
  ) {}

  public getReport(): string {
    const builder = new MarkdownBuilder(this.data, this.t);
    return builder.build();
  }
}
