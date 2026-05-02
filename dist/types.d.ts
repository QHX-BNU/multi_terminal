export interface SessionConfig {
    name: string;
    model?: string;
    workingDir?: string;
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
    name: string;
    status: 'running' | 'stopped';
    tmuxWindow: string;
    pid?: number;
    config: SessionConfig;
}
export interface SessionsStore {
    version: 1;
    sessions: Record<string, SessionState>;
}
