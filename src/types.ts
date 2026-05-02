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
  createdAt: string;
  lastStartedAt?: string;
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
