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
  private escapeAttr(text: string | undefined | null): string {
    if (text === null || text === undefined) return "";
    return String(text)
      .replace(/&/g, "&")
      .replace(/"/g, '"')
      .replace(/</g, "<")
      .replace(/>/g, ">");
  }

  // --- START OF CRITICAL FIX ---
  /**
   * Creates a markdown code block from text, safely handling file URIs.
   */
  private mdCode(text: string | undefined | null): string {
    if (text === null || text === undefined) return "`N/A`";
    // Clean up file URIs inside this safe helper
    const cleanedText = String(text)
      .replace(/^file:\/\//, "")
      .replace(/`/g, "'");
    return `\`${cleanedText}\``;
  }
  // --- END OF CRITICAL FIX ---

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
      return `<div class="report-section"><h2 id="${id}" data-nav-title="${title}">${title}</h2>${content}</div>`;
    };

    // Summary
    let summaryMd = `- **${this.t.t("buildSummary.status")}**: ${buildFinished.overallSuccess ? "✅" : "❌"} ${buildFinished.exitCode?.name || (buildFinished.overallSuccess ? "SUCCESS" : "FAILURE")}\n`;
    summaryMd += `- **${this.t.t("buildSummary.totalTime")}**: ${this.formatDuration(parseInt(buildFinished.finishTimeMillis, 10) - parseInt(buildStarted.startTimeMillis, 10))}\n`;
    if (buildMetrics?.timingMetrics) {
      summaryMd += `  - **${this.t.t("buildSummary.analysisPhase")}**: ${this.formatDuration(Number(buildMetrics.timingMetrics.analysisPhaseTimeInMs))}\n`;
      summaryMd += `  - **${this.t.t("buildSummary.executionPhase")}**: ${this.formatDuration(Number(buildMetrics.timingMetrics.executionPhaseTimeInMs))}\n`;
    }
    html += renderSection(
      "buildSummary.title",
      "summary",
      marked.parse(summaryMd),
    );

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
        buildMetrics.actionSummary.actionCacheStatistics?.missDetails.length
      ) {
        let missMd = `| Reason | Count |\n|---|---|\n`;
        buildMetrics.actionSummary.actionCacheStatistics.missDetails.forEach(
          (d) => {
            const reasonKey = `performanceMetrics.cacheMissReason.${d.reason?.replace(/[^a-zA-Z0-9]/g, "")}`;
            missMd += `| ${this.t.t(reasonKey, { reason: d.reason ?? "" })} | ${this.formatNumber(d.count ?? 0)} |\n`;
          },
        );
        perfContent += `<details><summary>${this.t.t("performanceMetrics.cacheMissBreakdown")}</summary>${marked.parse(missMd)}</details>`;
      }
      if (buildMetrics.memoryMetrics?.garbageMetrics) {
        let gcMd = `| Type | Collected |\n|---|---|\n`;
        buildMetrics.memoryMetrics.garbageMetrics.forEach(
          (m) =>
            (gcMd += `| ${m.type} | ${this.formatBytes(m.garbageCollected)} |\n`),
        );
        perfContent += `<details><summary>${this.t.t("performanceMetrics.gcByType")}</summary>${marked.parse(gcMd)}</details>`;
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
      let graphMd = `| Metric | Value |\n|---|---|\n`;
      const { actionCount, outputArtifactCount } =
        buildMetrics.buildGraphMetrics;
      graphMd += `| ${this.t.t("buildGraphMetrics.totalActions")} | ${this.formatNumber(actionCount)} |\n`;
      graphMd += `| ${this.t.t("buildGraphMetrics.totalOutputs")} | ${this.formatNumber(outputArtifactCount)} |\n`;
      html += renderSection(
        "buildGraphMetrics.title",
        "graph-metrics",
        marked.parse(graphMd),
      );
    }

    // Slowest Actions
    let slowestMd = `| ${this.t.t("slowestActions.duration")} | ${this.t.t("slowestActions.actionType")} | ${this.t.t("slowestActions.outputTarget")} |\n|---|---|---|\n`;
    actions
      .sort(
        (a, b) =>
          parseInt(b.actionResult?.executionInfo.wallTimeMillis || "0", 10) -
          parseInt(a.actionResult?.executionInfo.wallTimeMillis || "0", 10),
      )
      .slice(0, 10)
      .forEach((a) => {
        // --- START OF CRITICAL FIX ---
        const outputTarget = a.primaryOutput?.uri || a.label;
        slowestMd += `| ${this.formatDuration(parseInt(a.actionResult?.executionInfo.wallTimeMillis || "0", 10))} | ${this.mdCode(a.mnemonic)} | ${this.mdCode(outputTarget)} |\n`;
        // --- END OF CRITICAL FIX ---
      });
    html += renderSection(
      "slowestActions.title",
      "slowest-actions",
      marked.parse(slowestMd),
    );

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

      groupedActions.forEach((actionList, label) => {
        const failedCount = actionList.filter((a) => !a.success).length;
        const hasFailures = failedCount > 0;
        html += `<div class="action-group" data-label="${this.escapeAttr(label)}" data-failed="${hasFailures}">`;
        html += `<div class="action-group-summary">`;
        html += `<span class="icon">${hasFailures ? "❌" : "✔"}</span>`;
        html += `<code class="label-code">${this.escapeAttr(label)}</code>`;
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
            html += `<details class="action-item" data-search-content="${this.escapeAttr(action.mnemonic)} ${this.escapeAttr(output)}"><summary>`;
            html += `<span class="icon">${action.success ? "✅" : "❌"}</span>`;
            html += `<strong>${this.escapeAttr(action.mnemonic)}</strong>`;
            html += `<span class="duration">${this.formatDuration(parseInt(action.actionResult?.executionInfo.wallTimeMillis || "0", 10))}</span>`;
            html += `<code class="output-code">${this.escapeAttr(output)}</code>`;
            html += `</summary><div class="details-content">`;
            if (command)
              html += `<h4>${this.t.t("actionDetails.commandLine")}</h4><pre><code>${this.escapeAttr(command.join(" "))}</code></pre>`;
            if (stderr)
              html += `<h4>${this.t.t("actionDetails.stderr")}</h4><pre>${this.ansiConverter.toHtml(stderr)}</pre>`;
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

    return `<!DOCTYPE html><html lang="${this.t.lang}"><head><meta charset="UTF-8"><title>${title}</title><style>
:root{--header-height:60px;--bg-color:#fff;--fg-color:#24292e;--bg-alt:#f6f8fa;--border-color:#e1e4e8;--accent-color:#0366d6;}
html[data-theme='dark']{--bg-color:#0d1117;--fg-color:#c9d1d9;--bg-alt:#161b22;--border-color:#30363d;--accent-color:#58a6ff;}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.5;color:var(--fg-color);background-color:var(--bg-alt);margin:0;}
.page-header{display:flex;justify-content:space-between;align-items:center;padding:0 24px;height:var(--header-height);background:var(--bg-color);border-bottom:1px solid var(--border-color);position:sticky;top:0;z-index:100;}
.header-left{flex:1;text-align:left}.header-center{flex:2;display:flex;justify-content:center}.header-right{flex:1;display:flex;justify-content:flex-end;gap:.5rem}
#action-search{width:100%;max-width:500px;font-size:1rem;padding:.5rem 1rem;border:1px solid var(--border-color);border-radius:6px;}
.filter-btn{font-size:.9rem;padding:.5rem 1rem;border:1px solid var(--border-color);border-radius:6px;background:0;cursor:pointer}
.filter-btn.active{background:var(--accent-color);color:#fff;border-color:var(--accent-color)}
.tab-bar{display:flex;border-bottom:1px solid var(--border-color);background:var(--bg-color);padding:0 24px}
.tab-btn{padding:1rem 1.5rem;cursor:pointer;border:0;border-bottom:3px solid transparent;background:0;font-size:1rem;color:var(--fg-color)}
.tab-btn.active{border-bottom-color:var(--accent-color);font-weight:600}
.tab-content{display:none;padding:24px}.tab-content.active{display:block}
.report-section > h2{margin:2rem 0 1rem;padding-bottom:.5rem;border-bottom:1px solid var(--border-color)}.report-section:first-child > h2{margin-top:0}
details > summary { list-style: none; cursor: pointer; } details > summary::-webkit-details-marker { display: none; }
table{border-collapse:collapse;width:100%;margin:1rem 0}
th,td{border:1px solid var(--border-color);padding:.6em 1em;text-align:left;vertical-align:top}
th{background-color:var(--bg-alt)}
pre{background-color:var(--bg-alt);border-radius:6px;padding:1rem;white-space:pre-wrap;word-break:break-all;overflow-x:auto;}
code{font-family:monospace;background-color:rgba(27,31,35,.07);border-radius:6px;padding:.2em .4em;font-size:85%}
pre>code{padding:0;background:0;border:0}
.action-group{border:1px solid var(--border-color);border-radius:8px;margin-bottom:4px;overflow:hidden}
.action-group-summary{display:flex;gap:.75rem;align-items:center;padding:.5rem 1rem;cursor:pointer;background:var(--bg-alt)}
.action-group-summary:hover{background-color:var(--border-color)}
.action-group-summary > .icon{font-size:1.2em;flex-shrink:0}
.action-group-summary > .label-code{flex-grow:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.action-group-stats{flex-shrink:0;margin-left:auto;font-size:.85rem;color:#6a737d}
.action-group-content{padding:.25rem .5rem;display:none;border-top:1px solid var(--border-color)}
.action-item summary{display:flex;gap:.75rem;align-items:center;cursor:pointer;padding:.4rem .5rem}
.action-item summary > .icon{flex-shrink:0}
.action-item summary > strong{flex-shrink:0}
.action-item summary > .duration{color:#6a737d}
.action-item summary > .output-code{flex-grow:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}
.details-content{padding:.5rem 1rem 1rem 2.5rem;border-top:1px dashed var(--border-color);margin-top:.25rem}
</style></head><body>
<header class="page-header">
    <div class="header-left"><h1 class="header-title">${title}</h1></div>
    <div class="header-center"><input type="text" id="action-search" placeholder="${searchPlaceholder}" style="display:none;"></div>
    <div class="header-right">
        <button class="filter-btn" data-filter="all" style="display:none;">All Actions</button>
        <button class="filter-btn" data-filter="failed" style="display:none;">Failed Actions</button>
    </div>
</header>
<div class="tab-bar">
    <button class="tab-btn active" data-tab="report">Report</button>
    <button class="tab-btn" data-tab="actions">Action Details</button>
</div>
<main>
    <div id="tab-report" class="tab-content active">${reportBody}</div>
    <div id="tab-actions" class="tab-content">${actionsBody}</div>
</main>
<script>
document.addEventListener('DOMContentLoaded',()=>{
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');
    const searchInput = document.getElementById('action-search');
    const filterButtons = document.querySelectorAll('.filter-btn');

    const switchTab = (tabId) => {
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
        contents.forEach(c => c.classList.toggle('active', c.id === \`tab-\${tabId}\`));
        const isActionsTab = tabId === 'actions';
        searchInput.style.display = isActionsTab ? 'block' : 'none';
        filterButtons.forEach(b => b.style.display = isActionsTab ? 'block' : 'none');
    };

    tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

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
                if(showByQuery) matchCount++;
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
});
</script></body></html>`;
  }
}
