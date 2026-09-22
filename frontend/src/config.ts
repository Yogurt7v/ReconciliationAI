export interface AiModel {
  id: string;
  name: string;
  provider: string;
  description: string;
}

export const AI_MODELS: AiModel[] = [
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'OpenAI',
    description: 'Быстрая и эффективная модель по умолчанию'
  },
  {
    id: 'meta-llama/llama-3-70b-instruct',
    name: 'Llama 3 70B',
    provider: 'Meta',
    description: 'Мощная открытая модель, отличная альтернатива'
  },
  {
    id: 'mistralai/mistral-large',
    name: 'Mistral Large',
    provider: 'Mistral',
    description: 'Топовая европейская модель'
  },
  {
    id: 'qwen/qwen-2.5-coder-32b-instruct',
    name: 'Qwen 2.5 Coder',
    provider: 'Alibaba',
    description: 'Специализирована на структурированных данных'
  }
];

export const DEFAULT_MODEL = 'openai/gpt-4o-mini';
export const API_KEY_STORAGE_KEY = 'doc_parser_api_key';
