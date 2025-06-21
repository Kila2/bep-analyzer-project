#!/usr/bin/env node

import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { StaticBepAnalyzer } from './analyzer';
import { LiveBepAnalyzer } from './live-analyzer';
import path from 'path';
import chalk from 'chalk';
import { Translator } from './i18n/translator';
import { TerminalReporter } from './reporters/terminal-reporter';
import { MarkdownReporter } from './reporters/markdown-reporter';
import { HtmlReporter } from './reporters/html-reporter';
import * as fs from 'fs';

yargs(hideBin(process.argv))
  .command(
    '$0 <file>',
    'Analyze and pretty-print a Bazel BEP JSON file.',
    (yargs) => {
      return yargs
        .positional('file', {
          describe: 'Path to the build_event.json file',
          type: 'string',
          normalize: true,
          demandOption: true,
        })
        .option('watch', {
          type: 'boolean',
          description: 'Watch the file for changes and update in real-time',
          default: false,
        })
        .option('action-details', {
          type: 'string',
          description: 'Set the level of detail for actions.',
          choices: ['none', 'failed', 'all'],
          default: 'failed',
        })
        .option('wide', {
          alias: 'w',
          type: 'count',
          description: 'Widen command line output. Use -w for wider, -ww for unlimited.',
        })
        .option('output-markdown', {
          type: 'string',
          description: 'Path to save a Markdown report.',
          normalize: true
        })
        .option('output-html', {
          type: 'string',
          description: 'Path to save a static HTML report.',
          normalize: true
        })
        .option('lang', {
          type: 'string',
          description: 'Language for the report.',
          choices: ['en', 'zh'],
          default: 'en'
        });
    },
    async (argv) => {
      const filePath = path.resolve(argv.file as string);
      const actionDetails = argv.actionDetails as 'none' | 'failed' | 'all';
      const wideLevel = argv.w as number;
      const lang = argv.lang as 'en' | 'zh';
      const translator = new Translator(lang);

      if (argv.watch) {
        console.log(chalk.blue(`Watching file in real-time: ${filePath}`));
        const analyzer = new LiveBepAnalyzer(actionDetails, wideLevel);
        try {
          await analyzer.tailFile(filePath);
          // After live session, generate full reports if requested
          const reportData = analyzer.getReportData();
          const terminalReporter = new TerminalReporter(reportData, wideLevel, translator);
          terminalReporter.printReport(); // Always print final terminal report

          if (argv.outputMarkdown) {
            const markdownReporter = new MarkdownReporter(reportData, wideLevel, translator);
            fs.writeFileSync(argv.outputMarkdown, markdownReporter.getReport());
            console.log(chalk.green(`Markdown report saved to ${argv.outputMarkdown}`));
          }
          if (argv.outputHtml) {
            const htmlReporter = new HtmlReporter(reportData, wideLevel, translator);
            fs.writeFileSync(argv.outputHtml, htmlReporter.getReport());
            console.log(chalk.green(`HTML report saved to ${argv.outputHtml}`));
          }

          console.log(chalk.bold.green(`\n${translator.t('analysisComplete')}`));

        } catch (error) {
          console.error(chalk.bold.red(`\n${translator.t('analysisFailed')}`));
          process.exit(1);
        }
      } else {
        console.log(chalk.blue(`Analyzing completed file: ${filePath}`));
        const analyzer = new StaticBepAnalyzer(actionDetails, wideLevel);
        await analyzer.analyze(filePath);
        const reportData = analyzer.getReportData();

        // Generate all requested reports
        const terminalReporter = new TerminalReporter(reportData, wideLevel, translator);
        terminalReporter.printReport();

        if (argv.outputMarkdown) {
          const markdownReporter = new MarkdownReporter(reportData, wideLevel, translator);
          fs.writeFileSync(argv.outputMarkdown, markdownReporter.getReport());
          console.log(chalk.green(`Markdown report saved to ${argv.outputMarkdown}`));
        }
        if (argv.outputHtml) {
          const htmlReporter = new HtmlReporter(reportData, wideLevel, translator);
          fs.writeFileSync(argv.outputHtml, htmlReporter.getReport());
          console.log(chalk.green(`HTML report saved to ${argv.outputHtml}`));
        }
        
        console.log(chalk.bold.green(`\n${translator.t('analysisComplete')}`));
      }
    }
  )
  .help()
  .alias('h', 'help')
  .parse();
