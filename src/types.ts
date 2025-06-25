export interface BuildEvent {
  id: {
    // Standard keys from common BEP format
    buildStarted?: any;
    buildFinished?: any;
    actionCompleted?: { primaryOutput: string; label: string };
    targetCompleted?: { label: string; configuration?: { id: string } };
    testSummary?: { label: string };
    progress?: { stdout?: string; stderr?: string };
    problem?: any;
    workspaceStatus?: any;
    configuration?: { id: string };
    buildMetrics?: any;
    buildToolLogs?: any;
    optionsParsed?: any;
    pattern?: { pattern: string[] };
    structuredCommandLine?: { commandLineLabel: string };
    namedSet?: { id: string };
    convenienceSymlinksIdentified?: any;

    // Keys found in hierarchical/older BEP formats
    started?: any;
    finished?: any;
  };
  children: any[];
  payload?: any;

  // Data fields can be at the top level or inside a payload
  started?: BuildStarted;
  finished?: BuildFinished;
  completed?: TargetCompleted;
  summary?: TestSummary;
  problem?: Problem;
  workspaceStatus?: WorkspaceStatus;
  configuration?: Configuration;
  buildMetrics?: BuildMetrics;
  buildToolLogs?: BuildToolLogs;
  optionsParsed?: OptionsParsed;
  expanded?: any;
  structuredCommandLine?: StructuredCommandLine;
  namedSetOfFiles?: NamedSetOfFiles;
  convenienceSymlinksIdentified?: ConvenienceSymlinksIdentified;
  action?: Action;
}

export interface Action {
  success: boolean;
  mnemonic: string;
  label?: string;
  primaryOutput: { uri: string };
  argv?: string[];
  commandLine?: string[];
  stderr?: { uri: string };
  stderrContent?: string;
  actionResult?: {
    executionInfo: {
      startTimeMillis: string;
      wallTimeMillis: string;
    };
  };
  type?: string;
  startTime?: string;
  endTime?: string;
  strategy?: string;
}

export interface File {
  name: string;
  uri: string;
}

export interface NamedSetOfFiles {
  files: File[];
  fileSets: { id: string }[];
}

export interface TargetCompleted {
  success: boolean;
  outputGroup: { name: string; fileSets: { id: string }[] }[];
}

export interface ConvenienceSymlink {
  path: string;
  action: "CREATE" | "DELETE" | "UNKNOWN";
  target?: string;
}

export interface ConvenienceSymlinksIdentified {
  convenienceSymlinks: ConvenienceSymlink[];
}

export interface TestSummary {
  label: string;
  overallStatus: "PASSED" | "FLAKY" | "TIMEOUT" | "FAILED" | "INCOMPLETE";
  totalRunCount: number;
  passed: { uri: string }[];
  failed: { uri: string }[];
}

export interface BuildFinished {
  overallSuccess: boolean;
  finishTimeMillis: string;
  exitCode?: { name: string };
}

export interface BuildStarted {
  command: string;
  startTimeMillis: string;
  optionsDescription?: string;
}

export interface Problem {
  message: string;
}

export interface WorkspaceStatus {
  item: { key: string; value: string }[];
}

export interface OptionsParsed {
  startupOptions: string[];
  explicitStartupOptions: string[];
  cmdLine: string[];
  explicitCmdLine: string[];
}

export interface StructuredCommandLine {
  commandLineLabel: string;
  sections: {
    sectionLabel: string;
    chunkList?: { chunk: string[] };
    optionList?: { option: { combinedForm: string }[] };
  }[];
}

export interface Configuration {
  mnemonic: string;
  platformName: string;
  cpu: string;
  makeVariable: { [key: string]: string };
}

export interface BuildToolLog {
  name: string;
  contents?: string;
  uri?: string;
}

export interface BuildToolLogs {
  log: BuildToolLog[];
}

export interface ActionMetric {
  mnemonic: string;
  actionsExecuted: string;
  actionsCreated?: string;
}

export interface RunnerCount {
  name: string;
  count: number;
  execKind?: string;
}

export interface ActionCacheStatistics {
  misses: number;
  missDetails: { reason?: string; count?: number }[];
  hits?: number;
}

export interface ActionSummary {
  actionsExecuted: string;
  actionsCreated?: string;
  actionData: ActionMetric[];
  runnerCount?: RunnerCount[];
  actionCacheStatistics?: ActionCacheStatistics;
}

export interface MemoryMetrics {
  usedHeapSizePostBuild?: string;
  peakPostGcHeapSize?: string;
  garbageMetrics?: { type: string; garbageCollected: string }[];
}

export interface TargetMetrics {
  targetsLoaded?: string;
  targetsConfigured: string;
}

export interface PackageMetrics {
  packagesLoaded: string;
}

export interface TimingMetrics {
  cpuTimeInMs: string;
  wallTimeInMs: string;
  analysisPhaseTimeInMs: string;
  executionPhaseTimeInMs: string;
}

export interface FilesMetric {
  sizeInBytes: string;
  count: number;
}

export interface ArtifactMetrics {
  sourceArtifactsRead: FilesMetric;
  outputArtifactsSeen: FilesMetric;
  outputArtifactsFromActionCache?: FilesMetric;
  topLevelArtifacts?: FilesMetric;
}

export interface EvaluationStat {
  skyfunctionName: string;
  count: string;
}

export interface BuildGraphMetrics {
  actionLookupValueCount: number;
  actionCount: number;
  outputArtifactCount: number;
  postInvocationSkyframeNodeCount?: number;
  builtValues?: EvaluationStat[];
}

export interface WorkerStats {
  workerMemoryInKb: number;
}

export interface WorkerMetrics {
  mnemonic: string;
  isMultiplex: boolean;
  workerStats?: WorkerStats[];
  actionsExecuted: string;
}

export interface WorkerPoolStats {
  mnemonic: string;
  createdCount: string;
  destroyedCount: string;
  evictedCount: string;
  aliveCount: string;
}

export interface WorkerPoolMetrics {
  workerPoolStats: WorkerPoolStats[];
}

export interface SystemNetworkStats {
  bytesSent: string;
  bytesRecv: string;
}

export interface NetworkMetrics {
  systemNetworkStats?: SystemNetworkStats;
}

export interface BuildMetrics {
  actionSummary: ActionSummary;
  memoryMetrics: MemoryMetrics;
  targetMetrics: TargetMetrics;
  packageMetrics: PackageMetrics;
  timingMetrics: TimingMetrics;
  artifactMetrics: ArtifactMetrics;
  buildGraphMetrics: BuildGraphMetrics;
  workerMetrics?: WorkerMetrics[];
  workerPoolMetrics?: WorkerPoolMetrics;
  networkMetrics?: NetworkMetrics;
}

// A structured object containing all processed data for reporting.
export interface ReportData {
  buildStarted: BuildStarted | null;
  buildFinished: BuildFinished | null;
  buildMetrics: BuildMetrics | null;
  buildToolLogs: BuildToolLogs | null;
  actions: Action[];
  testSummaries: TestSummary[];
  problems: Problem[];
  failedTargets: { label: string; configId?: string }[];
  workspaceStatus: WorkspaceStatus | null;
  configurations: Map<string, Configuration>;
  optionsParsed: OptionsParsed | null;
  structuredCommandLine: StructuredCommandLine | null;
  buildPatterns: string[];
  resolvedOutputs: Map<string, string[]>;
  convenienceSymlinks: ConvenienceSymlink[];
  actionDetails: "none" | "failed" | "all";
}
