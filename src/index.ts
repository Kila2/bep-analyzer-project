#!/usr/bin/env node

import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { StaticBepAnalyzer } from "./analyzer";
import { LiveBepAnalyzer, LiveDisplayMode } from "./live-analyzer";
import path from "path";
import chalk from "chalk";
import { Translator } from "./i18n/translator";
import { TerminalReporter } from "./reporters/terminal-reporter";
import { MarkdownReporter } from "./reporters/markdown-reporter";
import { HtmlReporter } from "./reporters/html-reporter";
import * as fs from "fs";

yargs(hideBin(process.argv))
  .command(
    "$0 <file>",
    "Analyze and pretty-print a Bazel BEP JSON file.",
    (yargs) => {
      return yargs
        .positional("file", {
          describe: "Path to the build_event.json or build_event.pb file",
          type: "string",
          normalize: true,
          demandOption: true,
        })
        .option("format", {
          type: "string",
          description: "Format of the input file.",
          choices: ["json", "pb"],
          default: "json",
        })
        .option("watch", {
          alias: "l", // for "live"
          type: "boolean",
          description:
            "Watch the file and show a real-time dashboard in the terminal",
          default: false,
        })
        .option("output-vscode-log", {
          type: "boolean",
          description:
            "Watch file and output a machine-readable log for VSCode Output Channels.",
          default: false,
        })
        .option("output-vscode-status", {
          type: "boolean",
          description:
            "Watch file and output a single, updating line for VSCode Status Bar.",
          default: false,
        })
        .option("action-details", {
          type: "string",
          description: "Set the level of detail for actions.",
          choices: ["none", "failed", "all"],
          default: "failed",
        })
        .option("wide", {
          alias: "w",
          type: "count",
          description:
            "Widen command line output. Use -w for wider, -ww for very wide.",
        })
        .option("output-markdown", {
          type: "string",
          description: "Path to save a Markdown report.",
          normalize: true,
        })
        .option("output-html", {
          type: "string",
          description: "Path to save a static HTML report.",
          normalize: true,
        })
        .option("lang", {
          type: "string",
          description: "Language for the report.",
          choices: ["en", "zh"],
          default: "en",
        });
    },
    async (argv) => {
      const filePath = path.resolve(argv.file as string);
      const actionDetails = argv.actionDetails as "none" | "failed" | "all";
      const wideLevel = argv.w as number;
      const lang = argv.lang as "en" | "zh";
      const translator = new Translator(lang);
      const format = argv.format as "json" | "pb";

      const isLive =
        argv.watch || argv.outputVscodeLog || argv.outputVscodeStatus;

      if (isLive) {
        if (format === "pb") {
          console.error(
            chalk.red(
              "Error: Watch mode is not supported for binary protobuf (.pb) format.",
            ),
          );
          process.exit(1);
        }

        let displayMode: LiveDisplayMode = "dashboard";
        if (argv.outputVscodeLog) {
          displayMode = "vscode-log";
        } else if (argv.outputVscodeStatus) {
          displayMode = "vscode-status";
        }

        if (displayMode === "dashboard") {
          console.log(chalk.blue(`Watching file in real-time: ${filePath}`));
        }

        const analyzer = new LiveBepAnalyzer(
          actionDetails,
          wideLevel,
          displayMode,
        );
        try {
          await analyzer.tailFile(filePath);

          // For dashboard mode, print a final summary. For other modes, this is handled by the analyzer itself.
          if (displayMode === "dashboard") {
            const reportData = analyzer.getReportData();
            const terminalReporter = new TerminalReporter(
              reportData,
              wideLevel,
              translator,
            );
            terminalReporter.printReport(); // Always print final terminal report

            if (argv.outputMarkdown) {
              const markdownReporter = new MarkdownReporter(
                reportData,
                wideLevel,
                translator,
              );
              fs.writeFileSync(
                argv.outputMarkdown,
                markdownReporter.getReport(),
              );
              console.log(
                chalk.green(`Markdown report saved to ${argv.outputMarkdown}`),
              );
            }
            if (argv.outputHtml) {
              const htmlReporter = new HtmlReporter(
                reportData,
                wideLevel,
                translator,
              );
              fs.writeFileSync(argv.outputHtml, htmlReporter.getReport());
              console.log(
                chalk.green(`HTML report saved to ${argv.outputHtml}`),
              );
            }

            console.log(
              chalk.bold.green(`\n${translator.t("analysisComplete")}`),
            );
          }
        } catch (error) {
          if (displayMode === "dashboard") {
            console.error(
              chalk.bold.red(`\n${translator.t("analysisFailed")}`),
            );
          }
          process.exit(1);
        }
      } else {
        console.log(
          chalk.blue(
            `Analyzing completed file: ${filePath} (format: ${format})`,
          ),
        );
        const analyzer = new StaticBepAnalyzer(actionDetails, wideLevel);
        await analyzer.analyze(filePath, format);
        const reportData = analyzer.getReportData();

        // Generate all requested reports
        const terminalReporter = new TerminalReporter(
          reportData,
          wideLevel,
          translator,
        );
        terminalReporter.printReport();

        if (argv.outputMarkdown) {
          const markdownReporter = new MarkdownReporter(
            reportData,
            wideLevel,
            translator,
          );
          fs.writeFileSync(argv.outputMarkdown, markdownReporter.getReport());
          console.log(
            chalk.green(`Markdown report saved to ${argv.outputMarkdown}`),
          );
        }
        if (argv.outputHtml) {
          const htmlReporter = new HtmlReporter(
            reportData,
            wideLevel,
            translator,
          );
          fs.writeFileSync(argv.outputHtml, htmlReporter.getReport());
          console.log(chalk.green(`HTML report saved to ${argv.outputHtml}`));
        }

        console.log(chalk.bold.green(`\n${translator.t("analysisComplete")}`));
      }
    },
  )
  .help()
  .alias("h", "help")
  .parse();
