export class StoppedError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StoppedError';
    this.code = code;
    this.result = 'stopped';
  }
}

export function isStoppedError(err) {
  return err instanceof StoppedError;
}

export function stoppedResult(err) {
  const code = isStoppedError(err) ? err.code : 'internal';
  const message = isStoppedError(err)
    ? err.message
    : '范围确认失败，已停止。';
  return {
    ok: false,
    result: 'stopped',
    code,
    message,
  };
}
