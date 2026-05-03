export const VALID_PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
  'dontAsk',
  'auto',
] as const;

export const VALID_EFFORT_LEVELS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type PermissionMode = (typeof VALID_PERMISSION_MODES)[number];
export type EffortLevel = (typeof VALID_EFFORT_LEVELS)[number];

export interface SessionConfig {
  name: string;
  model?: string;
  workingDir?: string;
  description?: string;
  systemPrompt?: string;
  permissionMode?: PermissionMode;
  effort?: EffortLevel;
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

export function isValidPermissionMode(value: string): value is PermissionMode {
  return (VALID_PERMISSION_MODES as readonly string[]).includes(value);
}

export function isValidEffortLevel(value: string): value is EffortLevel {
  return (VALID_EFFORT_LEVELS as readonly string[]).includes(value);
}

export function validateSessionConfig(config: Partial<SessionConfig>): string[] {
  const errors: string[] = [];
  if (config.permissionMode && !isValidPermissionMode(config.permissionMode)) {
    errors.push(
      `Invalid permission mode "${config.permissionMode}". Valid: ${VALID_PERMISSION_MODES.join(', ')}`,
    );
  }
  if (config.effort && !isValidEffortLevel(config.effort)) {
    errors.push(
      `Invalid effort level "${config.effort}". Valid: ${VALID_EFFORT_LEVELS.join(', ')}`,
    );
  }
  if (config.workingDir && config.workingDir.length > 4096) {
    errors.push('Working directory path is too long.');
  }
  if (config.description && config.description.length > 1024) {
    errors.push('Description is too long (max 1024 characters).');
  }
  if (config.systemPrompt && config.systemPrompt.length > 100000) {
    errors.push('System prompt is too long (max 100000 characters).');
  }
  return errors;
}
