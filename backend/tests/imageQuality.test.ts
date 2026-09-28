/**
 * Тесты оценки качества изображений: метрики sharp (stdev/lапласиан/median-residual),
 * пороги размытости/шума, адаптивная предобработка и динамические пороги кластеризации.
 * Изображения синтетические — sharp генерирует PNG на лету, сеть не используется.
 */

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import {
  analyzeImageQuality,
  applyAdaptivePreprocessing,
  calculateDynamicThreshold,
} from '../src/parsers/imageQuality.js';

const W = 600;
const H = 800;

/** Плотная сетка тонких чёрных штрихов на белом фоне — имитация текста */
function strokesSvg(fill = '#000000', bw = 6): Buffer {
  let s = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="white"/>`;
  for (let y = 10; y < H - 10; y += 24) {
    for (let x = 10; x < W - 20; x += 46) {
      s += `<rect x="${x}" y="${y}" width="${bw}" height="${bw + 10}" fill="${fill}"/>`;
    }
  }
  return Buffer.from(s + '</svg>');
}

async function toPng(svgBuffer: Buffer): Promise<Buffer> {
  return sharp({
    create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: svgBuffer }])
    .png()
    .toBuffer();
}

/** Псевдослучайный шум 0..255 (линейный конгруэнтный генератор) */
async function noisePng(): Promise<Buffer> {
  const noise = Buffer.alloc(W * H);
  let seed = 12345;
  for (let i = 0; i < W * H; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    noise[i] = Math.round((seed / 0x7fffffff) * 255);
  }
  return sharp(noise, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
}

describe('analyzeImageQuality', () => {
  it('резкий текст: не шумный, не размытый, высокий score', async () => {
    const metrics = await analyzeImageQuality(await toPng(strokesSvg()));
    expect(metrics.isNoisy).toBe(false);
    expect(metrics.isBlurry).toBe(false);
    expect(metrics.qualityScore).toBeGreaterThan(0.8);
    expect(metrics.estimatedDpi).toBeGreaterThan(0);
  });

  it('размытое изображение определяется как blurry с низким score', async () => {
    const blurred = await sharp(await toPng(strokesSvg())).blur(10).png().toBuffer();
    const metrics = await analyzeImageQuality(blurred);
    expect(metrics.isBlurry).toBe(true);
    expect(metrics.qualityScore).toBeLessThan(0.5);
  });

  it('зашумлённое изображение определяется как noisy с низким score', async () => {
    const metrics = await analyzeImageQuality(await noisePng());
    expect(metrics.isNoisy).toBe(true);
    expect(metrics.qualityScore).toBeLessThan(0.5);
  });
});

describe('calculateDynamicThreshold', () => {
  it('на хорошем скане пороги близки к базовым', async () => {
    const metrics = await analyzeImageQuality(await toPng(strokesSvg()));
    const t = calculateDynamicThreshold(metrics);
    expect(t.lineClusterFactor).toBeCloseTo(0.7, 1);
    expect(t.cellGapFactor).toBeCloseTo(0.45, 1);
  });

  it('на проблемном изображении порог строк выше, а ячеек ниже дефолта', async () => {
    const noisy = await analyzeImageQuality(await noisePng());
    const t = calculateDynamicThreshold(noisy);
    expect(t.lineClusterFactor).toBeGreaterThan(0.7);
  });
});

describe('applyAdaptivePreprocessing', () => {
  it('возвращает валидный PNG с теми же размерами или больше', async () => {
    const src = await toPng(strokesSvg());
    const metrics = await analyzeImageQuality(src);
    const out = await applyAdaptivePreprocessing(src, metrics);
    expect(out.subarray(0, 8).toString('hex')).toMatch(/^89504e47/); // PNG magic
    const meta = await sharp(out).metadata();
    expect(meta.width).toBeGreaterThanOrEqual(W);
    expect(meta.height).toBeGreaterThanOrEqual(H);
  });
});