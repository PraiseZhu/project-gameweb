import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIGMA_STATE_CANDIDATE_SCHEMA,
  auditFigmaStatefulControls,
  collectAndAuditFigmaStates,
  discoverFigmaStateCandidates,
  evaluatePlatformScopeComplete,
} from '../lib/figma-state-candidate-audit.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CLI = join(ROOT, 'scripts/figma-state-candidate-audit.mjs');
const platformRoots = [
  { id: 'mobile-default', platform: 'mobile', pageId: 'page', canvasId: 'canvas', parentId: 'shared-page-frame', context: 'homepage' },
  { id: 'pc-default', platform: 'pc', pageId: 'page', canvasId: 'canvas', parentId: 'shared-page-frame', context: 'homepage' },
];
const nodes = [
  { id: 'mobile-default', type: 'FRAME', pageId: 'page', canvasId: 'canvas', parentId: 'shared-page-frame', visible: true },
  { id: 'pc-default', type: 'FRAME', pageId: 'page', canvasId: 'canvas', parentId: 'shared-page-frame', visible: true },
  { id: 'mobile-language-popup', platform: 'mobile', type: 'FRAME', pageId: 'page', canvasId: 'canvas', parentId: 'shared-page-frame', visible: true, children: ['language-list'], componentProperties: { state: 'selected' } },
  { id: 'mobile-nav-popup', platform: 'mobile', type: 'FRAME', pageId: 'page', canvasId: 'canvas', parentId: 'shared-page-frame', visible: true, children: ['nav-list'], variants: [{ id: 'normal', properties: { state: 'normal' } }, { id: 'selected', properties: { state: 'selected' } }] },
  { id: 'pc-popup', platform: 'pc', type: 'FRAME', pageId: 'page', canvasId: 'canvas', parentId: 'shared-page-frame', visible: true },
  { id: 'other-canvas-sibling', type: 'FRAME', pageId: 'page', canvasId: 'other', parentId: 'shared-page-frame', visible: true },
];
function controls() {
  return [
    { controlKey: 'mobile.language', sourceNodeId: 'language-trigger', platform: 'mobile', pageId: 'page', canvasId: 'canvas', visible: true, stateful: true, properties: { state: 'normal' } },
    { controlKey: 'mobile.menu', sourceNodeId: 'menu-trigger', platform: 'mobile', pageId: 'page', canvasId: 'canvas', visible: true, stateful: true, properties: { state: 'selected' } },
    { controlKey: 'pc.menu', sourceNodeId: 'pc-menu-trigger', platform: 'pc', pageId: 'page', canvasId: 'canvas', visible: true, stateful: true, properties: { state: 'normal' } },
  ];
}

test('visible same-canvas sibling state frames are retained independently of the selected platform root', () => {
  const result = discoverFigmaStateCandidates({ nodes, platformRoots });
  assert.equal(result.schema, FIGMA_STATE_CANDIDATE_SCHEMA);
  assert.deepEqual(result.candidates.filter((item) => item.platform === 'mobile').map((item) => item.candidateId).sort(), ['mobile-language-popup', 'mobile-nav-popup']);
  assert.equal(result.candidates.some((item) => item.candidateId === 'other-canvas-sibling'), false);
  assert.ok(result.candidates.every((item) => item.visualStateDiscovered && item.transitionAuthorized === false));
  assert.equal(result.candidates.find((item) => item.candidateId === 'mobile-nav-popup').variantEvidence.discovered, true);
});

test('variants and visually matching sibling frames remain discovered but do not authorize transitions', () => {
  const candidates = discoverFigmaStateCandidates({ nodes, platformRoots }).candidates;
  const report = auditFigmaStatefulControls({ controls: controls(), candidates });
  assert.equal(report.controls.filter((item) => item.platform === 'mobile').every((item) => item.transitionAuthorized === false), true);
  assert.equal(report.controls.find((item) => item.controlKey === 'mobile.language').status, 'input-state-relation-missing');
  assert.equal(report.summary.interactionComplete, false);
});

