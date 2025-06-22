import { ReportData, Action } from "../types";
import { Translator } from "../i18n/translator";
import AnsiToHtml from "ansi-to-html";
import { marked } from "marked";

export class HtmlReporter {
  private ansiConverter: AnsiToHtml;

  constructor(
    private data: ReportData,
    private wideLevel: number,
    private t: Translator,
  ) {
    this.ansiConverter = new AnsiToHtml({ newline: true, escapeXML: true });
  }

  // --- Helper Methods ---
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

  private escapeAttr(text: string | undefined | null): string {
    if (text === null || text === undefined) return "";
    return String(text)
      .replace(/&/g, "&")
      .replace(/"/g, '"')
      .replace(/</g, "<")
      .replace(/>/g, ">");
  }

  private mdCode(text: string | undefined | null): string {
    if (text === null || text === undefined) return "`N/A`";
    const cleanedText = String(text)
      .replace(/^file:\/\//, "")
      .replace(/`/g, "'");
    return `\`${cleanedText}\``;
  }

  private renderInfoCard(titleKey: string, explanationKey: string): string {
    const title = this.t.t(titleKey);
    const explanation = this.t.t(explanationKey);
    if (!explanation || !explanation.startsWith(">")) return ""; // only render if translation exists and is a blockquote
    return `<div class="info-card">
          <div class="info-card-title">💡 ${this.escapeAttr(title)}</div>
          <div class="info-card-content">${marked.parse(explanation)}</div>
      </div>`;
  }

  // --- Tab Content Builders ---
  private buildReportTab(): string {
    const {
      buildMetrics,
      actions,
      workspaceStatus,
      buildPatterns,
      resolvedOutputs,
      convenienceSymlinks,
      structuredCommandLine,
      optionsParsed,
    } = this.data;

    const buildStarted = this.data.buildStarted!;
    const buildFinished = this.data.buildFinished!;

    let html = "";

    const renderSection = (
      titleKey: string,
      id: string,
      content: string | null,
    ) => {
      if (!content || !content.trim()) return "";
      const title = this.t.t(titleKey);
      return `<div class="report-section"><h2 id="${id}" data-nav-title="${this.escapeAttr(title)}">${this.escapeAttr(title)}</h2>${content}</div>`;
    };

    // Summary
    const startTime = parseInt(buildStarted.startTimeMillis, 10);
    const finishTime = parseInt(buildFinished.finishTimeMillis, 10);
    let summaryMd = `- **${this.t.t("buildSummary.status")}**: ${buildFinished.overallSuccess ? "✅" : "❌"} ${buildFinished.exitCode?.name || (buildFinished.overallSuccess ? "SUCCESS" : "FAILURE")}\n`;
    summaryMd += `- **${this.t.t("buildSummary.buildTime")}**: ${this.formatDate(startTime, this.t.getLanguage())}\n`;
    summaryMd += `- **${this.t.t("buildSummary.totalTime")}**: ${this.formatDuration(finishTime - startTime)}\n`;
    if (buildMetrics?.timingMetrics) {
      summaryMd += `  - **${this.t.t("buildSummary.analysisPhase")}**: ${this.formatDuration(Number(buildMetrics.timingMetrics.analysisPhaseTimeInMs))}\n`;
      summaryMd += `  - **${this.t.t("buildSummary.executionPhase")}**: ${this.formatDuration(Number(buildMetrics.timingMetrics.executionPhaseTimeInMs))}\n`;
    }
    html += renderSection(
      "buildSummary.title",
      "summary",
      marked.parse(summaryMd),
    );

    // Build Environment & Options
    let envContent = "";
    let envDetailsMd = `**${this.t.t("buildEnv.command")}**: ${this.mdCode(buildStarted.command)}\n\n`;
    if (buildPatterns.length > 0) {
      envDetailsMd += `**${this.t.t("buildEnv.targets")}**: ${this.mdCode(buildPatterns.join(", "))}\n\n`;
    }
    envContent += marked.parse(envDetailsMd);

    if (workspaceStatus && workspaceStatus.item.length > 0) {
      let wsMd = `| Key | Value |\n|---|---|\n`;
      const timestampItem = workspaceStatus.item.find(
        (item) => item.key === "BUILD_TIMESTAMP",
      );
      workspaceStatus.item.forEach((item) => {
        let value = item.value;
        if (item.key === "FORMATTED_DATE" && timestampItem) {
          const timestamp = parseInt(timestampItem.value, 10) * 1000;
          value = this.formatDate(timestamp, this.t.getLanguage());
        }
        wsMd += `| ${this.mdCode(item.key)} | ${this.mdCode(value)} |\n`;
      });
      envContent += marked.parse(wsMd);
    }
    if (
      optionsParsed?.explicitCmdLine &&
      optionsParsed.explicitCmdLine.length > 0
    ) {
      envContent += `<h3>${this.t.t("buildEnv.explicitOptions")}</h3><pre><code>${this.escapeAttr(optionsParsed.explicitCmdLine.join("\n"))}</code></pre>`;
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
      envContent += `<h3>${this.t.t("buildEnv.canonicalCommandLine")}</h3><pre><code>${this.escapeAttr(cmd)}</code></pre>`;
    }
    html += renderSection("buildEnv.title", "environment", envContent);

    // Performance
    if (buildMetrics) {
      let perfContent = "";
      let mainPerfMd = `| Metric | Value |\n|---|---|\n`;
      mainPerfMd += `| ${this.t.t("performanceMetrics.actionsCreated")} | ${this.formatNumber(buildMetrics.actionSummary.actionsCreated || "N/A")} |\n`;
      mainPerfMd += `| ${this.t.t("performanceMetrics.actionsExecuted")} | ${this.formatNumber(buildMetrics.actionSummary.actionsExecuted)} |\n`;
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
        mainPerfMd += `| ${this.t.t("performanceMetrics.actionCache")} | ${hitRate}% hits (${this.formatNumber(hits)} / ${this.formatNumber(total)}) |\n`;
      }
      if (buildMetrics.memoryMetrics) {
        if (buildMetrics.memoryMetrics.peakPostGcHeapSize)
          mainPerfMd += `| ${this.t.t("performanceMetrics.peakHeap")} | ${this.formatBytes(buildMetrics.memoryMetrics.peakPostGcHeapSize)} |\n`;
      }
      perfContent += marked.parse(mainPerfMd);

      if (
        buildMetrics.actionSummary.actionCacheStatistics?.missDetails?.length
      ) {
        let missMd = `| Reason | Count |\n|---|---|\n`;
        const missDetails =
          buildMetrics.actionSummary.actionCacheStatistics.missDetails
            .filter((d) => (d.count ?? 0) > 0)
            .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));

        missDetails.forEach((d) => {
          const pascalCaseReason = d
            .reason!.replace(/_/g, " ")
            .toLowerCase()
            .replace(/(?:^|\s)\S/g, (a) => a.toUpperCase())
            .replace(/\s/g, "");
          const reasonKey = `performanceMetrics.cacheMissReason.${pascalCaseReason}`;
          const reason = this.t.t(reasonKey, { reason: d.reason! });
          missMd += `| ${reason} | ${this.formatNumber(d.count ?? 0)} |\n`;
        });
        perfContent += `<details open><summary>${this.t.t("performanceMetrics.cacheMissBreakdown")}</summary><div>
            ${this.renderInfoCard("performanceMetrics.cacheMissBreakdown", "performanceMetrics.cacheMissReason.explanation")}
            ${marked.parse(missMd)}
        </div></details>`;
      }
      if (buildMetrics.memoryMetrics?.garbageMetrics) {
        let gcMd = `| Type | Collected |\n|---|---|\n`;
        buildMetrics.memoryMetrics.garbageMetrics.forEach((m) => {
          const originalType = m.type;
          const pascalCaseType = originalType.replace(/[^a-zA-Z0-9]/g, "");
          const typeKey = `performanceMetrics.gcType.${pascalCaseType}`;
          const translatedType = this.t.t(typeKey);

          let displayType: string;
          if (translatedType !== typeKey) {
            // Translation found
            if (this.t.getLanguage() === "zh") {
              displayType = `${this.escapeAttr(translatedType)} (${this.escapeAttr(originalType)})`;
            } else {
              displayType = this.escapeAttr(translatedType);
            }
          } else {
            // No translation, fallback to original
            displayType = this.escapeAttr(originalType);
          }

          gcMd += `| ${displayType} | ${this.formatBytes(m.garbageCollected)} |\n`;
        });
        perfContent += `<details open><summary>${this.t.t("performanceMetrics.gcByType")}</summary><div>
            ${this.renderInfoCard("performanceMetrics.gcByType", "performanceMetrics.gcExplanation")}
            ${marked.parse(gcMd)}
        </div></details>`;
      }
      html += renderSection(
        "performanceMetrics.title",
        "performance",
        perfContent,
      );
    }

    // Artifacts
    if (buildMetrics?.artifactMetrics) {
      let artifactMd = `| ${this.t.t("artifactMetrics.metric")} | ${this.t.t("artifactMetrics.count")} | ${this.t.t("artifactMetrics.size")} |\n|---|---|---|\n`;
      const { sourceArtifactsRead, outputArtifactsSeen, topLevelArtifacts } =
        buildMetrics.artifactMetrics;
      artifactMd += `| ${this.t.t("artifactMetrics.sourceRead")} | ${this.formatNumber(sourceArtifactsRead.count)} | ${this.formatBytes(sourceArtifactsRead.sizeInBytes)} |\n`;
      artifactMd += `| ${this.t.t("artifactMetrics.outputSeen")} | ${this.formatNumber(outputArtifactsSeen.count)} | ${this.formatBytes(outputArtifactsSeen.sizeInBytes)} |\n`;
      if (topLevelArtifacts)
        artifactMd += `| ${this.t.t("artifactMetrics.topLevel")} | ${this.formatNumber(topLevelArtifacts.count)} | ${this.formatBytes(topLevelArtifacts.sizeInBytes)} |\n`;
      html += renderSection(
        "artifactMetrics.title",
        "artifacts",
        marked.parse(artifactMd),
      );
    }

    // Build Graph
    if (buildMetrics?.buildGraphMetrics) {
      let graphContent = "";
      let graphMd = `| Metric | Value |\n|---|---|\n`;
      const { actionCount, outputArtifactCount, builtValues } =
        buildMetrics.buildGraphMetrics;
      graphMd += `| ${this.t.t("buildGraphMetrics.totalActions")} | ${this.formatNumber(actionCount)} |\n`;
      graphMd += `| ${this.t.t("buildGraphMetrics.totalOutputs")} | ${this.formatNumber(outputArtifactCount)} |\n`;
      graphContent += marked.parse(graphMd);

      if (builtValues && builtValues.length > 0) {
        let skyFunctionsMd = `| ${this.t.t("buildGraphMetrics.skyFunction")} | ${this.t.t("buildGraphMetrics.evalCount")} |\n|---|---|\n`;
        builtValues
          .sort((a, b) => Number(b.count) - Number(a.count))
          .slice(0, 10)
          .forEach((v) => {
            skyFunctionsMd += `| ${this.mdCode(v.skyfunctionName)} | ${this.formatNumber(v.count)} |\n`;
          });
        graphContent += `<details open><summary>${this.t.t("buildGraphMetrics.topSkyFunctions")}</summary><div>
                ${this.renderInfoCard("buildGraphMetrics.topSkyFunctions", "buildGraphMetrics.skyFunctionsExplanation")}
                ${marked.parse(skyFunctionsMd)}
            </div></details>`;
      }
      html += renderSection(
        "buildGraphMetrics.title",
        "graph-metrics",
        graphContent,
      );
    }

    // Worker & Network Metrics
    if (buildMetrics) {
      const hasWorkerMetrics =
        buildMetrics.workerMetrics && buildMetrics.workerMetrics.length > 0;
      const hasNetworkMetrics =
        buildMetrics.networkMetrics &&
        buildMetrics.networkMetrics.systemNetworkStats;
      if (hasWorkerMetrics || hasNetworkMetrics) {
        let wnContent = this.renderInfoCard(
          "workerNetworkMetrics.title",
          "workerNetworkMetrics.explanation",
        );
        let wnMd = `| Metric | Value |\n|---|---|\n`;
        if (hasWorkerMetrics) {
          const totalActions = buildMetrics.workerMetrics!.reduce(
            (sum, w) => sum + Number(w.actionsExecuted),
            0,
          );
          wnMd += `| ${this.t.t("workerNetworkMetrics.totalWorkerActions")} | ${this.formatNumber(totalActions)} |\n`;
        }
        if (hasNetworkMetrics) {
          const { bytesSent, bytesRecv } =
            buildMetrics.networkMetrics!.systemNetworkStats!;
          const traffic = `${this.t.t("workerNetworkMetrics.sent")}: ${this.formatBytes(bytesSent)}, ${this.t.t("workerNetworkMetrics.received")}: ${this.formatBytes(bytesRecv)}`;
          wnMd += `| ${this.t.t("workerNetworkMetrics.networkTraffic")} | ${traffic} |\n`;
        }
        wnContent += marked.parse(wnMd);
        html += renderSection(
          "workerNetworkMetrics.title",
          "worker-network",
          wnContent,
        );
      }
    }

    // Slowest Actions
    if (actions.length > 0) {
      let slowestMd = `| ${this.t.t("slowestActions.duration")} | ${this.t.t("slowestActions.actionType")} | ${this.t.t("slowestActions.outputTarget")} |\n|---|---|---|\n`;
      actions
        .sort(
          (a, b) =>
            parseInt(b.actionResult?.executionInfo.wallTimeMillis || "0", 10) -
            parseInt(a.actionResult?.executionInfo.wallTimeMillis || "0", 10),
        )
        .slice(0, 10)
        .forEach((a) => {
          const outputTarget = a.primaryOutput?.uri || a.label;
          slowestMd += `| ${this.formatDuration(parseInt(a.actionResult?.executionInfo.wallTimeMillis || "0", 10))} | ${this.mdCode(a.mnemonic)} | ${this.mdCode(outputTarget)} |\n`;
        });
      html += renderSection(
        "slowestActions.title",
        "slowest-actions",
        marked.parse(slowestMd),
      );
    }

    // Build Outputs
    if (resolvedOutputs && resolvedOutputs.size > 0) {
      let outputsContent = "";
      resolvedOutputs.forEach((files, target) => {
        outputsContent += `<h3>${this.escapeAttr(target)}</h3>`;
        outputsContent += `<pre><code>${this.escapeAttr(files.join("\n"))}</code></pre>`;
      });
      html += renderSection(
        "buildOutputs.title",
        "build-outputs",
        outputsContent,
      );
    }

    return html;
  }

