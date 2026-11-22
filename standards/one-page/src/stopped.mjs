export class StoppedError extends Error {
  constructor(code, message, extras = {}) {
    super(message);
    this.name = 'StoppedError';
    this.code = code;
    this.result = 'stopped';
    if (extras.end !== undefined) this.end = extras.end;
    if (extras.section !== undefined) this.section = extras.section;
    if (extras.nodeId !== undefined) this.nodeId = extras.nodeId;
    if (extras.object !== undefined) this.object = extras.object;
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
