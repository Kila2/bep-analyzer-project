import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import chalk from "chalk";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { BuildEvent as BuildEventProto } from "./proto/generated/src/main/java/com/google/devtools/build/lib/buildeventstream/proto/build_event_stream";
import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";

interface BepEventWithTime {
  line: string;
  data: Uint8Array | null;
  timestamp: number; // in milliseconds
}

function getEventTimestamp(event: any): number | null {
  const eventId = event.id;
  const data = event.payload || event;

  if (data?.started?.startTimeMillis) {
    return parseInt(data.started.startTimeMillis, 10);
  }

  if (data?.finished?.finishTimeMillis) {
    return parseInt(data.finished.finishTimeMillis, 10);
  }

  if (eventId?.actionCompleted && data.completed?.actionResult?.executionInfo) {
    const info = data.completed.actionResult.executionInfo;
    if (info.startTimeMillis && info.wallTimeMillis) {
      const start = parseInt(info.startTimeMillis, 10);
      const duration = parseInt(info.wallTimeMillis, 10);
      return start + duration;
    }
  }

  return null;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function simulateBepStream(
  sourceFile: string,
  targetFile: string,
  sourceFormat: "json" | "pb",
  speedFactor: number,
  maxDelayMs: number,
  intervalMs: number,
) {
  console.log(
    chalk.blue(
      `Reading source BEP file: ${sourceFile} (format: ${sourceFormat})`,
    ),
  );

  if (!fs.existsSync(sourceFile)) {
    console.error(chalk.red(`Error: Source file not found at ${sourceFile}`));
    process.exit(1);
  }

  fs.writeFileSync(targetFile, "");
  console.log(chalk.green(`Cleared/Created target file: ${targetFile}`));

  const events: BepEventWithTime[] = [];
  let lastTimestamp: number | null = null;
  let firstTimestamp: number | null = null;

  if (sourceFormat === "pb") {
    const fileBuffer = fs.readFileSync(sourceFile);
    const reader = new BinaryReader(fileBuffer);
    while (reader.pos < reader.len) {
      try {
        const varintLen = reader.uint32();
        const messageEnd = reader.pos + varintLen;
        const event = BuildEventProto.decode(
          fileBuffer.subarray(reader.pos, messageEnd),
        );
        const timestamp = getEventTimestamp(event);

        const jsonData = JSON.stringify(BuildEventProto.toJSON(event));

        if (timestamp) {
          if (!firstTimestamp) firstTimestamp = timestamp;
          events.push({ line: jsonData, data: null, timestamp });
          lastTimestamp = timestamp;
        } else if (lastTimestamp) {
          events.push({ line: jsonData, data: null, timestamp: lastTimestamp });
        } else {
          events.push({ line: jsonData, data: null, timestamp: 0 });
        }
        reader.pos = messageEnd;
      } catch (e) {
        console.warn(
          chalk.yellow("Failed to parse a PB message, skipping."),
          e,
        );
        break;
      }
    }
  } else {
    const fileStream = fs.createReadStream(sourceFile);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (line.trim() === "") continue;
      try {
        const event = JSON.parse(line);
        const timestamp = getEventTimestamp(event);

        if (timestamp) {
          if (!firstTimestamp) firstTimestamp = timestamp;
          events.push({ line, data: null, timestamp });
          lastTimestamp = timestamp;
        } else if (lastTimestamp) {
          events.push({ line, data: null, timestamp: lastTimestamp });
        } else {
          events.push({ line, data: null, timestamp: 0 });
        }
      } catch (e) {}
    }
  }

  if (events.length === 0) {
    console.warn(
      chalk.yellow("No valid events could be processed from the source file."),
    );
    return;
  }

  if (events[0].timestamp === 0 && firstTimestamp) {
    events[0].timestamp = firstTimestamp;
  }

  events.sort((a, b) => a.timestamp - b.timestamp);

  const targetStream = fs.createWriteStream(targetFile, { flags: "a" });

  if (intervalMs > 0) {
    console.log(chalk.cyan(`Starting simulation in interval mode...`));
    console.log(chalk.yellow(`Delay per event: ${intervalMs}ms`));

    for (const event of events) {
      if (event.line.trim() === "") continue;
      await delay(intervalMs);
      targetStream.write(event.line + "\n");
      process.stdout.write(chalk.green("."));
    }
    targetStream.end();
    console.log(chalk.bold.green("\n\nInterval simulation finished!"));
    return;
  }

  console.log(
    chalk.cyan(`Starting simulation... Replaying ${events.length} events.`),
  );
  console.log(chalk.gray(`(Use Ctrl+C to stop)`));
  console.log(chalk.yellow(`Speed Factor: ${speedFactor}x`));
  if (maxDelayMs < Infinity) {
    console.log(chalk.yellow(`Max Delay: ${maxDelayMs}ms`));
  }

  return new Promise<void>((resolve, reject) => {
    targetStream.on("error", (err) => {
      console.error(chalk.red("\nError writing to target file:"), err);
      reject(err);
    });

    targetStream.on("finish", () => {
      console.log(chalk.bold.green("\n\nSimulation finished!"));
      resolve();
    });

    (async () => {
      try {
        let previousTimestamp = events[0].timestamp;

        for (const event of events) {
          const timeDiff = event.timestamp - previousTimestamp;
          let delayTime = timeDiff / speedFactor;

          if (delayTime > maxDelayMs) {
            delayTime = maxDelayMs;
          }

          if (delayTime > 0) {
            await delay(delayTime);
          }

          const canContinue = targetStream.write(event.line + "\n");
          process.stdout.write(chalk.green("."));

          if (!canContinue) {
            await new Promise<void>((resolve) =>
              targetStream.once("drain", () => resolve()),
            );
          }

          previousTimestamp = event.timestamp;
        }

        targetStream.end();
      } catch (err) {
        reject(err);
      }
    })();
  });
}

yargs(hideBin(process.argv))
  .command(
    "simulate <source> <target>",
    "Simulate a real-time BEP stream from a completed file.",
    (yargs) => {
      return yargs
        .positional("source", {
          describe: "Path to the source completed BEP JSON or PB file",
          type: "string",
          demandOption: true,
        })
        .positional("target", {
          describe: "Path to the target file to write the JSON stream to",
          type: "string",
          demandOption: true,
        })
        .option("source-format", {
          describe: "Format of the source file",
          choices: ["json", "pb"],
          default: "json",
        })
        .option("speed", {
          alias: "s",
          type: "number",
          description: "Playback speed factor. 2 means twice as fast.",
          default: 1.0,
        })
        .option("max-delay", {
          type: "number",
          description:
            "Maximum delay in milliseconds between events to simulate.",
          default: Infinity,
        })
        .option("interval", {
          type: "number",
          description:
            "Fixed interval in ms between each event, ignoring timestamps.",
          default: 0,
        });
    },
    async (argv) => {
      try {
        const sourceFile = path.resolve(argv.source as string);
        const targetFile = path.resolve(argv.target as string);
        const sourceFormat = argv.sourceFormat as "json" | "pb";
        const speedFactor = argv.speed as number;
        const maxDelay = argv.maxDelay as number;
        const interval = argv.interval as number;

        await simulateBepStream(
          sourceFile,
          targetFile,
          sourceFormat,
          speedFactor,
          maxDelay,
          interval,
        );
      } catch (error) {
        console.error(chalk.bold.red("\nSimulation failed due to an error."));
        console.error(error);
        process.exit(1);
      }
    },
  )
  .demandCommand(1)
  .help()
  .parse();
