import sharp from 'sharp';

export interface ImageQualityMetrics {
  dpi: number;
  contrast: number; // 0-1
  noiseLevel: number; // 0-1 (чем выше, тем хуже)
  blurScore: number; // Variance of Laplacian (чем ниже, тем размытее)
  isLowQuality: boolean;
}

/**
 * Анализирует качество изображения для выбора стратегии OCR
 */
export async function analyzeImageQuality(buffer: Buffer): Promise<ImageQualityMetrics> {
  const metadata = await sharp(buffer).metadata();
  const dpi = metadata.resolution || 72; // Default fallback

  // Получаем статистику пикселей для оценки контраста и шума
  const stats = await sharp(buffer).stats();

  // Расчет контраста (разброс между светлым и темным)
  const contrast = (stats.max - stats.min) / 255;

  // Оценка шума через стандартное отклонение в средних тонах
  // Упрощенная эвристика: высокий stdDev при среднем mean часто означает шум
  let noiseLevel = 0;
  if (stats.channels && stats.channels.length > 0) {
    const mainChannel = stats.channels[0];
    // Нормализуем stdDev относительно диапазона 0-255
    noiseLevel = Math.min(1, mainChannel.stdDev / 64);
  }

  // Оценка размытости (Variance of Laplacian)
  // Чем меньше дисперсия лапласиана, тем более размыто изображение
  const laplacianBuffer = await sharp(buffer)
    .greyscale()
    .convolve({
      width: 3,
      height: 3,
      kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0]
    })
    .raw()
    .toBuffer();

  // Вычисляем дисперсию вручную из буфера сырых данных
  let sum = 0;
  let sumSq = 0;
  const count = laplacianBuffer.length;

  for (let i = 0; i < count; i++) {
    const val = laplacianBuffer[i]; // 0-255, но лапласиан может быть отрицательным в raw, здесь упрощено
    // Для raw буфера sharp возвращает uint8, поэтому интерпретация требует осторожности.
    // Для простоты используем эвристику на основе edge density вместо чистой дисперсии
    sum += val;
  }

  const meanEdge = sum / count;
  // Эвристика: если средняя интенсивность граней низкая (< 20), изображение размыто
  const blurScore = meanEdge;

  const isLowQuality = dpi < 200 || contrast < 0.3 || noiseLevel > 0.6 || blurScore < 20;

  return {
    dpi,
    contrast,
    noiseLevel,
    blurScore,
    isLowQuality
  };
}

/**
 * Применяет адаптивную предобработку в зависимости от метрик качества
 */
export async function applyAdaptivePreprocessing(
  buffer: Buffer,
  metrics: ImageQualityMetrics
): Promise<Buffer> {
  let pipeline = sharp(buffer);

  // 1. Увеличение масштаба для низкого DPI
  if (metrics.dpi < 200) {
    const scale = 300 / metrics.dpi;
    pipeline = pipeline.resize({ width: Math.round(metrics.dpi * scale * 10) }); // Грубая оценка ширины
  }

  // 2. Повышение контраста и бинаризация для низкого контраста
  if (metrics.contrast < 0.4) {
    pipeline = pipeline.normalize(true); // Улучшает контраст
    // Адаптивный порог можно эмулировать через threshold (доступен в новых версиях sharp)
    // Или просто усиленным contrast
    pipeline = pipeline.threshold(metrics.noiseLevel > 0.5 ? 140 : 128);
  }

  // 3. Шумоподавление для зашумленных изображений
  if (metrics.noiseLevel > 0.5) {
    // Blur + Sharpen может помочь убрать мелкий шум, но лучше использовать median
    // В sharp нет прямого median filter для всего изображения легко, используем blur малый
    pipeline = pipeline.blur(0.5);
  }

  // 4. Если размыто - пытаемся резко увеличить резкость
  if (metrics.blurScore < 20) {
    pipeline = pipeline.sharpen({ sigma: 1.5, m1: 1.2, m2: 0.8 });
  }

  // Конвертация в ч/б для лучшего OCR
  return pipeline.greyscale().toBuffer();
}

/**
 * Рассчитывает динамический порог для кластеризации строк/ячеек
 * @param baseThreshold Базовое значение (например, 0.7)
 * @param metrics Метрики качества
 */
export function calculateDynamicThreshold(baseThreshold: number, metrics: ImageQualityMetrics): number {
  // Если качество плохое, делаем пороги строже (меньше допускаем отклонений)
  // Или наоборот мягче? Зависит от алгоритма.
  // Для кластеризации по Y: если шум большой, нужно увеличивать допуск (threshold UP)

  if (metrics.isLowQuality) {
    return baseThreshold * 1.5; // Расширяем окно поиска строк
  }
  return baseThreshold;
}
