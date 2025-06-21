#!/usr/bin/env node

import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { StaticBepAnalyzer } from './analyzer';
import { LiveBepAnalyzer } from './live-analyzer';
import path from 'path';
import chalk from 'chalk';

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
          alias: 'w',
          type: 'boolean',
          description: 'Watch the file for changes and update in real-time',
          default: false,
        });
    },
    async (argv) => {
      const filePath = path.resolve(argv.file as string);

      if (argv.watch) {
        console.log(chalk.blue(`Watching file in real-time: ${filePath}`));
        const analyzer = new LiveBepAnalyzer();
        try {
          await analyzer.tailFile(filePath);
          console.log(chalk.bold.green('Build finished. Generating final report...'));
          analyzer.printReport();
          console.log(chalk.bold.green('\nAnalysis complete.'));

        } catch (error) {
          console.error(chalk.bold.red('\nAnalysis failed due to an error.'));
          process.exit(1);
        }
      } else {
        console.log(chalk.blue(`Analyzing completed file: ${filePath}`));
        const analyzer = new StaticBepAnalyzer();
        await analyzer.analyze(filePath);
        analyzer.printReport();
        console.log(chalk.bold.green('\nAnalysis complete.'));
      }
    }
  )
  .help()
  .alias('h', 'help')
  .parse();
