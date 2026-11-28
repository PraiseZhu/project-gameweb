export const suiteLimitMs = 850_000;
export const browserCaseMs = 240_000;
export const checkCliMs = 180_000;
export const compositeCaseMs = 660_000;

let sequence = 0;

export async function measureStage(stage, operation) {
  const id = process.pid + ':' + ++sequence;
  const started = performance.now();
  console.error('[one-page test]', JSON.stringify({ id, stage, event:'start' }));
  try {
    const value = await operation();
    console.error('[one-page test]', JSON.stringify({ id, stage, event:'end', elapsedMs:Math.round(performance.now() - started),
      status:value?.status ?? value?.result ?? null, exit:value?.exit ?? null }));
    return value;
  } catch (error) {
    console.error('[one-page test]', JSON.stringify({ id, stage, event:'error', elapsedMs:Math.round(performance.now() - started),
      exit:error.code ?? null, signal:error.signal ?? null, message:error.message?.split('\n')[0] }));
    throw error;
  }
}
