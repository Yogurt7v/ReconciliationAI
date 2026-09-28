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
  // Локальные модели через Ollama (backend должен быть запущен с AI_PROVIDER=ollama).
  // ID = имя модели в Ollama (`ollama pull <id>`). Ключ API не требуется.
  { id: 'qwen2.5:7b-instruct', name: 'Qwen 2.5 7B — локально (Ollama)', provider: 'local' },
  { id: 'qwen2.5:3b-instruct', name: 'Qwen 2.5 3B — локально, быстрый (Ollama)', provider: 'local' },
  { id: 'llama3.1:8b', name: 'Llama 3.1 8B — локально (Ollama)', provider: 'local' },
  { id: 'llama3.2:3b', name: 'Llama 3.2 3B — локально, лёгкий (Ollama)', provider: 'local' },
  { id: 'mistral-nemo:12b', name: 'Mistral Nemo 12B — локально (Ollama)', provider: 'local' },
];

/** Пресеты локальных моделей для подсказок в UI */
export const LOCAL_MODEL_PRESETS = AI_MODELS.filter((m) => m.provider === 'local').map((m) => m.id);

export const DEFAULT_MODEL = 'openai/gpt-4o-mini';

export const MODEL_STORAGE_KEY = 'recon-ai-model';
export const API_KEY_STORAGE_KEY = 'recon-ai-apikey';
