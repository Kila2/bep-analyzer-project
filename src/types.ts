export interface BepEvent {
  id: {
    // Standard keys from common BEP format
    buildStarted?: any;
    buildFinished?: any;
    actionCompleted?: { primaryOutput: string; label: string };
    targetCompleted?: { label: string; configuration?: { id: string } };
    testSummary?: { label: string; };
    progress?: { stdout?: string; stderr?: string; };
    problem?: any;
    workspaceStatus?: any;
    configuration?: { id: string };
    buildMetrics?: any; // For build performance metrics

    // Keys found in hierarchical/older BEP formats (like your example)
    started?: any; 
    finished?: any;
  };
  children: any[];
  // payload is optional to support different BEP formats
  payload?: any; 

  // Data fields can be at the top level or inside a payload
  started?: BuildStarted;
  finished?: BuildFinished;
  completed?: any; // For actionCompleted, targetCompleted
  summary?: TestSummary;
  problem?: Problem;
  workspaceStatus?: WorkspaceStatus;
  configuration?: Configuration;
  buildMetrics?: BuildMetrics;
}

export interface Action {
  success: boolean;
  mnemonic: string;
  label?: string;
  primaryOutput: { uri: string };
  // Add argv for potentially showing compile commands on failure
  argv?: string[]; 
  actionResult: {
    executionInfo: {
      startTimeMillis: string;
      wallTimeMillis: string;
    }
  }
}

export interface TestSummary {
  label: string;
  overallStatus: 'PASSED' | 'FLAKY' | 'TIMEOUT' | 'FAILED' | 'INCOMPLETE';
  totalRunCount: number;
  passed: { uri: string }[];
  failed: { uri: string }[];
}

export interface BuildFinished {
  overallSuccess: boolean;
  finishTimeMillis: string;
}

export interface BuildStarted {
  command: string;
  startTimeMillis: string;
}

export interface Problem {
    message: string;
}

export interface WorkspaceStatus {
    item: { key: string; value: string }[];
}

export interface Configuration {
    mnemonic: string;
    platformName: string;
    cpu: string;
    makeVariable: { [key: string]: string };
}

// --- New Types for BuildMetrics Event ---

export interface ActionMetric {
    mnemonic: string;
    actionsExecuted: string;
}

export interface TimingMetrics {
    cpuTimeInMs: string;
    wallTimeInMs: string;
    analysisPhaseTimeInMs: string;
    executionPhaseTimeInMs: string;
}

export interface BuildMetrics {
    actionSummary: {
        actionsExecuted: string;
        actionData: ActionMetric[];
    };
    memoryMetrics: {
        peakHeapSize: string;
        // ... and other memory metrics
    };
    timingMetrics: TimingMetrics;
    targetMetrics: {
        targetsConfigured: string;
    };
}
