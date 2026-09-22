export interface AiModel {
  id: string;
  name: string;
  provider?: 'openrouter' | 'local';
}

export const AI_MODELS: AiModel[] = [
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini (Fast/Cheap)', provider: 'openrouter' },
  { id: 'meta-llama/llama-3-70b-instruct', name: 'Llama 3 70B (Smart)', provider: 'openrouter' },
  { id: 'mistralai/mistral-large', name: 'Mistral Large', provider: 'openrouter' },
  { id: 'qwen/qwen-2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder', provider: 'openrouter' },
];

export const DEFAULT_MODEL = 'openai/gpt-4o-mini';

export const MODEL_STORAGE_KEY = 'recon-ai-model';
export const API_KEY_STORAGE_KEY = 'recon-ai-apikey';