  private buildActionsTab(): string {
    const { actions } = this.data;
    let html = "";

    if (actions.length > 0) {
      const groupedActions = new Map<string, Action[]>();
      actions.forEach((a) => {
        const key = a.label || "Unknown Label";
        if (!groupedActions.has(key)) groupedActions.set(key, []);
        groupedActions.get(key)!.push(a);
      });

      const copyButtonText = this.t.t("actionDetails.copyButton");
      const copiedButtonText = this.t.t("actionDetails.copiedButton");

      groupedActions.forEach((actionList, label) => {
        const failedCount = actionList.filter((a) => !a.success).length;
        const hasFailures = failedCount > 0;
        html += `<div class="action-group" data-label="${this.escapeAttr(label)}" data-failed="${hasFailures}">`;
        html += `<div class="action-group-summary">`;
        html += `<span class="icon">${hasFailures ? "❌" : "✔"}</span>`;
        html += `<code class="label-code" title="${this.escapeAttr(label)}">${this.escapeAttr(label)}</code>`;
        html += `<span class="action-group-stats">${actionList.length} actions, ${failedCount} failed</span>`;
        html += `</div>`;
        html += `<div class="action-group-content">`;
        actionList
          .sort(
            (a, b) =>
              parseInt(
                b.actionResult?.executionInfo.wallTimeMillis || "0",
                10,
              ) -
              parseInt(a.actionResult?.executionInfo.wallTimeMillis || "0", 10),
          )
          .forEach((action) => {
            const command = action.argv || action.commandLine;
            const stderr = action.stderrContent?.trim();
            const output = (
              action.primaryOutput?.uri ||
              action.label ||
              "N/A"
            ).replace(/^file:\/\//, "");
            const searchContent = `${action.mnemonic} ${output}`;
            html += `<details class="action-item" data-search-content="${this.escapeAttr(searchContent)}"><summary>`;
            html += `<span class="icon">${action.success ? "✅" : "❌"}</span>`;
            html += `<strong>${this.escapeAttr(action.mnemonic)}</strong>`;
            html += `<span class="duration">${this.formatDuration(parseInt(action.actionResult?.executionInfo.wallTimeMillis || "0", 10))}</span>`;
            html += `<code class="output-code" title="${this.escapeAttr(output)}">${this.escapeAttr(output)}</code>`;
            html += `</summary><div class="details-content">`;
            if (command) {
              html += `<h4>${this.t.t("actionDetails.commandLine")}</h4>`;
              html += `<div class="code-block">`;
              html += `<button class="copy-btn" data-copied-text="${copiedButtonText}">${copyButtonText}</button>`;
              html += `<pre>${this.escapeAttr(command.join(" "))}</pre>`;
              html += `</div>`;
            }
            if (stderr) {
              html += `<h4>${this.t.t("actionDetails.stderr")}</h4>`;
              const plainStderr = stderr.replace(
                /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
                "",
              );
              html += `<div class="code-block">`;
              html += `<button class="copy-btn" data-copied-text="${copiedButtonText}">${copyButtonText}</button>`;
              html += `<pre data-copy-content="${this.escapeAttr(plainStderr)}">${this.ansiConverter.toHtml(stderr)}</pre>`;
              html += `</div>`;
            }
            html += `</div></details>`;
          });
        html += `</div></div>`;
      });
    }
    return html;
  }

  public getReport(): string {
    if (!this.data.buildStarted || !this.data.buildFinished) {
      return `Error: Build start or finish event not found.`;
    }
    const reportTabContent = this.buildReportTab();
    const actionsTabContent = this.buildActionsTab();
    return this.template(
      this.t.t("buildSummary.title"),
      reportTabContent,
      actionsTabContent,
    );
  }

  private template(
    title: string,
    reportBody: string,
    actionsBody: string,
  ): string {
    const searchPlaceholder = this.t.t("actionDetails.searchPlaceholder");

    return `<!DOCTYPE html>
<html lang="${this.t.lang}" data-theme="light">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
:root {
    --header-height: 60px;
    --sidebar-width: 240px;
    --bg-color: #fff;
    --fg-color: #24292e;
    --bg-alt: #f6f8fa;
    --border-color: #e1e4e8;
    --accent-color: #0366d6;
    --info-bg: #f1f8ff;
    --info-border: #c8e1ff;
}
html[data-theme='dark'] {
    --bg-color: #0d1117;
    --fg-color: #c9d1d9;
    --bg-alt: #161b22;
    --border-color: #30363d;
    --accent-color: #58a6ff;
    --info-bg: #1f6feb26;
    --info-border: #30363d;
}
body {
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    line-height: 1.5;
    color: var(--fg-color);
    background-color: var(--bg-alt);
    margin: 0;
}
.page-container {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
}
.page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 24px;
    height: var(--header-height);
    background: var(--bg-color);
    border-bottom: 1px solid var(--border-color);
    position: sticky;
    top: 0;
    z-index: 100;
}
.header-left { flex: 1; text-align: left; }
.header-center { flex: 2; display: flex; justify-content: center; }
.header-right { flex: 1; display: flex; justify-content: flex-end; align-items: center; gap: .5rem; }
#action-search {
    width: 100%;
    max-width: 500px;
    font-size: 1rem;
    padding: .5rem 1rem;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background-color: var(--bg-color);
    color: var(--fg-color);
}
.filter-btn {
    font-size: .9rem;
    padding: .5rem 1rem;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: transparent;
    color: var(--fg-color);
    cursor: pointer;
}
.filter-btn.active {
    background: var(--accent-color);
    color: #fff;
    border-color: var(--accent-color);
}
#theme-toggle {
    background: none;
    border: 1px solid var(--border-color);
    border-radius: 50%;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--fg-color);
}
.content-wrapper {
    display: flex;
    flex-grow: 1;
}
#report-nav {
    width: var(--sidebar-width);
    flex-shrink: 0;
    position: sticky;
    top: var(--header-height);
    height: calc(100vh - var(--header-height));
    overflow-y: auto;
    padding: 1.5rem;
    border-right: 1px solid var(--border-color);
    background-color: var(--bg-color);
}
#report-nav ul {
    list-style: none;
    padding: 0;
    margin: 0;
}
#report-nav li a {
    display: block;
    padding: .4rem 1rem;
    color: var(--fg-color);
    text-decoration: none;
    border-radius: 6px;
    border-left: 3px solid transparent;
}
#report-nav li a:hover {
    background-color: var(--bg-alt);
}
#report-nav li a.active {
    background-color: var(--info-bg);
    border-left-color: var(--accent-color);
    font-weight: 600;
}
main {
    flex-grow: 1;
    max-width: calc(100% - var(--sidebar-width));
}
.tab-bar {
    display: flex;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-color);
    padding: 0 24px;
    position: sticky;
    top: var(--header-height);
    z-index: 99;
}
.tab-btn {
    padding: 1rem 1.5rem;
    cursor: pointer;
    border: 0;
    border-bottom: 3px solid transparent;
    background: transparent;
    font-size: 1rem;
    color: var(--fg-color);
}
.tab-btn.active {
    border-bottom-color: var(--accent-color);
    font-weight: 600;
}
.tab-content { display: none; padding: 24px; }
.tab-content.active { display: block; }
.report-section > h2 {
    margin: 2rem 0 1rem;
    padding-top: 1rem;
    border-bottom: 1px solid var(--border-color);
}
.report-section:first-child > h2 { margin-top: 0; }
.report-section h3 { margin-top: 1.5rem; }
details {
    border: 1px solid var(--border-color);
    border-radius: 6px;
    margin-top: 1rem;
    background-color: var(--bg-color);
}
details > summary {
    font-weight: bold;
    padding: .75rem 1rem;
    list-style: none;
    cursor: pointer;
    background-color: var(--bg-alt);
}
details > summary::-webkit-details-marker { display: none; }
details[open] > summary {
    border-bottom: 1px solid var(--border-color);
}
details > div {
    padding: 1rem;
}
table {
    border-collapse: collapse;
    width: 100%;
    margin: 1rem 0;
}
th, td {
    border: 1px solid var(--border-color);
    padding: .6em 1em;
    text-align: left;
    vertical-align: top;
}
th { background-color: var(--bg-alt); }
pre {
    background-color: var(--bg-color);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    padding: 1rem;
    white-space: pre-wrap;
    word-break: break-all;
    overflow-x: auto;
}
code {
    font-family: monospace;
    background-color: rgba(150,150,150,.1);
    border-radius: 6px;
    padding: .2em .4em;
    font-size: 85%;
}
pre > code { padding: 0; background: 0; border: 0; }
.code-block {
    position: relative;
    margin-top: .5rem;
}
.copy-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 1;
    background: var(--bg-alt);
    border: 1px solid var(--border-color);
    color: var(--fg-color);
    padding: 2px 8px;
    font-size: 12px;
    border-radius: 4px;
    cursor: pointer;
    opacity: 0;
    transition: opacity .2s;
}
.code-block:hover .copy-btn { opacity: 1; }
.copy-btn:active { background: var(--border-color); }
.copy-btn[disabled] { opacity: .5; cursor: default; }
.action-group {
    border: 1px solid var(--border-color);
    border-radius: 8px;
    margin-bottom: 4px;
    overflow: hidden;
    background: var(--bg-color);
}
.action-group-summary {
    display: flex;
    gap: .75rem;
    align-items: center;
    padding: .5rem 1rem;
    cursor: pointer;
    background: var(--bg-alt);
}
.action-group-summary:hover { background-color: var(--border-color); }
.action-group-summary > .icon { font-size: 1.2em; flex-shrink: 0; }
.action-group-summary > .label-code {
    flex-grow: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    background-color: var(--bg-color);
    padding: .1em .5em;
    border-radius: 4px;
    border: 1px solid var(--border-color);
    font-size: .9em;
}
.action-group-stats {
    flex-shrink: 0;
    margin-left: auto;
    font-size: .85rem;
    color: #6a737d;
}
.action-group-content {
    display: none;
    border-top: 1px solid var(--border-color);
    padding: .5rem;
}
.action-item { border-bottom: 1px solid var(--border-color); }
.action-item:last-child { border-bottom: none; }
.action-item summary {
    display: flex;
    gap: .75rem;
    align-items: center;
    cursor: pointer;
    padding: .4rem .5rem;
}
.action-item summary:hover { background: var(--bg-alt); }
.action-item summary > .icon { flex-shrink: 0; }
.action-item summary > strong { flex-shrink: 0; }
.action-item summary > .duration { color: #6a737d; }
.action-item summary > .output-code {
    flex-grow: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
    font-size: .9em;
}
.details-content {
    padding: 0 1rem 1rem 2.5rem;
    margin-top: .5rem;
}
.details-content h4 { margin-bottom: .25rem; }
.info-card {
    background-color: var(--info-bg);
    border: 1px solid var(--info-border);
    border-radius: 6px;
    padding: 1rem;
    margin: 1rem 0;
}
.info-card-title {
    font-weight: bold;
    font-size: 1.1em;
    margin-bottom: 0.5rem;
}
.info-card-content p {
    margin-top: 0;
    margin-bottom: 0.5rem;
}
.info-card-content blockquote {
    margin-left: 0;
    padding-left: 1em;
    border-left: 4px solid var(--info-border);
    color: var(--fg-color);
    opacity: 0.8;
}
#back-to-top {
    position: fixed;
    bottom: 20px;
    right: 20px;
    background-color: var(--accent-color);
    color: white;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: none;
    display: none;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.3s;
}
#back-to-top:hover { opacity: 1; }

@media (max-width: 960px) {
    #report-nav {
        display: none;
    }
    main {
        max-width: 100%;
    }
}
</style>
</head>
<body>
<div class="page-container">
    <header class="page-header">
        <div class="header-left"><h1 class="header-title">${title}</h1></div>
        <div class="header-center"><input type="text" id="action-search" placeholder="${searchPlaceholder}" style="display:none;"></div>
        <div class="header-right">
            <button class="filter-btn" data-filter="all" style="display:none;">All</button>
            <button class="filter-btn" data-filter="failed" style="display:none;">Failed</button>
            <button id="theme-toggle" title="Toggle theme">
                <span class="light-mode-icon">🌙</span>
                <span class="dark-mode-icon" style="display:none;">☀️</span>
            </button>
        </div>
    </header>
    <div class="content-wrapper">
        <nav id="report-nav"></nav>
        <main>
            <div class="tab-bar">
                <button class="tab-btn active" data-tab="report">Report</button>
                <button class="tab-btn" data-tab="actions">Action Details</button>
            </div>
            <div id="tab-report" class="tab-content active">${reportBody}</div>
            <div id="tab-actions" class="tab-content">${actionsBody}</div>
        </main>
    </div>
    <button id="back-to-top" title="Back to top">↑</button>
</div>
<script>
(() => {
    // --- THEME ---
    const themeToggle = document.getElementById('theme-toggle');
    const lightIcon = themeToggle.querySelector('.light-mode-icon');
    const darkIcon = themeToggle.querySelector('.dark-mode-icon');
    const htmlEl = document.documentElement;

    const applyTheme = (theme) => {
        htmlEl.dataset.theme = theme;
        lightIcon.style.display = theme === 'light' ? 'block' : 'none';
        darkIcon.style.display = theme === 'dark' ? 'block' : 'none';
        localStorage.setItem('bep-analyzer-theme', theme);
    };

    themeToggle.addEventListener('click', () => {
        const newTheme = htmlEl.dataset.theme === 'dark' ? 'light' : 'dark';
        applyTheme(newTheme);
    });

    const savedTheme = localStorage.getItem('bep-analyzer-theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(savedTheme || (prefersDark ? 'dark' : 'light'));

    // --- MAIN LOGIC ---
    document.addEventListener('DOMContentLoaded', () => {
        const backToTopBtn = document.getElementById('back-to-top');

        // Back to top button
        window.addEventListener('scroll', () => {
            if (window.scrollY > 300) {
                backToTopBtn.style.display = 'flex';
            } else {
                backToTopBtn.style.display = 'none';
            }
        }, { passive: true });

        backToTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        const tabs = document.querySelectorAll('.tab-btn');
        const contents = document.querySelectorAll('.tab-content');
        const searchInput = document.getElementById('action-search');
        const filterButtons = document.querySelectorAll('.filter-btn');
        const reportNav = document.getElementById('report-nav');
        const mainContent = document.querySelector('main');
        const contentWrapper = document.querySelector('.content-wrapper');

        const switchTab = (tabId) => {
            tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
            contents.forEach(c => c.classList.toggle('active', c.id === \`tab-\${tabId}\`));
            const isActionsTab = tabId === 'actions';
            const isReportTab = tabId === 'report';
            searchInput.style.display = isActionsTab ? 'block' : 'none';
            filterButtons.forEach(b => b.style.display = isActionsTab ? 'block' : 'none');
            if (reportNav) reportNav.style.display = isReportTab ? '' : 'none';
            if (mainContent) mainContent.style.maxWidth = isReportTab ? '' : '100%';
        };

        tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

        // Sidebar Navigation
        const reportTab = document.getElementById('tab-report');
        if (reportNav && reportTab) {
            const headers = reportTab.querySelectorAll('h2[data-nav-title]');
            const navList = document.createElement('ul');
            const navItems = [];
            if (headers.length > 0) {
                headers.forEach(header => {
                    const li = document.createElement('li');
                    const a = document.createElement('a');
                    a.href = \`#\${header.id}\`;
                    a.textContent = header.dataset.navTitle;
                    a.dataset.targetId = header.id;
                    li.appendChild(a);
                    navList.appendChild(li);
                    navItems.push({ a, header });
                });
                reportNav.appendChild(navList);

                const onScroll = () => {
                    let currentSection = null;
                    const scrollOffset = window.scrollY + 80;

                    for (const item of navItems) {
                        if (item.header.offsetTop <= scrollOffset) {
                            currentSection = item.a;
                        } else {
                            break;
                        }
                    }
                    navItems.forEach(item => item.a.classList.remove('active'));
                    if (currentSection) {
                        currentSection.classList.add('active');
                    }
                };
                window.addEventListener('scroll', onScroll, { passive: true });
                onScroll();
            }
        }

        // Action Details Filtering
        const actionGroups = document.querySelectorAll('.action-group');
        const filterState = { query: '', view: 'all' };

        const applyFilters = () => {
            const query = filterState.query.toLowerCase();
            actionGroups.forEach(group => {
                const hasFailures = group.dataset.failed === 'true';
                const showByView = filterState.view === 'all' || (filterState.view === 'failed' && hasFailures);

                let matchCount = 0;
                const items = group.querySelectorAll('.action-item');
                items.forEach(item => {
                    const searchContent = item.dataset.searchContent.toLowerCase();
                    const showByQuery = !query || searchContent.includes(query);
                    item.style.display = showByQuery ? '' : 'none';
                    if (showByQuery) matchCount++;
                });

                group.style.display = showByView && (matchCount > 0) ? '' : 'none';
            });
        };

        filterButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                filterButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                filterState.view = btn.dataset.filter;
                applyFilters();
            });
        });
        if (filterButtons.length > 0) filterButtons[0].classList.add('active');

        searchInput.addEventListener('input', e => {
            filterState.query = e.target.value;
            applyFilters();
        });

        document.querySelectorAll('.action-group-summary').forEach(summary => {
            summary.addEventListener('click', () => {
                const content = summary.nextElementSibling;
                content.style.display = content.style.display === 'block' ? 'none' : 'block';
            });
        });

        document.querySelectorAll('.copy-btn').forEach(button => {
            button.addEventListener('click', e => {
                e.stopPropagation();
                const targetButton = e.currentTarget;
                const pre = targetButton.parentElement.querySelector('pre');
                if (!pre) return;

                const textToCopy = pre.dataset.copyContent || pre.innerText;

                navigator.clipboard.writeText(textToCopy).then(() => {
                    const originalText = targetButton.innerText;
                    targetButton.innerText = targetButton.dataset.copiedText || 'Copied!';
                    targetButton.disabled = true;
                    setTimeout(() => {
                        targetButton.innerText = originalText;
                        targetButton.disabled = false;
                    }, 2000);
                }).catch(err => {
                    console.error('Failed to copy text: ', err);
                    const originalText = targetButton.innerText;
                    targetButton.innerText = 'Error';
                    setTimeout(() => {
                        targetButton.innerText = originalText;
                    }, 2000);
                });
            });
        });
    });
})();
</script>
</body>
</html>`;
  }
}