test('only a determined explicit prototype or state-map relation wires a matching candidate', () => {
  const candidates = discoverFigmaStateCandidates({ nodes, platformRoots }).candidates;
  const report = auditFigmaStatefulControls({
    controls: controls(), candidates,
    relations: [{ kind: 'prototype-transition', status: 'determined', evidence: { edge: 'figma-prototype-1' }, from: { controlKey: 'mobile.menu' }, to: { candidateId: 'mobile-nav-popup' } }],
  });
  const menu = report.controls.find((item) => item.controlKey === 'mobile.menu');
  assert.equal(menu.status, 'wired');
  assert.equal(menu.transitionAuthorized, true);
  assert.equal(menu.targetCandidateId, 'mobile-nav-popup');
  assert.equal(report.controls.find((item) => item.controlKey === 'mobile.language').status, 'input-state-relation-missing');
});

test('ambiguous name-only or cross-platform candidate claims remain non-authorizing', () => {
  const candidates = discoverFigmaStateCandidates({ nodes, platformRoots }).candidates;
  const report = auditFigmaStatefulControls({
    controls: controls(), candidates,
    relations: [{ kind: 'name-match', status: 'determined', evidence: { matchingLabel: 'menu' }, from: { controlKey: 'mobile.menu' }, to: { candidateId: 'mobile-nav-popup' } }, {
      kind: 'explicit-state-map', status: 'determined', evidence: { map: 'wrong-platform' }, from: { controlKey: 'mobile.language' }, to: { candidateId: 'pc-popup' },
    }],
  });
  const menu = report.controls.find((item) => item.controlKey === 'mobile.menu');
  assert.equal(menu.status, 'recognized-but-evidence-insufficient');
  assert.equal(menu.transitionAuthorized, false);
  const language = report.controls.find((item) => item.controlKey === 'mobile.language');
  assert.equal(language.status, 'recognized-but-evidence-insufficient');
  assert.equal(language.transitionAuthorized, false);
});

test('platforms remain isolated and aggregate nav success cannot hide unclassified stateful controls', () => {
  const candidates = discoverFigmaStateCandidates({ nodes, platformRoots }).candidates;
  const report = auditFigmaStatefulControls({
    controls: controls(), candidates,
    stateMaps: [{ controlKey: 'pc.menu', candidateId: 'pc-popup', evidence: { approved: true } }],
    inertAudit: { aggregateSignals: [{ kind: 'nav-scroll', ok: true }] },
  });
  assert.equal(report.controls.find((item) => item.controlKey === 'pc.menu').status, 'wired');
  assert.equal(report.controls.find((item) => item.controlKey === 'mobile.menu').status, 'input-state-relation-missing');
  assert.equal(report.summary.interactionComplete, false);
  assert.equal(report.summary.aggregateSignalsDoNotImplyControlCompletion, true);
});

test('inert safety is explicitly safe blocking and cannot mark an interaction complete', () => {
  const report = collectAndAuditFigmaStates({ nodes, platformRoots, controls: controls(), inertAudit: { inert: true } });
  assert.equal(report.audit.summary.inertSafety, 'safe-blocking-not-interaction-completion');
  assert.equal(report.audit.summary.interactionComplete, false);
});

test('platform scope fails closed when visible sibling frames were discovered but omitted from inventory candidates', () => {
  const discovered = discoverFigmaStateCandidates({ nodes, platformRoots }).candidates;
  const missing = evaluatePlatformScopeComplete({ nodes, platformRoots, candidates: [discovered.find((item) => item.candidateId === 'pc-popup')] });
  assert.equal(missing.complete, false);
  assert.equal(missing.reason, 'platform-scope-incomplete');
  assert.equal(missing.platforms.find((item) => item.platform === 'pc').complete, true);
  assert.equal(missing.platforms.find((item) => item.platform === 'mobile').complete, false);
  assert.ok(missing.failures.every((item) => item.reason === 'platform-scope-incomplete'));
  assert.ok(missing.missing.every((item) => item.visualStateDiscovered && item.transitionAuthorized === false));

  const complete = evaluatePlatformScopeComplete({ nodes, platformRoots, candidates: discovered });
  assert.equal(complete.complete, true);
});
test('CLI preserves candidates and exits blocked when visible controls lack explicit state relations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'figma-state-audit-'));
  const input = join(dir, 'input.json');
  const out = join(dir, 'audit.json');
  writeFileSync(input, JSON.stringify({ nodes, platformRoots, controls: controls() }));
  const result = spawnSync(process.execPath, [CLI, '--input', input, '--out', out], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  const report = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(report.discovery.candidates.length, 3);
  assert.equal(report.audit.summary.interactionComplete, false);
});
