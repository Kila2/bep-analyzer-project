import * as fs from 'fs';
import * as readline from 'readline';
import chalk from 'chalk';
import Table from 'cli-table3';
import { BepEvent, Action, TestSummary, BuildFinished, BuildStarted, Problem, WorkspaceStatus, Configuration, BuildMetrics, BuildToolLogs, OptionsParsed, StructuredCommandLine, NamedSetOfFiles, ConvenienceSymlink, TargetCompleted } from './types';

function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    const seconds = ms / 1000;
    if (seconds < 60) {
        return `${seconds.toFixed(2)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = (seconds % 60).toFixed(0).padStart(2, '0');
    return `${minutes}m ${remainingSeconds}s`;
}

function formatNumber(num: number | string): string {
    return Number(num).toLocaleString();
}

function formatBytes(bytes: number | string): string {
    const num = Number(bytes);
    if (num === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(num) / Math.log(k));
    return parseFloat((num / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}


export class StaticBepAnalyzer {
    protected buildStarted: BuildStarted | null = null;
    protected buildFinished: BuildFinished | null = null;
    protected buildMetrics: BuildMetrics | null = null;
    protected buildToolLogs: BuildToolLogs | null = null;
    protected readonly actions: Action[] = [];
    protected readonly testSummaries: TestSummary[] = [];
    protected readonly problems: Problem[] = [];
    protected readonly failedTargets: {label: string, configId?: string}[] = [];
    protected workspaceStatus: WorkspaceStatus | null = null;
    protected readonly configurations: Map<string, Configuration> = new Map();
    protected optionsParsed: OptionsParsed | null = null;
    protected structuredCommandLine: StructuredCommandLine | null = null;
    protected buildPatterns: string[] = [];
    private readonly namedSets: Map<string, NamedSetOfFiles> = new Map();
    private readonly convenienceSymlinks: ConvenienceSymlink[] = [];
    private readonly topLevelOutputSets: Map<string, string[]> = new Map();

    constructor(
        protected actionDetails: 'none' | 'failed' | 'all' = 'failed',
        protected fullCommandLine: boolean = false
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
                if (line.trim() === '') continue;
                const event: BepEvent = JSON.parse(line);
                this.processEvent(event);
            } catch (e) {
                console.warn(chalk.yellow(`Warning: Could not parse or process line: ${line.substring(0,100)}...`));
                if (e instanceof Error) console.warn(chalk.gray(e.message));
            }
        }
    }

    protected processEvent(event: BepEvent): void {
        const id = event.id;
        const data = event.payload || event; 

        if (id.buildStarted || id.started) {
            if(data.started) this.buildStarted = data.started;
            return;
        }

        if (id.buildFinished || id.finished) {
            if(data.finished) this.buildFinished = data.finished;
            return;
        }

        const eventType = Object.keys(id)[0];
        switch(eventType) {
            case 'actionCompleted':
                const actionData = data.completed || data.action;
                if (actionData) {
                    const action = actionData as Action;
                    action.label = id.actionCompleted!.label;
                    if (id.actionCompleted!.primaryOutput) {
                        action.primaryOutput = { uri: `file://${id.actionCompleted!.primaryOutput}` };
                    }

                    if (!action.mnemonic && action.type) action.mnemonic = action.type;

                    if (!action.actionResult) {
                        let wallTimeMillis = '0';
                        if (action.startTime && action.endTime) {
                            try {
                                const start = new Date(action.startTime).getTime();
                                const end = new Date(action.endTime).getTime();
                                wallTimeMillis = (end - start).toString();
                            } catch(e) {}
                        }
                        action.actionResult = {
                            executionInfo: {
                                startTimeMillis: '0', // Not easily available here
                                wallTimeMillis: wallTimeMillis,
                            }
                        };
                    }

                    const shouldProcessDetails = 
                        this.actionDetails === 'all' || 
                        (this.actionDetails === 'failed' && !action.success);

                    if (shouldProcessDetails) {
                        const fullActionPayload = data.action || data.completed;
                        action.argv = fullActionPayload.commandLine || fullActionPayload.argv;
                        if (fullActionPayload.stderr?.uri) {
                            try {
                                const stderrPath = new URL(fullActionPayload.stderr.uri).pathname;
                                action.stderrContent = fs.readFileSync(stderrPath, 'utf-8');
                            } catch (e) {
                                action.stderrContent = `[Error] Failed to read stderr.`;
                            }
                        }
                    }
                    this.actions.push(action);
                }
                break;
            case 'testSummary':
                if (data.summary) {
                    const summary = data.summary as TestSummary;
                    summary.label = id.testSummary!.label;
                    const existingIndex = this.testSummaries.findIndex(s => s.label === summary.label);
                    if (existingIndex > -1) this.testSummaries[existingIndex] = summary;
                    else this.testSummaries.push(summary);
                }
                break;
            case 'problem':
                if (data.problem) this.problems.push(data.problem as Problem);
                break;
            case 'targetCompleted':
                const completedData = data.completed as TargetCompleted;
                if (completedData) {
                    if (!completedData.success) {
                        this.failedTargets.push({
                            label: id.targetCompleted!.label,
                            configId: id.targetCompleted!.configuration?.id
                        });
                    } else {
                        const cleanLabel = id.targetCompleted!.label.replace(/^(@@?)/, '');
                        if (this.buildPatterns.some(p => cleanLabel.startsWith(p.replace(/^(@@?)/, '')))) {
                            const fileSetIds = completedData.outputGroup?.flatMap(group => group.fileSets?.map(fs => fs.id) || []) || [];
                            if (fileSetIds.length > 0) {
                                this.topLevelOutputSets.set(id.targetCompleted!.label, fileSetIds);
                            }
                        }
                    }
                }
                break;
            case 'workspaceStatus':
                if (data.workspaceStatus) this.workspaceStatus = data.workspaceStatus;
                break;
            case 'optionsParsed':
                if (data.optionsParsed) this.optionsParsed = data.optionsParsed;
                break;
            case 'structuredCommandLine':
                if (data.structuredCommandLine && data.structuredCommandLine.commandLineLabel === 'canonical') {
                    this.structuredCommandLine = data.structuredCommandLine;
                }
                break;
            case 'pattern':
                if (id.pattern?.pattern) this.buildPatterns.push(...id.pattern.pattern);
                break;
            case 'namedSet':
                if (id.namedSet?.id && data.namedSetOfFiles) {
                    this.namedSets.set(id.namedSet.id, data.namedSetOfFiles);
                }
                break;
            case 'convenienceSymlinksIdentified':
                if (data.convenienceSymlinksIdentified?.convenienceSymlinks) {
                    this.convenienceSymlinks.push(...data.convenienceSymlinksIdentified.convenienceSymlinks);
                }
                break;
            case 'configuration':
                if (data.configuration) this.configurations.set(id.configuration!.id, data.configuration);
                break;
            case 'buildMetrics':
                if (event.buildMetrics) this.buildMetrics = event.buildMetrics as BuildMetrics;
                break;
            case 'buildToolLogs':
                if (event.buildToolLogs) this.buildToolLogs = event.buildToolLogs as BuildToolLogs;
                break;
        }
    }
    
    private resolveFileSet(fileSetId: string): {name: string, uri: string}[] {
        const seen = new Set<string>();
        const queue = [fileSetId];
        const result: {name: string, uri: string}[] = [];

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
                queue.push(...fileSet.fileSets.map(fs => fs.id));
            }
        }
        return result;
    }

    public printReport(): void {
        if (!this.buildStarted || !this.buildFinished) {
            console.error(chalk.red('Error: Build start or finish event not found. The BEP file may be incomplete or invalid.'));
            return;
        }

        // --- Build Summary ---
        console.log(chalk.bold.cyan('\n--- Build Summary ---'));
        const success = this.buildFinished.overallSuccess;
        const exitCodeName = this.buildFinished.exitCode?.name || (success ? 'SUCCESS' : 'FAILURE');
        const status = success ? chalk.green(exitCodeName) : chalk.red(exitCodeName);
        console.log(`Status: ${status}`);
        const startTime = parseInt(this.buildStarted.startTimeMillis, 10);
        const finishTime = parseInt(this.buildFinished.finishTimeMillis, 10);
        console.log(`Total Time: ${chalk.yellow(formatDuration(finishTime - startTime))}`);
        if (this.buildMetrics?.timingMetrics) {
            const metrics = this.buildMetrics.timingMetrics;
            console.log(`  - Analysis Phase: ${chalk.magenta(formatDuration(Number(metrics.analysisPhaseTimeInMs)))}`);
            console.log(`  - Execution Phase: ${chalk.magenta(formatDuration(Number(metrics.executionPhaseTimeInMs)))}`);
        }

        // --- Build Environment & Options ---
        console.log(chalk.bold.cyan('\n--- Build Environment & Options ---'));
        const envTable = new Table({ colWidths: [30, 70], style: { border: ['gray'], head: [] }, wordWrap: true });
        envTable.push([{ colSpan: 2, content: chalk.bold.white('Invocation Details') }]);
        envTable.push(['Command', chalk.gray(this.buildStarted.command)]);
        if (this.buildPatterns.length > 0) {
             envTable.push(['Targets', chalk.gray(this.buildPatterns.join(', '))]);
        }
        if (this.workspaceStatus) {
            this.workspaceStatus.item.forEach(item => {
                envTable.push([item.key, chalk.gray(item.value || '')]);
            });
        }
        if(envTable.length > 1) console.log(envTable.toString());
        
        if (this.optionsParsed?.explicitCmdLine && this.optionsParsed.explicitCmdLine.length > 0) {
            console.log(chalk.bold.white('\nExplicit Command-Line Options:'));
            this.optionsParsed.explicitCmdLine.forEach(opt => console.log(chalk.gray(`  ${opt}`)));
        }
        
        if (this.structuredCommandLine) {
            console.log(chalk.bold.white('\nCanonical Command Line:'));
            const cmd = this.structuredCommandLine.sections.flatMap(s => s.chunkList?.chunk || s.optionList?.option.map(o => o.combinedForm) || []).join(' ');
            console.log(chalk.gray(cmd));
        } else if (this.buildStarted.optionsDescription) {
            console.log(chalk.bold.white('\nOptions Description:'));
            console.log(chalk.gray(this.buildStarted.optionsDescription));
        }
        
        // --- Performance Metrics ---
        if (this.buildMetrics) {
            console.log(chalk.bold.cyan('\n--- Performance Metrics ---'));
            const metrics = this.buildMetrics;
            const perfTable = new Table({ style: {head: ['cyan'], border: ['gray']} });
            perfTable.push(
                [{ colSpan: 2, content: chalk.bold.white('Execution & Caching') }],
                ['Actions Created', chalk.blue(formatNumber(metrics.actionSummary.actionsCreated || 'N/A'))],
                ['Actions Executed', chalk.blue(formatNumber(metrics.actionSummary.actionsExecuted))]
            );
            if (metrics.actionSummary.actionCacheStatistics) {
                const stats = metrics.actionSummary.actionCacheStatistics;
                const misses = stats.missDetails.reduce((s, d) => s + (Number(d.count) || 0), 0);
                const hits = Number(metrics.artifactMetrics?.outputArtifactsFromActionCache?.count || stats.hits || 0);
                const totalLookups = hits + misses;
                const hitRate = totalLookups > 0 ? ((hits / totalLookups) * 100).toFixed(2) : '0.00';
                const hitRateColor = hits > 0 ? chalk.green : chalk.yellow;
                perfTable.push(['Action Cache', `${hitRateColor(hitRate + '%')} hit (${formatNumber(hits)} hits / ${formatNumber(misses)} misses)`]);
                
                if (stats.missDetails && stats.missDetails.length > 0) {
                    const missRows = stats.missDetails
                        .filter(d => Number(d.count) > 0)
                        .sort((a, b) => Number(b.count) - Number(a.count));
                    
                    if (missRows.length > 0) {
                        perfTable.push([{ colSpan: 2, content: chalk.white('  Cache Miss Breakdown:') }]);
                        missRows.forEach(detail => {
                            const reason = detail.reason.replace(/_/g, ' ').toLowerCase().replace(/(?:^|\s)\S/g, a => a.toUpperCase());
                            perfTable.push([`    - ${reason}`, chalk.yellow(formatNumber(detail.count))]);
                        });
                    }
                }
            }
            if (metrics.memoryMetrics) {
                const memRows: any[] = [];
                if(metrics.memoryMetrics.peakPostGcHeapSize) {
                    memRows.push(['Peak Heap Size (Post GC)', chalk.magenta(formatBytes(metrics.memoryMetrics.peakPostGcHeapSize))]);
                }
                if(metrics.memoryMetrics.usedHeapSizePostBuild) {
                    memRows.push(['Used Heap (Post Build)', chalk.magenta(formatBytes(metrics.memoryMetrics.usedHeapSizePostBuild))]);
                }
                if (memRows.length > 0) {
                    perfTable.push([{ colSpan: 2, content: chalk.bold.white('Memory Usage') }]);
                    perfTable.push(...memRows);
                }

                if (metrics.memoryMetrics.garbageMetrics && metrics.memoryMetrics.garbageMetrics.length > 0) {
                     const gcRows: any[] = [];
                     metrics.memoryMetrics.garbageMetrics
                        .sort((a,b) => Number(b.garbageCollected) - Number(a.garbageCollected))
                        .forEach(metric => {
                            gcRows.push([`  ${metric.type}`, chalk.magenta(formatBytes(metric.garbageCollected))]);
                        });
                    if (gcRows.length > 0) {
                        perfTable.push([{ colSpan: 2, content: chalk.bold.white('Garbage Collection by Type') }]);
                        perfTable.push(...gcRows);
                    }
                }
            }
            console.log(perfTable.toString());
        }

        // --- Artifact Metrics ---
        if (this.buildMetrics?.artifactMetrics) {
            console.log(chalk.bold.cyan('\n--- Artifact Metrics ---'));
            const { sourceArtifactsRead, outputArtifactsSeen, topLevelArtifacts } = this.buildMetrics.artifactMetrics;
            const artifactTable = new Table({ head: ['Metric', 'Count', 'Size'], style: { head: ['cyan'] }});
            artifactTable.push(['Source Artifacts Read', formatNumber(sourceArtifactsRead.count), formatBytes(sourceArtifactsRead.sizeInBytes)]);
            artifactTable.push(['Output Artifacts Seen', formatNumber(outputArtifactsSeen.count), formatBytes(outputArtifactsSeen.sizeInBytes)]);
            if(topLevelArtifacts) artifactTable.push(['Top-Level Artifacts', formatNumber(topLevelArtifacts.count), formatBytes(topLevelArtifacts.sizeInBytes)]);
            console.log(artifactTable.toString());
        }
        
        // --- Build Graph Metrics ---
        if (this.buildMetrics?.buildGraphMetrics) {
            console.log(chalk.bold.cyan('\n--- Build Graph Metrics ---'));
            const { actionCount, outputArtifactCount, builtValues } = this.buildMetrics.buildGraphMetrics;
            const graphTable = new Table({ style: { border: ['gray'] }});
            graphTable.push(
                ['Total Actions in Graph', chalk.blue(formatNumber(actionCount))],
                ['Total Output Artifacts', chalk.blue(formatNumber(outputArtifactCount))]
            );
            console.log(graphTable.toString());
            if (builtValues && builtValues.length > 0) {
                console.log(chalk.bold.cyan('\n--- Top 10 Built SkyFunctions ---'));
                const skyFunctionTable = new Table({ head: ['SkyFunction', 'Eval Count'], style: { head: ['cyan'] } });
                builtValues
                    .sort((a,b) => Number(b.count) - Number(a.count))
                    .slice(0, 10)
                    .forEach(v => skyFunctionTable.push([v.skyfunctionName, formatNumber(v.count)]));
                console.log(skyFunctionTable.toString());
            }
        }
        
        // --- Worker & Network Metrics ---
        if (this.buildMetrics) {
            const hasWorkerMetrics = this.buildMetrics.workerMetrics && this.buildMetrics.workerMetrics.length > 0;
            const hasNetworkMetrics = this.buildMetrics.networkMetrics && this.buildMetrics.networkMetrics.systemNetworkStats;
            if (hasWorkerMetrics || hasNetworkMetrics) {
                console.log(chalk.bold.cyan('\n--- Worker & Network Metrics ---'));
                const workerNetworkTable = new Table({ style: { border: ['gray'] } });
                if (hasWorkerMetrics) {
                    const totalActions = this.buildMetrics.workerMetrics!.reduce((sum, w) => sum + Number(w.actionsExecuted), 0);
                    workerNetworkTable.push(['Total Worker Actions', formatNumber(totalActions)]);
                }
                if (hasNetworkMetrics) {
                    const { bytesSent, bytesRecv } = this.buildMetrics.networkMetrics!.systemNetworkStats!;
                    workerNetworkTable.push(['Network Traffic', `Sent: ${formatBytes(bytesSent)}, Received: ${formatBytes(bytesRecv)}`]);
                }
                if (workerNetworkTable.length > 0) console.log(workerNetworkTable.toString());
            }
        }
        
        // --- Build Tool Logs ---
        if (this.buildToolLogs) {
            console.log(chalk.bold.cyan('\n--- Build Tool Logs ---'));
            this.buildToolLogs.log.forEach(log => {
                if(log.contents) {
                    try {
                        const decoded = Buffer.from(log.contents, 'base64').toString('utf-8');
                        if (log.name === 'critical path') {
                             console.log(chalk.yellow(`Critical Path Summary:`));
                             const criticalPathContent = decoded.split('\n').filter(line => line.trim().length > 0);
                             console.log(chalk.gray(criticalPathContent.map(l => `  ${l}`).join('\n')));
                        } else {
                            console.log(`${chalk.yellow(log.name)}: ${chalk.gray(decoded)}`);
                        }
                    } catch (e) {}
                } else if(log.uri) {
                    console.log(`${chalk.yellow(log.name)}: ${chalk.gray(log.uri)}`);
                }
            });
        }

        // --- Problems & Failures ---
        if (this.problems.length > 0) {
            console.log(chalk.bold.red('\n--- Problems ---'));
            this.problems.forEach(p => console.log(chalk.red(`- ${p.message}`)));
        }

        if (this.failedTargets.length > 0) {
            console.log(chalk.bold.red('\n--- Failed Targets ---'));
            this.failedTargets.forEach(target => {
                 const config = target.configId ? this.configurations.get(target.configId) : null;
                 const configInfo = config ? chalk.gray(` (${config.mnemonic})`) : '';
                 console.log(chalk.red(`- ${target.label}${configInfo}`));
            });
        }
        
        // --- Action Details ---
        if (this.actionDetails !== 'none') {
            const actionsToDetail = this.actionDetails === 'all' 
                ? this.actions 
                : this.actions.filter(a => !a.success);

            if (actionsToDetail.length > 0) {
                const title = this.actionDetails === 'all' ? '--- All Action Details ---' : '--- Failed Action Details ---';
                console.log(chalk.bold.cyan(`\n${title}`));
                const groupedActions = new Map<string, Action[]>();
                actionsToDetail.forEach(action => {
                    const key = action.label || 'Unknown Label';
                    if (!groupedActions.has(key)) groupedActions.set(key, []);
                    groupedActions.get(key)!.push(action);
                });

                groupedActions.forEach((actions, label) => {
                    const anyFailed = actions.some(a => !a.success);
                    const status = anyFailed ? chalk.red.bold('❌ FAILURE') : chalk.green.bold('✔ SUCCESS');
                    console.log(`\n${chalk.bold.white(`${status} | ${label} (${actions.length} action${actions.length > 1 ? 's' : ''})`)}`);

                    actions.sort((a,b) => parseInt(b.actionResult?.executionInfo.wallTimeMillis || '0', 10) - parseInt(a.actionResult?.executionInfo.wallTimeMillis || '0', 10));

                    actions.forEach((action, index) => {
                        const duration = formatDuration(parseInt(action.actionResult?.executionInfo.wallTimeMillis || '0', 10));
                        console.log(`  [${index + 1}] Type: ${chalk.blue(action.mnemonic)} | Duration: ${chalk.yellow(duration)}`);
                        if (action.argv && action.argv.length > 0) {
                            const command = action.argv.join(' ');
                            const displayedCommand = this.fullCommandLine ? command : `${command.substring(0, 200)}...`;
                            console.log(chalk.yellow('    Command Line:'));
                            console.log(chalk.gray(`      ${displayedCommand}`));
                        }
                        if (action.stderrContent && action.stderrContent.trim()) {
                            console.log(chalk.yellow('    Stderr:'));
                            console.log(chalk.white(action.stderrContent.trim().split('\n').map(line => `      ${line}`).join('\n')));
                        }
                    });
                });
            }
        }

        // --- Test Summary ---
        if (this.testSummaries.length > 0) {
            console.log(chalk.bold.cyan('\n--- Test Summary ---'));
            const table = new Table({ head: ['Target', 'Status', 'Total', 'Passed', 'Failed'], colWidths: [40, 15, 10, 10, 10] });
            this.testSummaries.forEach(summary => {
                 const status = summary.overallStatus === 'PASSED' ? chalk.green(summary.overallStatus) : chalk.red(summary.overallStatus);
                 table.push([ summary.label, status, summary.totalRunCount, chalk.green(summary.passed?.length || 0), chalk.red(summary.failed?.length || 0) ]);
            });
            console.log(table.toString());
        }

        // --- Top 10 Slowest Actions ---
        if (this.actions.length > 0) {
            console.log(chalk.bold.cyan('\n--- Top 10 Slowest Actions ---'));
            const table = new Table({ head: ['Duration', 'Action Type', 'Output/Target'], colWidths: [12, 20, 60] });
            this.actions.sort((a, b) => parseInt(b.actionResult?.executionInfo.wallTimeMillis || '0', 10) - parseInt(a.actionResult?.executionInfo.wallTimeMillis || '0', 10));
            this.actions.slice(0, 10).forEach(action => {
                table.push([
                    chalk.yellow(formatDuration(parseInt(action.actionResult?.executionInfo.wallTimeMillis || '0', 10))),
                    action.mnemonic,
                    action.primaryOutput?.uri.replace('file://', '') || action.label || 'N/A',
                ]);
            });
            console.log(table.toString());
        }
        
        // --- Build Outputs (Resolved at the end) ---
        const resolvedOutputs = new Map<string, string[]>();
        this.topLevelOutputSets.forEach((fileSetIds, target) => {
            const files = new Set<string>();
            fileSetIds.forEach(id => {
                this.resolveFileSet(id).forEach(file => files.add(file.name));
            });
            resolvedOutputs.set(target, Array.from(files));
        });

        if (resolvedOutputs.size > 0) {
            console.log(chalk.bold.cyan('\n--- Build Outputs ---'));
            const outputsTable = new Table({ head: ['Target', 'Files'], style: { head: ['cyan'] }, colWidths: [40, 60], wordWrap: true });
            resolvedOutputs.forEach((files, target) => {
                outputsTable.push([target, files.join('\n')]);
            });
            console.log(outputsTable.toString());
        }
        
        // --- Convenience Symlinks ---
        if (this.convenienceSymlinks.length > 0) {
            console.log(chalk.bold.cyan('\n--- Convenience Symlinks ---'));
            const symlinksTable = new Table({ head: ['Path', 'Action', 'Target'], style: { head: ['cyan'] }});
            this.convenienceSymlinks.forEach(link => {
                const action = link.action === 'CREATE' ? chalk.green(link.action) : chalk.red(link.action);
                symlinksTable.push([link.path, action, link.target || '']);
            });
            console.log(symlinksTable.toString());
        }
    }
}
