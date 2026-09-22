export class AiUnavailableError extends Error {
  public fallbackUsed: boolean;

  constructor(message: string, fallbackUsed: boolean) {
    super(message);
    this.name = 'AiUnavailableError';
    this.fallbackUsed = fallbackUsed;

    // Сохраняем стек вызовов (для Node.js)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AiUnavailableError);
    }
  }
}
