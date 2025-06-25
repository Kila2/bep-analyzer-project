import {
  BuildEvent as ProtoBuildEvent,
  BuildStarted,
  BuildFinished,
  BuildToolLogs,
  Configuration,
  WorkspaceStatus,
  TestSummary as ProtoTestSummary,
  BuildMetrics,
  ActionExecuted as ProtoActionExecuted,
  BuildEventId_TargetCompletedId,
  OptionsParsed,
  UnstructuredCommandLine,
  NamedSetOfFiles,
  ConvenienceSymlinksIdentified,
  Aborted,
} from "./proto/generated/src/main/java/com/google/devtools/build/lib/buildeventstream/proto/build_event_stream";
import { CommandLine } from "./proto/generated/src/main/protobuf/command_line";

// Extended types for processing
export interface Action extends ProtoActionExecuted {
  label?: string;
  strategy?: string;
  mnemonic?: string;
  argv?: string[];
  stderrContent?: string;
  actionResult?: {
    executionInfo: { startTimeMillis: string; wallTimeMillis: string };
  };
}

export interface TestSummary extends ProtoTestSummary {
  label?: string;
}

export interface BuildEvent extends ProtoBuildEvent {
  payload?: any;
}

export {
  BuildStarted,
  BuildFinished,
  BuildToolLogs,
  Configuration,
  WorkspaceStatus,
  BuildMetrics,
  ProtoActionExecuted as ActionExecuted,
  BuildEventId_TargetCompletedId,
  OptionsParsed,
  CommandLine,
  UnstructuredCommandLine,
  NamedSetOfFiles,
  ConvenienceSymlinksIdentified,
  Aborted,
};

// A structured object containing all processed data for reporting.
export interface ReportData {
  buildStarted: BuildStarted | null;
  buildFinished: BuildFinished | null;
  buildMetrics: BuildMetrics | null;
  buildToolLogs: BuildToolLogs | null;
  actions: Action[];
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
  problems: Aborted[];
}
