import { ReportData, Action } from "../types";
import { Translator } from "../i18n/translator";
import AnsiToHtml from "ansi-to-html";
import { marked } from "marked";

export class HtmlReporter {
  private output: string[] = [];
  private ansiConverter: AnsiToHtml;

  constructor(
    private data: ReportData,
    private wideLevel: number,
    private t: Translator,
  ) {
    this.ansiConverter = new AnsiToHtml({ newline: true, escapeXML: true });
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(2)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = (seconds % 60).toFixed(0).padStart(2, "0");
    return `${minutes}m ${remainingSeconds}s`;
  }

  private escapeAttr(text: string | undefined | null): string {
    if (text === null || text === undefined) return "";
    return String(text)
      .replace(/&/g, "&")
      .replace(/"/g, '"')
      .replace(/</g, "<")
      .replace(/>/g, ">");
  }

  private a(line: string): void {
    this.output.push(line);
  }

  private generateHtml(): string {
    this.output = [];
    const { actions } = this.data;

    // Action Details section
    const actionsToDetail =
      this.data.actionDetails === "none"
        ? [] // In 'none' mode, show no action details
        : this.data.actionDetails === "failed"
          ? actions.filter((a) => !a.success)
          : actions;

    if (actionsToDetail.length > 0) {
      const title =
        this.data.actionDetails === "all"
          ? this.t.t("actionDetails.titleAll")
          : this.t.t("actionDetails.titleFailed");
      this.a(`<div id="action-details-wrapper">`);
      this.a(`<h2 id="actions" data-nav-title="${title}">${title}</h2>`);

      const groupedActions = new Map<string, Action[]>();
      actionsToDetail.forEach((action) => {
        const key = action.label || "Unknown Label";
        if (!groupedActions.has(key)) groupedActions.set(key, []);
        groupedActions.get(key)!.push(action);
      });

      groupedActions.forEach((actions, label) => {
        const failedCount = actions.filter((a) => !a.success).length;
        const groupData = {
          label: label,
          statusIcon: failedCount > 0 ? "❌" : "✔",
          stats: {
            actions: this.t.t("actionDetails.badgeActions", {
              count: actions.length,
            }),
            failed: failedCount,
            failedText: this.t.t("actionDetails.badgeFailed", {
              count: failedCount,
            }),
            time: `${this.t.t("actionDetails.badgeTotalTime")}: ${this.formatDuration(actions.reduce((s, a) => s + parseInt(a.actionResult?.executionInfo.wallTimeMillis || "0", 10), 0))}`,
          },
        };

        this.a(
          `<action-group group-data='${this.escapeAttr(JSON.stringify(groupData))}'>`,
        );
        actions
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
            const rawStderr = action.stderrContent?.trim() || null;
            const actionData = {
              success: action.success,
              mnemonic: action.mnemonic,
              duration: this.formatDuration(
                parseInt(
                  action.actionResult?.executionInfo.wallTimeMillis || "0",
                  10,
                ),
              ),
              primaryOutput:
                action.primaryOutput?.uri.replace("file://", "") ||
                action.label ||
                "N/A",
              command: command ? command.join(" ") : null,
              stderr: rawStderr ? this.ansiConverter.toHtml(rawStderr) : null,
              cmdTitle: this.t.t("actionDetails.commandLine"),
              stderrTitle: this.t.t("actionDetails.stderr"),
            };
            this.a(
              `<action-item action-data='${this.escapeAttr(JSON.stringify(actionData))}'></action-item>`,
            );
          });
        this.a(`</action-group>`);
      });
      this.a(
        `<div id="no-results" style="display:none;">No actions match your filter.</div>`,
      );
      this.a(`</div>`);
    }

