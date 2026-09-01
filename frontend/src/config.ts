export interface AiModel {
  id: string;
  name: string;
}

export const AI_MODELS: AiModel[] = [
  { id: 'nvidia/nemotron-3-ultra:free', name: 'Nemotron 3 Ultra (free)' },
  { id: 'google/gemma-4-31b:free', name: 'Gemma 4 31B (free)' },
  { id: 'qwen/qwen3-next-80b-a3b-instruct:free', name: 'Qwen3 Next 80B (free)' },
  { id: 'z-ai/glm-4.5-air:free', name: 'GLM 4.5 Air (free)' },
  { id: 'openai/gpt-oss-120b:free', name: 'gpt-oss-120b (free)' },
  { id: 'moonshotai/kimi-k2.6:free', name: 'Kimi K2.6 (free)' },
  { id: 'openrouter/free', name: 'Auto-router (free)' },
];

export const DEFAULT_MODEL = 'nvidia/nemotron-3-ultra:free';

export const MODEL_STORAGE_KEY = 'recon-ai-model';
