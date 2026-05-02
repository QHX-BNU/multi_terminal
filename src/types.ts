export interface SessionConfig {
  name: string;
  model?: string;
  workingDir?: string;
  description?: string;
  systemPrompt?: string;
  permissionMode?: string;
  effort?: string;
  settingsFile?: string;
  mcpConfig?: string[];
  extraArgs?: string[];
  provider?: string;
  createdAt: string;
  lastStartedAt?: string;
}

export interface InitResult {
  provider: string;
  sessionName: string;
  settingsFile?: string;
  apiKeySet: boolean;
}

export interface SessionState {
  status: 'running' | 'stopped';
  tmuxWindow: string;
  config: SessionConfig;
}

export interface SessionsStore {
  version: 1;
  sessions: Record<string, SessionState>;
}