    return this.output.join("");
  }

  public getReport(): string {
    const body = this.generateHtml();
    return this.template(this.t.t("buildSummary.title"), body);
  }

  private template(title: string, body: string): string {
    const copyButtonText = this.t.t("actionDetails.copyButton");
    const copiedButtonText = this.t.t("actionDetails.copiedButton");

    return `<!DOCTYPE html><html lang="${this.t.lang}"><head><meta charset="UTF-8"><title>${title}</title><style>
:root{--bg-color:#fff;--fg-color:#24292e;--bg-alt:#f6f8fa;--border-color:#e1e4e8;--accent-color:#0366d6;--danger-color:#d73a49;--danger-fg:#fff;--success-color:#28a745;--code-bg:rgba(27,31,35,.07);--shadow:0 1px 0 rgba(27,31,35,.04),inset 0 1px 0 hsla(0,0%,100%,.25)}
html[data-theme='dark']{--bg-color:#0d1117;--fg-color:#c9d1d9;--bg-alt:#161b22;--border-color:#30363d;--accent-color:#58a6ff;--danger-color:#f85149;--danger-fg:#0d1117;--success-color:#3fb950;--code-bg:rgba(240,246,252,.15);--shadow:0 0 transparent}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;line-height:1.6;color:var(--fg-color);background-color:var(--bg-alt);margin:0; padding: 1rem;}
.main-content{max-width: 1000px; margin: 0 auto; background-color: var(--bg-color); padding: 1rem 2rem; border-radius: 8px; box-shadow: var(--shadow)}
h2{border-bottom:1px solid var(--border-color);padding-bottom:.5rem;margin-top:2rem}
code{background-color:var(--code-bg);border-radius:6px;padding:.2em .4em;font-family:"SFMono-Regular",Consolas,monospace;font-size:85%}
.stat-badge{padding:.25rem .75rem;border-radius:2em;font-size:.8em;font-weight:500;background-color:var(--code-bg);white-space:nowrap}
.stat-badge.failed{background-color:var(--danger-color);color:var(--danger-fg)}
.icon{width:1.2em;height:1.2em;vertical-align:-.2em;margin-right:.25em}
.icon-success{color:var(--success-color)}
.icon-danger{color:var(--danger-color)}
</style></head><body>
<main class="main-content" id="main-content">${body}</main>
<template id="action-group-template">
  <style>
    :host{display:block}
    .action-group{border:1px solid var(--border-color);border-radius:8px;margin-bottom:1.5rem;box-shadow:var(--shadow)}
    .action-group-header{display:flex;justify-content:space-between;align-items:center;padding:.8rem 1.25rem;background-color:var(--bg-alt);border-bottom:1px solid var(--border-color);gap:1rem}
    .header-label{font-size:1.1em;font-weight:600;display:flex;align-items:center;gap:.5rem;flex-shrink:1;min-width:0}
    .header-label .status-icon{flex-shrink:0}
    .header-label .label-repo{color:var(--accent-color);font-weight:400;flex-shrink:0}
    .header-label .label-path{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .header-stats{display:flex;align-items:center;gap:.5rem;flex-shrink:0}
    .action-group-content{padding:1rem;padding-top:.5rem}
  </style>
  <div class="action-group">
    <div class="action-group-header">
      <div class="header-label"></div>
      <div class="header-stats"></div>
    </div>
    <div class="action-group-content"><slot></slot></div>
  </div>
</template>
<template id="action-item-template"><style>:host{display:block}details{border:1px solid var(--border-color);border-radius:6px;margin-bottom:.5rem;background-color:var(--bg-color);overflow:hidden;transition:box-shadow .2s}details:hover{box-shadow:0 4px 6px -1px rgba(0,0,0,.01),0 2px 4px -2px rgba(0,0,0,.01)}summary{font-weight:500;padding:.75rem 1rem;background-color:var(--bg-alt);outline:0;display:flex;align-items:center;gap:.75rem;cursor:pointer;list-style:none}summary::-webkit-details-marker{display:none}.content{padding:1rem;border-top:1px solid var(--border-color)}code{font-size:85%}.icon-wrapper{display:flex;align-items:center}</style><details><summary><span class="icon-wrapper" id="status-icon"></span><strong id="mnemonic"></strong>|<span id="duration"></span>|<code id="output"></code></summary><div class="content"><slot></slot></div></details></template>
<template id="code-block-template"><style>:host{display:block;margin-top:1rem}.code-block-wrapper{position:relative;margin-top:.5rem}.title{color:var(--fg-color);font-weight:600;display:block;margin-bottom:.5rem}pre{background-color:var(--bg-alt);border:1px solid var(--border-color);border-radius:6px;padding:16px;overflow-x:auto;white-space:pre-wrap;word-break:break-all}</style><div class="code-block-wrapper"><span class="title"></span><pre><slot></slot></pre><copy-button></copy-button></div></template>
<template id="copy-button-template"><style>:host{position:absolute;top:8px;right:8px}.copy-btn{background-color:var(--bg-color);border:1px solid var(--border-color);border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;opacity:0;transition:opacity .2s,background-color .2s,color .2s}*:hover>.copy-btn,*:focus-within>.copy-btn{opacity:1}.copy-btn.copied{background-color:var(--success-color);color:white;border-color:var(--success-color)}</style><button class="copy-btn">${copyButtonText}</button></template>
<script>
document.addEventListener('DOMContentLoaded',()=>{const define=(n,c)=>{if(!customElements.get(n))customElements.define(n,c)};
class CopyButton extends HTMLElement{constructor(){super();this.attachShadow({mode:'open'})}connectedCallback(){const t=document.getElementById('copy-button-template').content;this.shadowRoot.appendChild(t.cloneNode(true));this.button=this.shadowRoot.querySelector('button');this.button.addEventListener('click',this.copy.bind(this))}async copy(){const t=this.parentElement.querySelector('pre,code').innerText;try{await navigator.clipboard.writeText(t);this.button.textContent='${copiedButtonText}';this.button.classList.add('copied');setTimeout(()=>{this.button.textContent='${copyButtonText}';this.button.classList.remove('copied')},2e3)}catch(t){console.error("Copy failed",t)}}};define('copy-button',CopyButton);
class CodeBlock extends HTMLElement{constructor(){super();this.attachShadow({mode:'open'})}connectedCallback(){const t=document.getElementById('code-block-template').content;this.shadowRoot.appendChild(t.cloneNode(true));this.shadowRoot.querySelector('.title').textContent=this.getAttribute('title');this.shadowRoot.querySelector('slot').innerHTML=this.innerHTML}};define('code-block',CodeBlock);
class ActionItem extends HTMLElement{constructor(){super();this.attachShadow({mode:'open'})}connectedCallback(){const t=document.getElementById('action-item-template').content;this.shadowRoot.appendChild(t.cloneNode(true));const e=JSON.parse(this.getAttribute('action-data'));const s=this.shadowRoot.querySelector('#status-icon');s.innerHTML=e.success?'<svg class="icon icon-success" fill="currentColor" viewBox="0 0 16 16"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z"/></svg>':'<svg class="icon icon-danger" fill="currentColor" viewBox="0 0 16 16"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.647a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>';this.shadowRoot.querySelector('#mnemonic').textContent=e.mnemonic;this.shadowRoot.querySelector('#duration').textContent=e.duration;this.shadowRoot.querySelector('#output').textContent=e.primaryOutput;if(e.command){const o=document.createElement('code-block');o.setAttribute('title',e.cmdTitle);o.textContent=e.command;this.shadowRoot.querySelector('.content').appendChild(o)}if(e.stderr){const o=document.createElement('code-block');o.setAttribute('title',e.stderrTitle);o.innerHTML=e.stderr;this.shadowRoot.querySelector('.content').appendChild(o)}}};define('action-item',ActionItem);
class ActionGroup extends HTMLElement{constructor(){super();this.attachShadow({mode:'open'})}connectedCallback(){const t=document.getElementById('action-group-template').content;this.shadowRoot.appendChild(t.cloneNode(true));const e=JSON.parse(this.getAttribute('group-data'));const labelEl=this.shadowRoot.querySelector('.header-label');const statusIconEl = e.statusIcon === '✔' ? '<svg class="icon icon-success" fill="currentColor" viewBox="0 0 16 16"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z"/></svg>' : '<svg class="icon icon-danger" fill="currentColor" viewBox="0 0 16 16"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.647a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>';const match=e.label.match(/^(@@?[^\\\\/]+)(\\/\\/.*)/);if(match){labelEl.innerHTML='<span class="status-icon">'+statusIconEl+'</span><span class="label-repo">'+match[1]+'</span><span class="label-path">'+match[2]+'</span>'}else{labelEl.innerHTML='<span class="status-icon">'+statusIconEl+'</span><span class="label-path">'+e.label+'</span>'}const o=this.shadowRoot.querySelector('.header-stats');o.innerHTML='<span class="stat-badge">'+e.stats.actions+'</span>'+(e.stats.failed>0?'<span class="stat-badge failed">'+e.stats.failedText+'</span>':'')+'<span class="stat-badge">'+e.stats.time+'</span>';this.shadowRoot.querySelector('slot').innerHTML=this.innerHTML}};define('action-group',ActionGroup);
});
</script></body></html>`;
  }
}
