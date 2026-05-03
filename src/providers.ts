import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ProviderPreset {
  id: string;
  name: string;
  envVar: string;
  baseUrl: string;
  models: { id: string; name: string; reasoning?: boolean }[];
  defaultModel: string;
  builtin: boolean;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    baseUrl: 'https://api.anthropic.com/v1',
    models: [
      { id: 'sonnet', name: 'Claude Sonnet (latest)' },
      { id: 'opus', name: 'Claude Opus (latest)' },
      { id: 'haiku', name: 'Claude Haiku (latest)' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
      { id: 'claude-opus-4-7', name: 'Claude Opus 4.7' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
    ],
    defaultModel: 'sonnet',
    builtin: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'gpt-4.1', name: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
      { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano' },
      { id: 'o3', name: 'o3', reasoning: true },
      { id: 'o3-mini', name: 'o3 Mini', reasoning: true },
      { id: 'o4-mini', name: 'o4 Mini', reasoning: true },
    ],
    defaultModel: 'gpt-4.1',
    builtin: false,
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    envVar: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
    ],
    defaultModel: 'gemini-2.5-flash',
    builtin: false,
  },
  {
    id: 'groq',
    name: 'Groq',
    envVar: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [
      { id: 'llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B' },
      { id: 'llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick 17B' },
      { id: 'deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 Distill 70B' },
      { id: 'qwen-2.5-32b', name: 'Qwen 2.5 32B' },
      { id: 'qwen-2.5-coder-32b', name: 'Qwen 2.5 Coder 32B' },
    ],
    defaultModel: 'llama-4-maverick-17b-128e-instruct',
    builtin: false,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    envVar: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V3' },
      { id: 'deepseek-reasoner', name: 'DeepSeek R1', reasoning: true },
    ],
    defaultModel: 'deepseek-chat',
    builtin: false,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    envVar: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
      { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4' },
      { id: 'openai/gpt-4.1', name: 'GPT-4.1' },
      { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    ],
    defaultModel: 'anthropic/claude-sonnet-4',
    builtin: false,
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    envVar: '',
    baseUrl: 'http://localhost:11434/v1',
    models: [
      { id: 'llama3.3', name: 'Llama 3.3' },
      { id: 'codellama', name: 'Code Llama' },
      { id: 'qwen2.5-coder', name: 'Qwen 2.5 Coder' },
      { id: 'deepseek-r1', name: 'DeepSeek R1', reasoning: true },
    ],
    defaultModel: 'llama3.3',
    builtin: false,
  },
  {
    id: 'together',
    name: 'Together AI',
    envVar: 'TOGETHER_API_KEY',
    baseUrl: 'https://api.together.xyz/v1',
    models: [
      { id: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', name: 'Llama 4 Maverick 17B' },
      { id: 'meta-llama/Llama-4-Scout-17B-16E-Instruct', name: 'Llama 4 Scout 17B' },
      { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1', reasoning: true },
      { id: 'Qwen/Qwen2.5-Coder-32B-Instruct', name: 'Qwen 2.5 Coder 32B' },
    ],
    defaultModel: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
    builtin: false,
  },
];

export const SETTINGS_DIR = path.join(os.homedir(), '.multi-claude', 'settings');

export function getProvider(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find(p => p.id === id);
}

/**
 * Detect which providers have their API key environment variable set.
 * Builtin providers (Anthropic) are always included.
 * Ollama is always included (no env var needed — local).
 */
export function detectProviders(): ProviderPreset[] {
  return PROVIDER_PRESETS.filter(p => {
    if (p.builtin) return true;
    if (!p.envVar) return true; // ollama — always detectable
    return !!process.env[p.envVar];
  });
}

export function generateSettingsFile(provider: ProviderPreset): string {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true, mode: 0o700 });
  }

  const settings: Record<string, unknown> = {};
  settings.env = { ANTHROPIC_BASE_URL: provider.baseUrl };

  if (provider.envVar) {
    settings.apiKeyHelper = `echo $${provider.envVar}`;
  }

  const filePath = path.join(SETTINGS_DIR, `${provider.id}.json`);
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw new Error(
      `Failed to write settings file for provider "${provider.id}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return filePath;
}

export function ensureSettingsFiles(providerIds: string[]): Map<string, string> {
  const fileMap = new Map<string, string>();
  for (const id of providerIds) {
    const provider = getProvider(id);
    if (!provider || provider.builtin) continue;
    const filePath = path.join(SETTINGS_DIR, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      generateSettingsFile(provider);
    }
    fileMap.set(id, filePath);
  }
  return fileMap;
}

export function sessionNameForProvider(providerId: string, suffix?: string): string {
  const base = `claude-${providerId}`;
  return suffix ? `${base}-${suffix}` : base;
}
