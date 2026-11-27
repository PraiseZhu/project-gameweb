import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { compareImages, loadPngApi, readPng } from './png-compare.mjs';
import { resolveModule } from './resolve-playwright.mjs';

export const parameters = Object.freeze({ threshold: 0.1, maxDifference: 0.06, maxMaskRatio: 0.4, provisional: true });
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const validDigest = (value) => /^[0-9a-f]{64}$/.test(value);

export async function compareOnePage({ reference, screenshot, viewport, referenceSha256, binding, textMasks = [], designMasks = [], region = null, write }) {
  if (!reference?.length || !screenshot?.length || digest(reference) !== referenceSha256 || !validDigest(binding)) {
    throw new Error('像素输入缺失或不匹配');
  }
  const api = await loadPngApi();
  if (!api.pixelmatch) throw new Error('one-page 模式需要可用的 pixelmatch，不回退比较引擎');
  const engine = { name: 'pixelmatch', version: JSON.parse(readFileSync(join(dirname(resolveModule('pixelmatch')), 'package.json'))).version };
  let baseline = readPng(api.PNG, reference);
  let actual = readPng(api.PNG, screenshot);
  const { width, height } = viewport;
  if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0) ||
      baseline.width !== width || baseline.height !== height || actual.width !== width || actual.height !== height) {
    throw new Error('参考或截图与外传基准尺寸不符');
  }
  if (region) {
    const [x, y, wide, high] = region;
    if (region.length !== 4 || !region.every(Number.isSafeInteger) || x < 0 || y < 0 || wide < 1 || high < 1 || x + wide > width || y + high > height || textMasks.length || designMasks.length) {
      throw new Error('局部复比区域非法或试图遮掉关键对象');
    }
    const crop = (image) => {
      const result = new api.PNG({ width: wide, height: high });
      api.PNG.bitblt(image, result, x, y, wide, high, 0, 0);
      return result;
    };
    baseline = crop(baseline);
    actual = crop(actual);
  }
  const masks = textMasks.map(({ rect, evidence }) => {
    if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)
      || rect[0] < 0 || rect[1] < 0 || rect[2] <= 0 || rect[3] <= 0
      || rect[0] + rect[2] > width || rect[1] + rect[3] > height
      || evidence?.binding !== binding || evidence?.kind !== 'live-text' || evidence?.result !== 'pass'
      || !evidence.domId || !validDigest(evidence.digest)) throw new Error('遮罩缺同版文字、字体及几何证据');
    return rect;
  });
  for (const { rect, evidence } of designMasks) {
    if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isSafeInteger) || rect[0] < 0 || rect[1] < 0
      || rect[2] < 1 || rect[3] < 1 || rect[0] + rect[2] > width || rect[1] + rect[3] > height
      || evidence?.binding !== binding || evidence?.kind !== 'designer-confirmed' || !evidence.domId || !validDigest(evidence.digest)) {
      throw new Error('设计确认遮罩缺精确范围与同版依据');
    }
    masks.push(rect);
  }
  const designEvidence = designMasks.length ? { designMasks } : {};
  const screenshotSha256 = digest(screenshot);
  const fingerprint = digest(JSON.stringify({ engine, parameters, binding, viewport, region, referenceSha256, screenshotSha256, textMasks, ...designEvidence }));
  const result = await compareImages({ ...api, engine: 'pixelmatch', baseline, actual, masks, ...parameters });
  if (result.status !== 'OK' || !Number.isSafeInteger(result.total) || result.total < 1) throw new Error(result.detail ?? '比较无有效像素');
  const artifacts = {
    reference: write('reference.png', region ? api.PNG.sync.write(baseline) : reference),
    actual: write('actual.png', region ? api.PNG.sync.write(actual) : screenshot),
    diff: write('diff.png', api.PNG.sync.write(result.diff)),
  };
  return { status: result.bad / result.total <= parameters.maxDifference ? 'pass' : 'fail', binding, fingerprint, engine,
    parameters, region, referenceSha256, screenshotSha256, textMasks, ...designEvidence,
    differingPixels: result.bad, effectivePixels: result.total, maskedPixels: result.masked, artifacts };
}
