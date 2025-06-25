import {
  BuildEvent,
  BuildStarted,
  BuildFinished,
  BuildToolLogs,
  Configuration,
  WorkspaceStatus,
  TestSummary,
  BuildMetrics,
  ActionExecuted,
  BuildEventId_TargetCompletedId,
  OptionsParsed,
  UnstructuredCommandLine,
  NamedSetOfFiles,
  ConvenienceSymlinksIdentified,
} from "./proto/generated/src/main/java/com/google/devtools/build/lib/buildeventstream/proto/build_event_stream";
import { CommandLine } from "./proto/generated/src/main/protobuf/command_line";

export {
  ActionExecuted,
  BuildEvent,
  BuildStarted,
  BuildFinished,
  BuildToolLogs,
  Configuration,
  WorkspaceStatus,
  TestSummary,
  BuildMetrics,
  BuildEventId_TargetCompletedId,
  OptionsParsed,
  CommandLine,
  UnstructuredCommandLine,
  NamedSetOfFiles,
  ConvenienceSymlinksIdentified,
};

// A structured object containing all processed data for reporting.
export interface ReportData {
  buildStarted: BuildStarted | null;
  buildFinished: BuildFinished | null;
  buildMetrics: BuildMetrics | null;
  buildToolLogs: BuildToolLogs | null;
  actions: ActionExecuted[];
  testSummaries: TestSummary[];
  failedTargets: { label: string; configId?: string }[];
  workspaceStatus: WorkspaceStatus | null;
  configurations: Map<string, Configuration>;
  optionsParsed: OptionsParsed | null;
  structuredCommandLine: CommandLine | null;
  buildPatterns: string[];
  resolvedOutputs: Map<string, string[]>;
  convenienceSymlinks: ConvenienceSymlinksIdentified[];
  actionDetails: "none" | "failed" | "all";
}
