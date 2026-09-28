/**
 * Утилиты для анализа качества изображений и динамической предобработки.
 * Использует sharp для расчета метрик: шум (median-residual), контраст
 * (stdev яркости) и размытость (Laplacian variance).
 */

import sharp from 'sharp';

export interface ImageQualityMetrics {
  qualityScore: number; // 0-1, где 1 - отличное качество
  isNoisy: boolean;
  isBlurry: boolean;
  estimatedDpi: number;
  width: number;
  height: number;
}

/** Ядро Лапласа 3×3 для оценки энергии границ (размытость) */
const LAPLACIAN_KERNEL = {
  width: 3,
  height: 3,
  kernel: [0, -1, 0, -1, 4, -1, 0, -1, 0],
};

/**
 * Средний модуль отклонения пикселя от медианного фильтра 3×3.
 * Медиана сохраняет края, но срезает импульсный шум — поэтому остаток
 * у «чистого» скана мал, а у зашумлённого заметно больше нуля.
 * Порог noisy: значение > NOISE_THRESHOLD (0..255 шкала).
 */
const NOISE_THRESHOLD = 0.2;

/** Laplacian variance ниже этого значения — изображение размытое */
const BLUR_LAP_VAR_THRESHOLD = 300;

/** «Идеальная» Laplacian variance для нормировки sharpness (0..1) */
const LAP_VAR_GOOD = 1000;

/** stdev яркости, при котором контраст считается полным (0..255) */
const STDDEV_GOOD = 60;

/** Оцениваемый DPI «эталонного» A4 при 300 DPI (210 мм) */
const A4_WIDTH_300DPI = 2480;

/** Медианный фильтр странгулирует большую часть шума */
const NOISE_SATURATION = 20;

async function medianResidual(image: sharp.Sharp): Promise<number> {
  const [raw, med] = await Promise.all([
    image.clone().grayscale().raw().toBuffer(),
    image.clone().grayscale().median(3).raw().toBuffer(),
  ]);
  let sum = 0;
  for (let i = 0; i < raw.length; i++) {
    sum += Math.abs(raw[i]! - med[i]!);
  }
  return raw.length > 0 ? sum / raw.length : 0;
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

  // DPI: для растровых изображений берём из метаданных, иначе оцениваем
  // по ширине относительно A4 при 300 DPI
  const estimatedDpi = Math.round(
    (metadata.density == null ? (width / A4_WIDTH_300DPI) * 300 : metadata.density),
  );

  const stats = await image.clone().stats();
  const ch = stats.channels[0];
  const stdev = ch?.stdev ?? 0;

  // Размытость: энергия границ через variance лапласиана.
  // У чёткого текста она заметно выше, чем у размытого.
  const lapStats = await image.clone().grayscale().convolve(LAPLACIAN_KERNEL).stats();
  const lapVar = (lapStats.channels[0]?.stdev ?? 0) ** 2;

  const resid = await medianResidual(image);
  const noiseLevel = Math.min(1, resid / NOISE_SATURATION);

  const isNoisy = noiseLevel > NOISE_THRESHOLD;
  const isBlurry = lapVar < BLUR_LAP_VAR_THRESHOLD;

  // Контраст и резкость нормируются в 0..1, шум вычитается мультипликативно,
  // чтобы зашумленное изображение не получало высокий score за счёт резкости.
  const sharpness = Math.min(1, lapVar / LAP_VAR_GOOD);
  const contrast = Math.min(1, stdev / STDDEV_GOOD);
  const qualityScore = Math.min(1, (1 - noiseLevel) * (0.5 * sharpness + 0.5 * contrast));

  return {
    qualityScore,
    isNoisy,
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

  // Если низкое DPI - увеличиваем масштаб (только когда реально низкое
  // разрешение, иначе у «перерисованных» страниц как-либо не меньше).
  if (metrics.estimatedDpi > 0 && metrics.estimatedDpi < 200) {
    const scale = 300 / metrics.estimatedDpi;
    if (scale > 1) {
      result = result.resize({
        width: Math.round(metrics.width * scale),
        height: Math.round(metrics.height * scale),
      });
    }
  }

  // Конвертация в ч/б
  result = result.grayscale();

  // Если высокий шум - применяем denoise (через blur + sharpen)
  if (metrics.isNoisy) {
    result = result.blur(0.5).sharpen({ sigma: 1.5 });
  }

  // Если низкая резкость/контраст - растягиваем гистограмму
  if (metrics.qualityScore < 0.5) {
    result = result.normalize();
  }

  // Бинаризация для очень плохих сканов
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

  // Чем хуже качество, тем свободнее группируем соседние элементы
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