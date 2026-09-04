/**
 * One-shot ticket so html-from-handoff / pack-demo CLIs only run when spawned
 * by torchlightweb.mjs. Environment variables are not a lock.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ORCHESTRATOR_TICKET_TTL_MS = 15 * 60 * 1000;
const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = resolve(SKILL_ROOT, '../..');
const TICKET_DIR = join(REPO_ROOT, '_tmp', 'torchlightweb-tickets');
const ALLOWED_SCRIPTS = Object.freeze([
  'scripts/figma-html-from-handoff.mjs',
  'scripts/lib/later-axes-probe.mjs',
  'scripts/pack-demo.mjs',
]);

function ticketPath(id) {
  return join(TICKET_DIR, `${id}.json`);
}

export function mintOrchestratorTicket({ script, parentPid = process.pid, ttlMs = ORCHESTRATOR_TICKET_TTL_MS } = {}) {
  if (!ALLOWED_SCRIPTS.includes(script)) {
    throw new Error(`orchestrator ticket refuses script:${script}`);
  }
  mkdirSync(TICKET_DIR, { recursive: true, mode: 0o700 });
  const id = randomBytes(16).toString('hex');
  const path = ticketPath(id);
  const payload = {
    id,
    script,
    parentPid,
    skillRoot: SKILL_ROOT,
    expiresAt: Date.now() + ttlMs,
  };
  writeFileSync(path, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
  return { id, path, env: { TORCHLIGHTWEB_TICKET: id } };
}

export function consumeOrchestratorTicket({ script, argv = process.argv, env = process.env, now = Date.now() } = {}) {
  const id = env.TORCHLIGHTWEB_TICKET;
  if (!id || !/^[a-f0-9]{32}$/.test(id)) {
    return { ok: false, error: 'missing-orchestrator-ticket' };
  }
  const path = ticketPath(id);
  if (!existsSync(path)) return { ok: false, error: 'unknown-orchestrator-ticket' };
  let ticket;
  try {
    ticket = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    try { unlinkSync(path); } catch {}
    return { ok: false, error: 'invalid-orchestrator-ticket' };
  }
  try { unlinkSync(path); } catch {}
  if (ticket.script !== script) return { ok: false, error: 'ticket-script-mismatch' };
  if (ticket.skillRoot !== SKILL_ROOT) return { ok: false, error: 'ticket-skill-mismatch' };
  if (Number(ticket.expiresAt) < now) return { ok: false, error: 'ticket-expired' };
  const parent = Number(ticket.parentPid);
  if (!Number.isInteger(parent) || parent <= 0) return { ok: false, error: 'ticket-parent-mismatch' };
  if (typeof process.ppid === 'number' && process.ppid !== parent) {
    return { ok: false, error: 'ticket-parent-mismatch' };
  }
  const entry = argv[1] ? resolve(argv[1]) : '';
  if (entry && entry !== join(SKILL_ROOT, script)) {
    return { ok: false, error: 'ticket-entry-mismatch' };
  }
  return { ok: true, ticket };
}

export function requireOrchestratorTicket(script, extra = {}) {
  const result = consumeOrchestratorTicket({ script, ...extra });
  if (result.ok !== true) {
    const error = result.error || 'missing-orchestrator-ticket';
    const hint = 'run npm run torchlightweb; TORCHLIGHTWEB_ORCHESTRATOR=1 is not a lock';
    return { ok: false, error, hint };
  }
  return result;
}
