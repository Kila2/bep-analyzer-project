import * as fs from 'fs';
import * as readline from 'readline';
import chalk from 'chalk';
import Table from 'cli-table3';
import { BepEvent, Action, TestSummary, BuildFinished, BuildStarted, Problem, WorkspaceStatus, Configuration, BuildMetrics } from './types';

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

export class StaticBepAnalyzer {
    protected buildStarted: BuildStarted | null = null;
    protected buildFinished: BuildFinished | null = null;
    protected buildMetrics: BuildMetrics | null = null;
    protected readonly actions: Action[] = [];
    protected readonly testSummaries: TestSummary[] = [];
    protected readonly problems: Problem[] = [];
    protected readonly failedTargets: {label: string, configId?: string}[] = [];
    protected workspaceStatus: WorkspaceStatus | null = null;
    protected readonly configurations: Map<string, Configuration> = new Map();


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
                if (data.completed) {
                    const action = data.completed as Action;
                    action.label = id.actionCompleted!.label;
                    if (action.actionResult?.executionInfo?.wallTimeMillis) {
                        this.actions.push(action);
                    }
                }
                break;
            case 'testSummary':
                if (data.summary) {
                    const summary = data.summary as TestSummary;
                    summary.label = id.testSummary!.label;
                    const existingIndex = this.testSummaries.findIndex(s => s.label === summary.label);
                    if (existingIndex > -1) {
                        this.testSummaries[existingIndex] = summary;
                    } else {
                        this.testSummaries.push(summary);
                    }
                }
                break;
            case 'problem':
                if (data.problem) this.problems.push(data.problem as Problem);
                break;
            case 'targetCompleted':
                const completedData = data.completed;
                if (completedData && !completedData.success) {
                    this.failedTargets.push({
                        label: id.targetCompleted!.label,
                        configId: id.targetCompleted!.configuration?.id
                    });
                }
                break;
            case 'workspaceStatus':
                if (data.workspaceStatus) this.workspaceStatus = data.workspaceStatus;
                break;
            case 'configuration':
                if (data.configuration) this.configurations.set(id.configuration!.id, data.configuration);
                break;
            case 'buildMetrics':
                if (data.buildMetrics) this.buildMetrics = data.buildMetrics;
                break;
        }
    }

    public printReport(): void {
        if (!this.buildStarted || !this.buildFinished) {
            console.error(chalk.red('Error: Build start or finish event not found. The BEP file may be incomplete or invalid.'));
            return;
        }

        console.log(chalk.bold.cyan('\n--- Build Summary ---'));
        const success = this.buildFinished.overallSuccess;
        const status = success ? chalk.green('SUCCESS') : chalk.red('FAILURE');
        console.log(`Status: ${status}`);
        
        const startTime = parseInt(this.buildStarted.startTimeMillis, 10);
        const finishTime = parseInt(this.buildFinished.finishTimeMillis, 10);
        const duration = formatDuration(finishTime - startTime);
        console.log(`Total Time: ${chalk.yellow(duration)}`);
        console.log(`Command: ${chalk.gray(this.buildStarted.command)}`);

        if (this.buildMetrics?.timingMetrics) {
            const metrics = this.buildMetrics.timingMetrics;
            console.log(`  - Analysis Phase: ${chalk.magenta(formatDuration(Number(metrics.analysisPhaseTimeInMs)))}`);
            console.log(`  - Execution Phase: ${chalk.magenta(formatDuration(Number(metrics.executionPhaseTimeInMs)))}`);
        }

        if (this.workspaceStatus) {
             console.log(chalk.bold.cyan('\n--- Workspace Info ---'));
             this.workspaceStatus.item.forEach(item => {
                 console.log(`${item.key}: ${chalk.gray(item.value)}`);
             });
        }

        if (this.buildMetrics?.actionSummary) {
            console.log(chalk.bold.cyan('\n--- Build Metrics ---'));
            const metrics = this.buildMetrics;
            console.log(`Targets Configured: ${chalk.blue(formatNumber(metrics.targetMetrics.targetsConfigured))}`);
            console.log(`Actions Executed: ${chalk.blue(formatNumber(metrics.actionSummary.actionsExecuted))}`);
            
            const table = new Table({ head: ['Action Type', 'Count'], colWidths: [30, 15], style: {head: ['cyan']} });
            metrics.actionSummary.actionData
                .filter(a => Number(a.actionsExecuted) > 0)
                .sort((a,b) => Number(b.actionsExecuted) - Number(a.actionsExecuted))
                .slice(0, 5) // Show top 5
                .forEach(action => {
                    table.push([action.mnemonic, formatNumber(action.actionsExecuted)]);
                });
            console.log(table.toString());
        }

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
        
        const failedActions = this.actions.filter(a => !a.success);
        if (failedActions.length > 0) {
            console.log(chalk.bold.red('\n--- Failed Actions ---'));
            const table = new Table({ head: ['Action Type', 'Target/Label'], colWidths: [20, 80] });
            failedActions.forEach(action => {
                table.push([
                    action.mnemonic,
                    action.label || action.primaryOutput?.uri.replace('file://', '') || 'N/A'
                ]);
            });
            console.log(table.toString());
        }

        if (this.testSummaries.length > 0) {
            console.log(chalk.bold.cyan('\n--- Test Summary ---'));
            const table = new Table({ head: ['Target', 'Status', 'Total', 'Passed', 'Failed'], colWidths: [40, 15, 10, 10, 10] });
            this.testSummaries.forEach(summary => {
                 const status = summary.overallStatus === 'PASSED' ? chalk.green(summary.overallStatus) : chalk.red(summary.overallStatus);
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

        if (this.actions.length > 0) {
            console.log(chalk.bold.cyan('\n--- Top 10 Slowest Actions ---'));
            this.actions.sort((a, b) => 
                parseInt(b.actionResult.executionInfo.wallTimeMillis, 10) - 
                parseInt(a.actionResult.executionInfo.wallTimeMillis, 10)
            );

            const table = new Table({ head: ['Duration', 'Action Type', 'Output/Target'], colWidths: [12, 20, 60] });
            this.actions.slice(0, 10).forEach(action => {
                table.push([
                    chalk.yellow(formatDuration(parseInt(action.actionResult.executionInfo.wallTimeMillis, 10))),
                    action.mnemonic,
                    action.primaryOutput?.uri.replace('file://', '') || action.label || 'N/A',
                ]);
            });
            console.log(table.toString());
        }
    }
}
