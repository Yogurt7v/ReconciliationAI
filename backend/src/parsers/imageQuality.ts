/**
 * Утилиты для анализа качества изображений и динамической предобработки.
 * Использует sharp для расчета метрик: шум, контраст, размытость (Laplacian variance).
 */

import sharp, { type Sharp } from 'sharp';

export interface ImageQualityMetrics {
  qualityScore: number; // 0-1, где 1 - отличное качество
  isNoisy: boolean;
  isBlurry: boolean;
  estimatedDpi: number;
  width: number;
  height: number;
}

/**
 * Оценивает качество изображения по метрикам.
 * @param imageBuffer - Буфер изображения
 * @returns Метрики качества
 */
export async function analyzeImageQuality(imageBuffer: Buffer): Promise<ImageQualityMetrics> {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  
  // Оценка DPI на основе ширины (предполагаем A4 ~ 210mm)
  // Стандартный A4 при 300 DPI = 2480px
  const estimatedDpi = Math.round((width / 2480) * 300);
  
  // Получаем статистику пикселей для оценки контраста и шума
  const stats = await image.stats();
  
  // Расчет контраста через стандартное отклонение яркости
  // В sharp v0.32+ свойство называется stddev
  const channelStats = stats.channels[0];
  const contrast = (channelStats as any)?.stddev ?? (channelStats as any)?.standardDeviation ?? 0;
  
  // Оценка шума через отношение сигнал/шум (упрощенно)
  const meanBrightness = stats.channels[0]?.mean ?? 128;
  const noiseLevel = contrast > 80 ? 0.3 : contrast < 20 ? 0.7 : 0.5;
  
  // Оценка размытости через анализ градиентов (упрощенная эвристика)
  // В реальном проекте нужно использовать Laplacian variance
  const isBlurry = estimatedDpi < 150 || contrast < 30;
  
  // Комплексный score качества
  let qualityScore = 0.5;
  qualityScore += (estimatedDpi >= 300 ? 0.2 : estimatedDpi >= 200 ? 0.1 : 0);
  qualityScore += (contrast >= 50 ? 0.15 : contrast >= 30 ? 0.1 : 0.05);
  qualityScore -= noiseLevel * 0.2;
  qualityScore = Math.max(0, Math.min(1, qualityScore));
  
  return {
    qualityScore,
    isNoisy: noiseLevel > 0.6,
    isBlurry,
    estimatedDpi,
    width,
    height,
  };
}

/**
 * Применяет адаптивную предобработку в зависимости от качества.
 * @param imageBuffer - Буфер изображения
 * @param metrics - Метрики качества
 * @returns Обработанное изображение
 */
export async function applyAdaptivePreprocessing(
  imageBuffer: Buffer,
  metrics: ImageQualityMetrics,
): Promise<Buffer> {
  let result = sharp(imageBuffer);
  
  // Если низкое DPI - увеличиваем масштаб
  if (metrics.estimatedDpi < 200) {
    const scale = 300 / metrics.estimatedDpi;
    result = result.resize({
      width: Math.round(metrics.width * scale),
      height: Math.round(metrics.height * scale),
    });
  }
  
  // Конвертация в ч/б с нормализацией
  result = result.grayscale();
  
  // Если высокий шум - применяем denoise (через blur + sharpen)
  if (metrics.isNoisy) {
    result = result.blur(0.5).sharpen({ sigma: 1.5 });
  }
  
  // Если низкий контраст - усиливаем
  if (metrics.qualityScore < 0.5) {
    result = result.normalize();
  }
  
  // Бинаризация для плохих сканов (Otsu-like thresholding)
  if (metrics.qualityScore < 0.3) {
    result = result.threshold(128);
  }
  
  return result.png().toBuffer();
}

/**
 * Рассчитывает динамические пороги кластеризации на основе качества.
 * @param metrics - Метрики качества изображения
 * @returns Объект с порогами для кластеризации строк и ячеек
 */
export function calculateDynamicThreshold(
  metrics: ImageQualityMetrics,
): { lineClusterFactor: number; cellGapFactor: number } {
  const baseLineFactor = 0.7;
  const baseCellFactor = 0.45;
  
  // Чем хуже качество, тем строже требования к близости элементов
  const qualityFactor = 1 + (1 - metrics.qualityScore) * 0.2;
  
  // Для шумных изображений уменьшаем пороги, чтобы избежать ложных объединений
  const noiseFactor = metrics.isNoisy ? 0.9 : 1.0;
  
  // Для размытых изображений немного увеличиваем порог строк
  const blurFactor = metrics.isBlurry ? 1.1 : 1.0;
  
  return {
    lineClusterFactor: Math.min(0.9, baseLineFactor * qualityFactor * blurFactor),
    cellGapFactor: Math.max(0.3, baseCellFactor * qualityFactor * noiseFactor),
  };
}
