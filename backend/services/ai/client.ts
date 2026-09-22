import OpenAI from 'openai';
import { AiUnavailableError } from './errors';

// Основной провайдер (OpenRouter совместимый)
const BASE_URL = 'https://openrouter.ai/api/v1';

// Цепочка моделей для Graceful Degradation
const FALLBACK_MODELS = [
  'meta-llama/llama-3-70b-instruct',
  'mistralai/mistral-large',
  'qwen/qwen-2.5-coder-32b-instruct'
];

export async function requestJson<T>(
  prompt: string,
  apiKey?: string,
  preferredModel?: string
): Promise<T> {
  const key = apiKey || process.env.OPENROUTER_API_KEY;

  if (!key) {
    throw new AiUnavailableError('API Key не найден ни в конфиге, ни в env', false);
  }

  const modelsToTry = [
    preferredModel || process.env.AI_MODEL || 'openai/gpt-4o-mini',
    ...FALLBACK_MODELS
  ];

  let lastError: Error | null = null;

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    const isFallback = i > 0;

    try {
      const client = new OpenAI({
        baseURL: BASE_URL,
        apiKey: key,
        defaultHeaders: {
          'HTTP-Referer': 'http://localhost:3000', // Требуется OpenRouter
          'X-Title': 'DocParser App'
        }
      });

      console.log(isFallback ? `⚠️ Fallback: Попытка использования модели ${model}...` : `🤖 Запрос к AI: ${model}`);

      const completion = await client.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: 'Ты экспертный ассистент по анализу документов. Отвечай ТОЛЬКО в формате JSON без markdown разметки.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1, // Минимальная температура для детерминированного JSON
        response_format: { type: "json_object" }
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) throw new Error('Пустой ответ от AI');

      return JSON.parse(content) as T;

    } catch (err: any) {
      lastError = err;
      console.warn(`Ошибка модели ${model}:`, err.message);

      // Не пробуем следующую, если ошибка авторизации (ключ неверен для всех)
      if (err.status === 401 || err.status === 403) {
        throw new AiUnavailableError(`Ошибка авторизации API: ${err.message}`, false);
      }
    }
  }

  throw new AiUnavailableError(
    `Все модели исчерпаны. Последняя ошибка: ${(lastError as Error).message}`,
    true
  );
}
