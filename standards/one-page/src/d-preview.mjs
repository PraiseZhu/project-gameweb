import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { readRegular } from './c-check/evidence.mjs';
import { byteDigest, checkHandoff, HANDOFF_CONSUMER, PACK_FILES } from './handoff-check.mjs';
import { inspectAcceptance, requireD } from './d-proof.mjs';
import { pixelScope } from './c-check/pixel-scope.mjs';

const shell = new URL('../qa-shell/', import.meta.url);
const shellFiles = new Set(['index.html', 'qa-toolbar.mjs', 'qa-chrome.mjs', 'qa-comments.mjs', 'qa-devices.json', 'qa.css']);
const types = new Map(Object.entries({ html:'text/html; charset=utf-8', mjs:'text/javascript; charset=utf-8', js:'text/javascript; charset=utf-8',
  json:'application/json; charset=utf-8', css:'text/css; charset=utf-8', svg:'image/svg+xml', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg',
  webp:'image/webp', gif:'image/gif', mp4:'video/mp4', webm:'video/webm', woff:'font/woff', woff2:'font/woff2', otf:'font/otf', ttf:'font/ttf' }));

function samplesFor(options, page) {
  if (!options.handoffPack) {
    requireD(!options.consumerContract, '消费者契约缺对应 B3 包');
    return [];
  }
  const handoff = checkHandoff({ pack: options.handoffPack, expectVersion: page.b3.version, scopeVersion: page.scopeVersion,
    consumerContract: options.consumerContract ?? HANDOFF_CONSUMER }, { includePayloads: true });
  requireD(handoff.ok && handoff.manifestSha256 === page.b3.digest, 'QA 样例未绑定当前成品的 B3：' + (handoff.message ?? '摘要不符'));
  return JSON.parse(handoff.payloads.get(PACK_FILES.samples)).samples.filter((row) => row.testData === true);
}

export async function startPreview(options) {
  const accepted = inspectAcceptance(options);
  const { binding, page, fingerprint } = accepted;
  const samples = samplesFor(options, page);
  const byState = new Map(samples.map((sample, index) => ['sample-' + index, sample]));
  const entry = binding.language + '.html';
  const port = options.port === undefined ? 0 : Number(options.port);
  requireD(Number.isInteger(port) && port >= 0 && port <= 65535, '预览端口无效');
  const bases = ['pageVersion', 'checkVersion', 'checkDigest', 'scopeVersion'];
  const info = { entry, language: binding.language, fingerprint, base: Object.fromEntries(bases.map((key) => [key, binding[key]])),
    nodes: page.nodes.map(({ end, module, nodeId, domId, role }) => ({ end, module, nodeId, domId, role })),
    cases: pixelScope(page).map(({ screen, caseId, selectedTabs }) => ({ screen: screen.domId, caseId, selectedTabs })),
    states: [{ id:'real', label:'真实配置' }, ...[...byState].map(([id, sample]) => ({ id, label:sample.id }))] };
  const productRoot = join(options.pagePack, 'page');
  const server = createServer((request, response) => {
    function send(status, body = '', type = 'text/plain; charset=utf-8', policy = "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'") {
      response.writeHead(status, { 'Content-Type':type, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff',
        'Referrer-Policy':'no-referrer', 'Content-Security-Policy':policy });
      response.end(request.method === 'HEAD' ? undefined : body);
    }
    try {
      if (request.headers.host !== '127.0.0.1:' + server.address().port) return send(403);
      if (!['GET','HEAD'].includes(request.method)) return send(405);
      const { pathname, search } = new URL(request.url, 'http://127.0.0.1');
      if (pathname === '/qa-preview/config.json' && !search) return send(200, JSON.stringify(info), types.get('json'));
      if (pathname.startsWith('/qa-preview/') && !search) {
        const file = pathname.slice('/qa-preview/'.length) || 'index.html';
        if (shellFiles.has(file)) return send(200, readFileSync(new URL(file, shell)), types.get(file.split('.').at(-1)));
      }
      const match = /^\/product\/(real|sample-\d+)\/(.+)$/.exec(pathname);
      if (!match) return send(404);
      const [, state, path] = match;
      const sample = byState.get(state);
      if (state !== 'real' && !sample) return send(404);
      if (path === '__data__' && sample) {
        const status = ['missing','404'].includes(sample.state) ? 404 : sample.state === 'failure' ? 503 : 200;
        return send(status, JSON.stringify(sample.data ?? null), types.get('json'));
      }
      if (search || !Object.hasOwn(binding.files, 'page/' + path)) return send(404);
      let bytes = readRegular(productRoot, path);
      const expected = binding.files['page/' + path];
      if (bytes.length !== expected.bytes || byteDigest(bytes) !== expected.sha256) return send(409, '成品已变更；必须重新验收');
      if (path === 'js/config.js' && sample) {
        const url = sample.state === 'missing' ? 'null' : 'location.origin + ' + JSON.stringify('/product/' + state + '/__data__');
        bytes = Buffer.concat([bytes, Buffer.from('\nwindow.OnePageConfig.dataUrl = ' + url + ';\n')]);
      }
      return send(200, bytes, types.get(path.split('.').at(-1)) ?? 'application/octet-stream', "frame-ancestors 'self'; object-src 'none'; base-uri 'none'");
    } catch { return send(409, '不能读取已验收的同版文件'); }
  });
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => { server.off('error', fail); done(); });
  });
  const url = 'http://127.0.0.1:' + server.address().port + '/qa-preview/';
  return { url, close: () => new Promise((done, fail) => server.close((error) => error ? fail(error) : done())) };
}
