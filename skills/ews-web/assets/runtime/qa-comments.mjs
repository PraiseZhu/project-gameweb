/**
 * EWS-owned copy of the torchlight QA comment runtime.
 * Same IndexedDB / BroadcastChannel / optional commentApi contract.
 * Not a static guestbook. Shared Worker URL is not configured here.
 */
export function buildCommentApiUrl(api, pageKey, query, origin) {
  if (api == null || api === '') return '';
  var base = String(typeof api === 'string' ? api : (api.url || api.baseUrl || ''));
  if (!base) return '';
  var root = origin || (typeof location !== 'undefined' && location.origin) || 'http://127.0.0.1';
  var parsed;
  try { parsed = new URL(base, root); } catch (e) { return ''; }
  parsed.hash = '';
  var extra = query || {};
  Object.keys(extra).forEach(function (key) {
    if (key === 'pageKey') return;
    if (extra[key] == null) parsed.searchParams.delete(key);
    else parsed.searchParams.set(key, String(extra[key]));
  });
  parsed.searchParams.set('pageKey', String(pageKey));
  return parsed.pathname + parsed.search;
}

export function createQaComments(host) {
  'use strict';
  var doc = document;
  function mk(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(text, fn) {
    var n = mk('button', 'qc-btn', text);
    n.type = 'button'; n.onclick = fn; return n;
  }
  function svgIcon(d) {
    var icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
    var p = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.8'); p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round'); icon.appendChild(p); return icon;
  }
  function closeBtn(label, fn) {
    var n = btn('', fn); n.classList.add('qc-icon-btn');
    n.appendChild(svgIcon('M6 6l12 12M18 6L6 18'));
    n.setAttribute('aria-label', label); n.title = label; return n;
  }
  var style = mk('style');
  style.textContent = '.qc-root{position:fixed;inset:0;z-index:100000;pointer-events:none;font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#e6eaf0}.qc-root [hidden]{display:none!important}.qc-toolbar{display:flex;gap:6px;align-items:center}.qc-btn{font:inherit;border:1px solid #39424f;border-radius:7px;padding:6px 10px;background:#1e232c;color:#e6eaf0;cursor:pointer}.qc-btn:hover{background:#2b3544}.qc-btn[aria-pressed=true],.qc-primary{background:#2563eb;color:#fff;border-color:#3b82f6}.qc-root textarea,.qc-root select{font:inherit;color:inherit;background:#101620;border:1px solid #39424f;border-radius:6px;padding:8px;max-width:100%}.qc-root textarea{display:block;width:100%;min-height:90px;resize:vertical;user-select:text}.qc-panel,.qc-pop{pointer-events:auto;background:#171b22;border:1px solid #39424f;border-radius:12px;box-shadow:0 14px 48px #0008;padding:14px}.qc-panel{position:absolute;right:12px;top:12px;bottom:12px;width:min(360px,calc(100vw - 24px));display:flex;flex-direction:column;gap:10px}.qc-pop{position:absolute;width:min(340px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto}.qc-head,.qc-actions{display:flex;align-items:center;justify-content:space-between;gap:8px}.qc-note{font-size:12px;color:#a3afbf;white-space:pre-wrap;overflow-wrap:anywhere;margin:7px 0}.qc-warning{color:#fbbf24}.qc-list{overflow:auto;flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}.qc-item{display:block;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere;width:100%;padding:10px 12px;background:#12171f}.qc-item small{display:block;color:#a3afbf;margin-bottom:4px}.qc-item[aria-current=true]{border-color:#60a5fa;background:#1c2b40}.qc-copy{white-space:pre-wrap;overflow-wrap:anywhere;max-height:250px;overflow:auto;margin:10px 0;padding:10px 12px;background:#101620;border:1px solid #2b3544;border-radius:8px;font-size:14px;line-height:1.6}.qc-pin{position:absolute;pointer-events:auto;transform:translate(-50%,-50%);border:2px solid white;border-radius:50% 50% 50% 3px;background:#2563eb;color:white;min-width:25px;height:25px;font:600 11px/19px sans-serif;cursor:pointer;padding:0 4px;box-shadow:0 2px 8px #0008}.qc-outline{position:absolute;border:2px solid #60a5fa;background:#3b82f619;pointer-events:none;border-radius:3px}.qc-toast{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);max-width:calc(100vw - 28px);background:#17263b;border:1px solid #416286;padding:9px 16px;border-radius:8px;white-space:pre-wrap}.qc-selecting,.qc-selecting *{cursor:crosshair!important}';

  style.textContent += '.qc-root *{box-sizing:border-box}.qc-root button:focus-visible,.qc-toolbar button:focus-visible{outline:2px solid #93c5fd;outline-offset:3px}.qc-btn:disabled{opacity:.45;cursor:not-allowed}.qc-toolbar .qc-btn{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.qc-toolbar svg,.qc-icon-btn svg,.qc-btn svg{width:16px;height:16px}.qc-selecting{touch-action:none}.qc-panel{top:var(--qc-top,12px)}.qc-pop{z-index:2}.qc-outline{z-index:-1}.qc-pin[aria-expanded=true]{background:#f59e0b}.qc-root .qc-note{margin:4px 0}.qc-icon-btn{width:32px;height:32px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-color:transparent;background:transparent}.qc-icon-btn:hover{background:#2b3544}.qc-count{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#2563eb;color:#fff;font:600 11px/18px sans-serif;text-align:center}.qc-head strong{font-size:14px}.qc-filters{display:flex;flex-direction:column;gap:8px}.qc-filter{display:flex;flex-direction:column;gap:4px;font-size:11px;color:#a3afbf}.qc-filter select{width:100%}.qc-status{display:inline-block;padding:1px 6px;border-radius:999px;font-size:11px;margin-right:6px}.qc-status-open{background:#1e3a8a;color:#bfdbfe}.qc-status-done{background:#14532d;color:#bbf7d0}.qc-ok{background:#15803d;border-color:#22c55e;color:#fff}.qc-ok:hover{background:#16a34a}.qc-actions{justify-content:flex-end}.qc-thread{display:flex;flex-direction:column;gap:8px;margin:8px 0}.qc-reply{padding:8px 10px 8px 12px;border-left:2px solid #3b82f6;background:#12171f;border-radius:0 8px 8px 0}.qc-reply .qc-note{margin:0 0 4px}.qc-composer{margin-top:12px;padding-top:10px;border-top:1px solid #2b3544}.qc-thread-actions{display:flex;align-items:center;justify-content:flex-start;margin-top:8px}.qc-head-actions{display:flex;align-items:center;gap:2px;margin-left:auto}.qc-resolve{color:#93c5fd}.qc-resolve[aria-pressed=true]{color:#86efac}.qc-pop textarea[aria-label="补充评论"]{min-height:64px}';
  doc.head.appendChild(style);
  var root = mk('div', 'qc-root');
  var pins = mk('div'), outline = mk('div', 'qc-outline');
  var pop = mk('section', 'qc-pop'), panel = mk('aside', 'qc-panel');
  var toast = mk('div', 'qc-toast');
  outline.hidden = pop.hidden = panel.hidden = toast.hidden = true;
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', '评论详情');
  panel.setAttribute('aria-label', '全部评论'); toast.setAttribute('role', 'status');
  root.append(pins, outline, pop, panel, toast); doc.body.appendChild(root);

  var mode = false, db = null, channel = null, rows = [], draft = null, active = null;
  var drag = null, hover = null, writeBusy = false, disposed = false;
  var dbKey = String(host.pageKey), index = new Map(), contentNodes = [], fallbackNodes = [], dirty = true, rafId = null;
  var timer = null, contextKey = '', pinButtons = new Map(), lastListKey = '';
  var submitButton = null, composerNote = null, detailNote = null, loadSequence = 0;
  var api = host.commentApi || null, pollTimer = null, remoteBusy = false, remoteDurable = null;
  var sending = false, remoteError = '', lastDetailKey = '', swallowClick = null, replyOpen = false, openedResolved = false;
  var toolbar = mk('div', 'qc-toolbar');
  var modeButton = btn('', function () { if (!writeBusy) setMode(!mode); });
  modeButton.append(svgIcon('M20 11a8 8 0 0 1-8 8H4v-8a8 8 0 1 1 16 0ZM8 10h8M8 14h5'), mk('span', '', '添加评论'));
  modeButton.setAttribute('aria-label', '评论：点选或框选内容');
  modeButton.setAttribute('aria-pressed', 'false');
  modeButton.title = '点选或框选页面内容，写一条评论';
  var allCount = mk('span', 'qc-count', '0');
  var allButton = btn('', function () {
    if (writeBusy) return;
    panel.hidden = !panel.hidden; drawList(); schedule();
  });
  allButton.append(svgIcon('M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'), mk('span', '', '全部评论 · '), allCount);
  allButton.setAttribute('aria-label', '全部评论 · 0');
  allButton.title = '查看此页面所有语言、地区、状态的评论';
  toolbar.append(modeButton, allButton);
  var panelHead = mk('div', 'qc-head');
  panelHead.append(mk('strong', '', '全部评论'), closeBtn('关闭列表', function () { panel.hidden = true; }));
  var storage = mk('p', 'qc-note', '正在打开本地评论库…');
  var scope = mk('select'), status = mk('select');
  scope.setAttribute('aria-label', '评论范围'); status.setAttribute('aria-label', '解决状态');
  [['all', '全部页面组合'], ['current', '当前语言／地区／状态']].forEach(function (x) {
    var o = mk('option', '', x[1]); o.value = x[0]; scope.appendChild(o);
  });
  [['open', '未解决'], ['all', '全部（含已解决）'], ['resolved', '已解决'], ['pending', '待同步（含已解决）']].forEach(function (x) {
    var o = mk('option', '', x[1]); o.value = x[0]; status.appendChild(o);
  });
  var filters = mk('div', 'qc-filters');
  var scopeWrap = mk('label', 'qc-filter'); scopeWrap.append(doc.createTextNode('显示范围'), scope);
  var statusWrap = mk('label', 'qc-filter'); statusWrap.append(doc.createTextNode('状态'), status);
  filters.append(scopeWrap, statusWrap);
  var list = mk('div', 'qc-list'); panel.append(panelHead, storage, filters, list);
  scope.onchange = status.onchange = function () { drawList(); };

  function ctx() {
    var c = host.context();
    return { lang: c.lang || '', region: c.region || '', state: c.state || '', composition: c.composition || '' };
  }
  function ckey(c) { return JSON.stringify([c.lang, c.region, c.state, c.composition]); }
  function current(row) { return ckey(row.context) === ckey(ctx()); }
  function tiled() { return !!host.context().grid; }
  function say(text) {
    toast.textContent = text; toast.hidden = false; clearTimeout(timer);
    timer = setTimeout(function () { toast.hidden = true; }, 4200);
  }
  function storageReady() {
    storage.classList.remove('qc-warning');
    var pending = rows.filter(function (r) { return r._sync; });
    if (api && pending.length) {
      storage.classList.add('qc-warning');
      storage.textContent = pending.length + ' 条评论待同步，已保存在此浏览器。' +
        (pending.some(function (r) { return r._sync.blocked; }) ? '部分评论需要处理错误后点击重试。' : '页面打开时自动重试；刷新后仍会继续。');
      return;
    }
    if (api && remoteError) {
      storage.classList.add('qc-warning');
      storage.textContent = '协作服务暂时不可用：' + remoteError + '；仍保留本地缓存。';
      return;
    }
    storage.textContent = api
      ? (remoteDurable === true ? '评论保存到共享 KV；IndexedDB 作为本地缓存。每秒检查更新，实际同步时间取决于共享服务响应。' : '正在连接共享评论服务；IndexedDB 保留本地缓存。')
      : '仅保存在此浏览器；清除网站数据会删除评论。' +
        (channel ? '同一网站、同一浏览器的标签页自动同步。' : '当前浏览器不支持标签页即时同步，切回页面时重新读取。') +
        '其他同事或浏览器不会看到。';
  }
  function fail(error, message) {
    var reason = error && error.message || String(error || '未知错误');
    storage.textContent = (message || '评论存储失败') + '：' + reason;
    storage.classList.add('qc-warning'); say((message || '评论未保存') + '，请重试');
  }
  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('浏览器不支持 IndexedDB')); return; }
      var q = indexedDB.open('gameweb-qa-comments', 1);
      q.onupgradeneeded = function () { q.result.createObjectStore('comments', { keyPath: 'id' }); };
      q.onerror = function () { reject(q.error); };
      q.onblocked = function () { fail(new Error('请关闭此网站旧版本标签页再刷新'), '评论库被占用'); };
      q.onsuccess = function () {
        db = q.result;
        db.onversionchange = function () {
          db.close(); db = null; modeButton.disabled = true;
          if (submitButton) submitButton.disabled = true;
          fail(new Error('评论库版本改变，请刷新页面'), '评论库已关闭');
        };
        resolve();
      };
    });
  }
  function validRow(r) {
    return r && r.pageKey === dbKey && typeof r.id === 'string' && typeof r.body === 'string' &&
      r.context && r.anchor && Array.isArray(r.anchor.path) && r.anchor.path.length &&
      Number.isFinite(r.anchor.u) && Number.isFinite(r.anchor.v) &&
      r.anchor.u >= 0 && r.anchor.u <= 1 && r.anchor.v >= 0 && r.anchor.v <= 1;
  }
  function repliesOf(row) {
    return Array.isArray(row && row.replies) ? row.replies.filter(function (item) {
      return item && typeof item.id === 'string' && typeof item.body === 'string' && item.body.trim() &&
        Number.isFinite(item.createdAt);
    }) : [];
  }
  function newId() {
    return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() :
      Array.from(crypto.getRandomValues(new Uint32Array(4))).map(function (v) { return v.toString(16); }).join('-');
  }
  function apiBase() {
    if (!api) return '';
    var value = typeof api === 'string' ? api : (api.url || api.baseUrl || '');
    return String(value).replace(/\/$/, '');
  }
  function apiUrl(path, query) {
    var base = apiBase();
    if (!base) return '';
    if (path) {
      var origin = (typeof location !== 'undefined' && location.origin) || 'http://127.0.0.1';
      try {
        var parsed = new URL(base, origin);
        parsed.pathname = path.charAt(0) === '/' ? path : (parsed.pathname.replace(/\/$/, '') + '/' + path);
        parsed.hash = '';
        base = parsed.pathname + parsed.search;
      } catch (e) { return ''; }
    }
    return buildCommentApiUrl(base, dbKey, query);
  }
  function remoteRequest(method, body) {
    var query = body && body.id ? { id: body.id } : null;
    if (method === 'GET') query = Object.assign({}, query || {}, { _ts: Date.now() });
    var url = apiUrl('', query);
    if (!url) return Promise.reject(new Error('未配置协作服务地址'));
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 10000);
    return fetch(url, { method: method, credentials: 'include', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body) }).then(function (res) {
      if (!res.ok) { var error = new Error('协作服务 HTTP ' + res.status); error.status = res.status; throw error; }
      return res.json();
    }).finally(function () { clearTimeout(timeout); });
  }
  function mergeRemote(remoteRows) {
    if (!db || !Array.isArray(remoteRows)) return;
    try {
      var tx = db.transaction('comments', 'readwrite'), store = tx.objectStore('comments');
      remoteRows.filter(validRow).forEach(function (r) {
        var q = store.get(r.id);
        q.onsuccess = function () {
          var previous = q.result;
          // Read the current durable row, not the possibly stale UI snapshot.
          // A poll must never erase queued work or restore its old resolved state.
          if (!previous || (!previous._sync && (r.updatedAt || r.createdAt) >= (previous.updatedAt || previous.createdAt))) {
            var clean = Object.assign({}, r); delete clean._sync; store.put(clean);
          }
        };
      });
      tx.oncomplete = reload;
      tx.onerror = function () { fail(tx.error, '协作评论写入本地缓存失败'); };
    } catch (e) { fail(e, '协作评论写入本地缓存失败'); }
  }
  function remoteReload() {
    if (!api || remoteBusy || disposed) return;
    remoteBusy = true;
    remoteRequest('GET').then(function (result) {
      if (!result || result.durable !== true || !Array.isArray(result.comments)) throw new Error('共享服务未确认持久化');
      remoteBusy = false; remoteDurable = true; remoteError = ''; mergeRemote(result.comments);
      storageReady();
    }).catch(function (e) { remoteBusy = false; remoteError = e.message; storageReady(); });
  }
  function revision() { return Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-'); }
  function pendingState(previous) {
    return { revision: revision(), attempts: 0, nextAt: 0, error: '', blocked: false,
      lease: previous && previous.lease || null };
  }
  // Claims and acknowledgements share the comment transaction. This both survives
  // reload and prevents two tabs from concurrently draining the same queued row.
  function updateStored(id, change) {
    return new Promise(function (resolve, reject) {
      if (!db || disposed) { resolve(null); return; }
      var tx = db.transaction('comments', 'readwrite'), store = tx.objectStore('comments'), value = null;
      var q = store.get(id);
      q.onsuccess = function () {
        if (!validRow(q.result)) return;
        value = change(q.result); if (value) store.put(value);
      };
      tx.oncomplete = function () { reload(); resolve(value); };
      tx.onabort = function () { reject(tx.error || new Error('评论缓存事务中止')); };
      tx.onerror = function () {};
    });
  }
  function queuedRows() {
    return new Promise(function (resolve, reject) {
      var q = db.transaction('comments', 'readonly').objectStore('comments').getAll();
      q.onsuccess = function () { resolve(q.result.filter(function (r) { return validRow(r) && r._sync; })); };
      q.onerror = function () { reject(q.error); };
    });
  }
  function completePendingSend(sentRow, result, failure) {
    var sent = sentRow._sync;
    return updateStored(sentRow.id, function (row) {
      var sync = row._sync;
      if (!sync || !sync.lease || sync.lease.token !== sent.lease.token) return null;
      sync.lease = null;
      if (sync.revision !== sent.revision) return row; // A newer resolve/reopen remains queued.
      if (!failure) {
        var confirmed = Object.assign({}, result.comment); delete confirmed._sync;
        remoteDurable = true; return confirmed;
      }
      sync.attempts++;
      sync.blocked = failure.status >= 400 && failure.status < 500 && failure.status !== 408 && failure.status !== 429;
      sync.error = failure.status === 401 || failure.status === 403
        ? '登录或权限已失效，请重新登录后重试' : failure.message;
      sync.nextAt = Date.now() + Math.min(30000, 1000 * Math.pow(2, Math.min(sync.attempts - 1, 5)));
      return row;
    });
  }
  async function flushPending() {
    if (!api || !db || disposed || sending || navigator.onLine === false) return;
    sending = true;
    try {
      var pending = await queuedRows();
      for (var i = 0; i < pending.length && !disposed; i++) {
        var row = await updateStored(pending[i].id, function (r) {
          var s = r._sync, now = Date.now();
          if (!s || s.blocked || s.nextAt > now || (s.lease && s.lease.until > now)) return null;
          s.lease = { token: revision(), until: now + 30000 }; return r;
        });
        if (!row) continue;
        var payload = Object.assign({}, row), result = null, failure = null;
        delete payload._sync;
        try {
          result = await remoteRequest('POST', payload);
          if (!result || result.durable !== true || !validRow(result.comment) || result.comment.id !== row.id) {
            throw new Error('共享服务未确认评论持久化');
          }
        } catch (e) { failure = e; }
        await completePendingSend(row, result, failure);
        if (channel) { try { channel.postMessage({ pageKey: dbKey }); } catch (_) {} }
      }
    } catch (e) { fail(e, '待同步评论读取或保存失败'); }
    finally { sending = false; }
  }
  function retry(row) {
    updateStored(row.id, function (r) {
      if (!r._sync) return null;
      r._sync.blocked = false; r._sync.nextAt = 0; r._sync.error = ''; return r;
    }).then(flushPending).catch(function (e) { fail(e, '重试状态保存失败'); });
  }
  function remoteTick() { remoteReload(); flushPending(); }
  function authorTime(row, tag) {
    var n = mk(tag || 'p', 'qc-note qc-author-time');
    var author = row.author && typeof row.author.name === 'string' && row.author.name.trim();
    n.appendChild(doc.createTextNode((author || (row._sync ? '待同步（作者待确认）' : '作者未记录')) + ' · '));
    function appendTime(value, label) {
      var date = new Date(value);
      if (typeof value !== 'number' || !Number.isFinite(date.getTime())) { n.appendChild(doc.createTextNode(label + '时间未记录')); return; }
      var time = mk('time', '', label + date.toLocaleString('zh-CN', { hour12: false }));
      time.dateTime = date.toISOString(); time.title = '浏览器本地时区：' + time.textContent; n.appendChild(time);
    }
    appendTime(row.createdAt, '发布于 ');
    if (row.updatedAt > row.createdAt) { n.appendChild(doc.createTextNode(' · ')); appendTime(row.updatedAt, '更新于 '); }
    return n;
  }
  function syncLabel(row) {
    if (row._sync) return (row._sync.blocked ? '同步暂停' : '待同步 · 自动重试') + (row._sync.error ? '：' + row._sync.error : '');
    if (!api) return '仅此浏览器';
    return row.author ? '已同步' : '本地记录（未确认同步）';
  }
  function startRemote() {
    if (!api) return;
    remoteTick();
    pollTimer = setInterval(remoteTick, 1000);
  }
  function reload(options) {
    if (!db) return;
    options = options || {};
    var sequence = ++loadSequence, q;
    try { q = db.transaction('comments', 'readonly').objectStore('comments').getAll(); }
    catch (e) { fail(e, '评论读取失败'); return; }
    q.onerror = function () { fail(q.error, '评论读取失败'); };
    q.onsuccess = function () {
      if (sequence !== loadSequence || disposed) return;
      rows = q.result.filter(validRow).sort(function (a, b) { return a.createdAt - b.createdAt || a.id.localeCompare(b.id); });
      storageReady();
      // If another tab resolved an open detail, show the newly committed state.
      // Do not rebuild a composer/detail that the user is still typing into.
      if (active && !draft) {
        var row = rows.find(function (r) { return r.id === active; });
        if (!row) close();
        else if (row.resolved && !openedResolved) close();
        else renderDetail(row, { keepReplyDraft: options.keepReplyDraft !== false });
      }
      syncPins(); drawList(); schedule();
    };
  }
  function save(row, resolved, reply) {
    if (writeBusy) return;
    if (!db) { fail(new Error('本地评论库尚未就绪')); return; }
    writeBusy = true;
    pop.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    var tx, missing = false, failReason = null;
    function failed(error) {
      writeBusy = false;
      pop.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
      fail(error); schedule();
    }
    try {
      tx = db.transaction('comments', 'readwrite');
      var store = tx.objectStore('comments');
      if (resolved === undefined && !reply) {
        if (!Array.isArray(row.replies)) row.replies = [];
        if (api) row._sync = pendingState();
        store.add(row);
      }
      else {
        var q = store.get(row.id);
        q.onsuccess = function () {
          if (!q.result) { missing = true; tx.abort(); return; }
          if (resolved !== undefined) q.result.resolved = resolved;
          if (reply) {
            if (!Array.isArray(q.result.replies)) q.result.replies = [];
            if (q.result.replies.length >= 30) { failReason = new Error('补充已达上限'); tx.abort(); return; }
            if (q.result.replies.some(function (item) { return item && item.id === reply.id; })) return;
            q.result.replies.push(reply);
          }
          q.result.updatedAt = Date.now();
          if (api) q.result._sync = pendingState(q.result._sync);
          store.put(q.result);
        };
      }
      tx.onabort = function () { failed(failReason || (missing ? new Error('评论已不存在') : tx.error)); };
      tx.onerror = function () {}; // onabort owns rollback feedback; no success before commit.
      tx.oncomplete = function () {
        writeBusy = false;
        draft = null;
        setMode(false);
        if (resolved === true) {
          active = null;
          lastDetailKey = '';
          replyOpen = false;
          pop.hidden = true;
          outline.hidden = true;
        } else {
          active = row.id;
          if (resolved === false) openedResolved = false;
          if (resolved === undefined && !reply) lastDetailKey = '';
          if (reply) {
            lastDetailKey = '';
            replyOpen = false;
          }
        }
        storageReady(); reload({ keepReplyDraft: !reply && resolved !== true });
        if (channel) { try { channel.postMessage({ pageKey: dbKey }); } catch (e) { /* committed data remains readable on focus */ } }
        say((reply ? '补充已保存' : resolved === undefined ? '评论已保存' : resolved ? '已解决，图钉已隐藏' : '已恢复') + (api ? '，等待同步' : ''));
        flushPending();
      };
    } catch (e) { if (tx) { try { tx.abort(); } catch (_) {} } failed(e); }
  }

  // The full data-node ancestry disambiguates repeated instances. No text,
  // element index, absolute page coordinate, or fuzzy fallback is used as identity.
  function frozenFrame() {
    return host.stage.querySelector('iframe.qa-frozen-frame');
  }
  function frozenDoc() {
    var frame = frozenFrame();
    try { return frame && frame.contentDocument ? frame.contentDocument : null; } catch (_) { return null; }
  }
  function inFrozenDoc(n) {
    var inner = frozenDoc();
    return !!(n && inner && inner.documentElement && inner.documentElement.contains(n));
  }
  function hostRect(el) {
    var r = el.getBoundingClientRect();
    if (!inFrozenDoc(el)) return r;
    var fr = frozenFrame().getBoundingClientRect();
    return {
      left: fr.left + r.left,
      top: fr.top + r.top,
      right: fr.left + r.right,
      bottom: fr.top + r.bottom,
      width: r.width,
      height: r.height,
    };
  }
  function styleOf(el) {
    var view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
    return view.getComputedStyle(el);
  }
  function nodeRoots() {
    var roots = [host.stage];
    var inner = frozenDoc();
    if (inner && inner.documentElement) roots.push(inner.documentElement);
    return roots;
  }
  function ownsNode(n) {
    if (!n) return false;
    if (host.stage.contains(n)) return true;
    return inFrozenDoc(n);
  }
  function commentFrame() {
    var inner = frozenDoc();
    if (inner) return inner.querySelector('.frame') || inner.body || inner.documentElement;
    return host.stage.querySelector('.frame') || host.stage;
  }
  function path(n) {
    var a = [];
    var innerRoot = frozenDoc() && frozenDoc().documentElement;
    for (var x = n; x && x !== host.stage && x !== innerRoot; x = x.parentElement) {
      if (x.hasAttribute && x.hasAttribute('data-node')) a.unshift(x.getAttribute('data-node'));
    }
    return a;
  }
  function nodeName(n) {
    return (n.getAttribute('data-node-name') || n.getAttribute('data-name') || '').trim();
  }
  function nodePrefix(n) {
    var prefix = n.getAttribute('data-prefix') || '';
    if (prefix) return prefix;
    var name = nodeName(n);
    var slash = name.indexOf('/');
    return slash > 0 ? name.slice(0, slash) : '';
  }
  // Pin/page shells, full-bleed kv/bg, and empty covering frames steal clicks.
  // Identity still records them in path(); selection and expand skip them.
  function commentShellRank(n) {
    var id = n.getAttribute('data-node') || '';
    if (id === '__fixed__' || id === '__page__') return 100;
    var prefix = nodePrefix(n);
    var name = nodeName(n);
    if (prefix === 'bg' || /^bg(?:\/|$)/i.test(name)) return 90;
    if (prefix === 'kv' || /^kv(?:\/|$)/i.test(name) || name === 'kv') return 80;
    var r = hostRect(n);
    var frame = commentFrame();
    var b = hostRect(frame);
    var covers = b.width > 0 && b.height > 0 && r.width * r.height >= b.width * b.height * 0.5;
    if (covers && !String(n.textContent || '').trim() && !n.querySelector('[data-node]')) return 95;
    if (covers && commentKind(n) >= 3) return 85;
    return 0;
  }
  function commentKind(n) {
    var type = (n.getAttribute('data-figma-type') || '').toUpperCase();
    var prefix = nodePrefix(n);
    if (type === 'TEXT' || prefix === 'txt') return 0;
    if (prefix === 'btn' || prefix === 'dropmenu') return 1;
    if (prefix === 'img') return 2;
    return 3;
  }
  function label(n) {
    return (nodeName(n) ||
      (n.textContent || '内容区域').trim().slice(0, 50) || '内容区域').slice(0, 100);
  }
  function chain(n) {
    var a = [];
    var innerRoot = frozenDoc() && frozenDoc().documentElement;
    for (var x = n; x && x !== host.stage && x !== innerRoot; x = x.parentElement) {
      if (!x.hasAttribute || !x.hasAttribute('data-node')) continue;
      if (a.length && commentShellRank(x) >= 95) continue;
      a.push(x);
    }
    return a;
  }
  function rebuild() {
    index = new Map();
    contentNodes = [];
    fallbackNodes = [];
    var frame = commentFrame();
    var b = hostRect(frame);
    var frameArea = b.width * b.height;
    nodeRoots().forEach(function (rootEl) {
      rootEl.querySelectorAll('[data-node]').forEach(function (n) {
        var k = JSON.stringify(path(n));
        if (!index.has(k)) index.set(k, []);
        index.get(k).push(n);
        var id = n.getAttribute('data-node') || '';
        if (id === '__fixed__' || id === '__page__') return;
        var prefix = nodePrefix(n);
        var name = nodeName(n);
        if (prefix === 'bg' || /^bg(?:\/|$)/i.test(name) || prefix === 'kv' || /^kv(?:\/|$)/i.test(name) || name === 'kv') {
          fallbackNodes.push(n);
          return;
        }
        var r = hostRect(n);
        var covers = frameArea > 0 && r.width * r.height >= frameArea * 0.5;
        if (covers && !String(n.textContent || '').trim() && !n.querySelector('[data-node]')) return;
        if (covers && commentKind(n) >= 3) return;
        contentNodes.push(n);
      });
    });
    dirty = false;
  }
  function find(row) {
    if (dirty) rebuild();
    var a = index.get(JSON.stringify(row.anchor.path)) || [];
    if (a.length !== 1) return { reason: a.length ? '范围不唯一，请重新定位' : '原内容已删除或替换' };
    var n = a[0];
    if (row.anchor.tag && row.anchor.tag !== n.tagName) return { reason: '原内容类型已改变，请重新定位' };
    return { node: n };
  }
  function visibility(n) {
    var b = hostRect(n);
    if (!b.width || !b.height) return { node: n, reason: '内容当前不可见' };
    var clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    if (inFrozenDoc(n)) {
      var fr = frozenFrame().getBoundingClientRect();
      clip.left = Math.max(clip.left, fr.left);
      clip.top = Math.max(clip.top, fr.top);
      clip.right = Math.min(clip.right, fr.right);
      clip.bottom = Math.min(clip.bottom, fr.bottom);
    }
    for (var el = n; el; el = el.parentElement) {
      var css = styleOf(el);
      if (el.hidden || el.getAttribute('aria-hidden') === 'true' || css.display === 'none' ||
          css.visibility === 'hidden' || Number(css.opacity) === 0) return { node: n, reason: '内容当前不可见' };
      if (el !== n) {
        var r = hostRect(el);
        if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) { clip.left = Math.max(clip.left, r.left); clip.right = Math.min(clip.right, r.right); }
        if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) { clip.top = Math.max(clip.top, r.top); clip.bottom = Math.min(clip.bottom, r.bottom); }
      }
    }
    var box = { left: Math.max(b.left, clip.left), top: Math.max(b.top, clip.top),
      right: Math.min(b.right, clip.right), bottom: Math.min(b.bottom, clip.bottom) };
    box.width = Math.max(0, box.right - box.left); box.height = Math.max(0, box.bottom - box.top);
    return { node: n, b: b, r: box, clip: clip };
  }
  function openNamedModalLayer() {
    var frame = commentFrame();
    return frame && frame.querySelector ? frame.querySelector('[data-modal-open="true"]') : null;
  }
  function closeOpenNamedModals() {
    var frame = commentFrame();
    if (!frame || typeof frame.__fxCloseNamedModal !== 'function' || !Array.isArray(frame.__fxNamedModals)) return false;
    var closed = false;
    frame.__fxNamedModals.forEach(function (entry) {
      if (entry && entry.layer && entry.layer.getAttribute('data-modal-open') === 'true') {
        frame.__fxCloseNamedModal(entry);
        closed = true;
      }
    });
    return closed;
  }
  function commentInOpenNamedModal(node) {
    var openModal = openNamedModalLayer();
    return !!(openModal && node && node.closest && openModal.contains(node));
  }
  function geometry(n, anchor) {
    var v = visibility(n);
    if (!v.b) return v;
    var x = v.b.left + anchor.u * v.b.width, y = v.b.top + anchor.v * v.b.height;
    var visible = x >= v.clip.left && x <= v.clip.right && y >= v.clip.top && y <= v.clip.bottom && v.r.width > 0 && v.r.height > 0;
    var openModal = openNamedModalLayer();
    var coveredByOpenModal = !!(openModal && n.closest && !openModal.contains(n));
    return {
      node: n, r: v.r, x: x, y: y, visible: visible, coveredByOpenModal: coveredByOpenModal,
      reason: visible ? (coveredByOpenModal ? '其他层级，当前弹窗打开时先隐藏' : '') : '评论位置在可视范围外，点击列表可滚动定位'
    };
  }
  function locate(row) {
    if (tiled()) return { reason: '平铺视图，请从列表打开单个状态' };
    if (!current(row)) return { reason: '其他语言／地区／状态／版式' };
    var f = find(row);
    return f.node ? geometry(f.node, row.anchor) : f;
  }
  function drawBox(p) {
    if (!p || !p.r || !p.r.width || !p.r.height || p.coveredByOpenModal) { outline.hidden = true; return; }
    outline.hidden = false;
    Object.assign(outline.style, { left: p.r.left + 'px', top: p.r.top + 'px', width: p.r.width + 'px', height: p.r.height + 'px' });
  }
  function place(row) {
    if (!row || pop.hidden) return;
    var p = locate(row), x = p.visible ? p.x : innerWidth / 2, y = p.visible ? p.y : innerHeight / 2;
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var left = x + 20 + w <= innerWidth - 10 ? x + 20 : x - w - 20;
    pop.style.left = Math.max(10, Math.min(innerWidth - w - 10, left)) + 'px';
    pop.style.top = Math.max(10, Math.min(innerHeight - h - 10, y - 10)) + 'px';
  }
  function replyDraftValue() {
    var input = pop.querySelector('textarea[aria-label="补充评论"]');
    return input && !pop.hidden ? input.value : '';
  }
  function close() {
    if (writeBusy) return;
    draft = null; active = null; submitButton = null; composerNote = null; detailNote = null;
    lastDetailKey = ''; replyOpen = false; openedResolved = false;
    pop.hidden = true; outline.hidden = true; schedule();
  }
  function setMode(on) {
    if (on && !db) { say('本地评论库尚未就绪'); return; }
    if (on && tiled()) { say('请先关闭「平铺全部状态」，再点选评论范围'); return; }
    mode = on; modeButton.setAttribute('aria-pressed', String(on));
    host.stage.classList.toggle('qc-selecting', on);
    document.documentElement.setAttribute('data-qa-commenting', on ? '1' : '0');
    if (on) {
      if (active && !draft) close();
      say('点击内容或拖动框选；蓝框确认范围，可扩大到整块内容。Esc 退出');
    }
    else { drag = null; hover = null; }
    schedule();
  }
  function makeAnchor(node, x, y) {
    var b = hostRect(node);
    return { path: path(node), tag: node.tagName, label: label(node),
      u: Math.max(0, Math.min(1, (x - b.left) / b.width)), v: Math.max(0, Math.min(1, (y - b.top) / b.height)) };
  }
  function form(node, x, y) {
    active = null;
    draft = { pageKey: dbKey, context: ctx(), viewport: host.viewport(), anchor: makeAnchor(node, x, y) };
    pop.replaceChildren(); pop.hidden = false;
    var h = mk('div', 'qc-head'); h.append(mk('strong', '', '新评论'), closeBtn('取消', close));
    pop.setAttribute('aria-label', '写新评论');
    var sel = mk('select'); sel.setAttribute('aria-label', '评论对象');
    var candidates = chain(node);
    candidates.forEach(function (n, i) {
      var o = mk('option', '', (i ? '扩大至：' : '当前：') + label(n)); o.value = i; sel.appendChild(o);
    });
    composerNote = mk('p', 'qc-note', '蓝框就是评论范围，确认后发布。可选择父级扩大到整块内容。');
    var input = mk('textarea'); input.placeholder = '描述需要修改的问题…'; input.setAttribute('aria-label', '评论内容'); input.maxLength = 4000;
    submitButton = btn('发布评论', function () {
      if (!draft || !input.value.trim() || writeBusy) return;
      var p = locate(draft);
      if (!p.visible || !db) { say('当前范围无法确认，请重新点选'); return; }
      var now = Date.now();
      save({ id: newId(), pageKey: dbKey, context: draft.context, viewport: draft.viewport,
        anchor: draft.anchor, body: input.value.trim(), createdAt: now, updatedAt: now, resolved: false, replies: [] });
    });
    submitButton.classList.add('qc-primary'); submitButton.disabled = true;
    input.oninput = function () { submitButton.disabled = !input.value.trim() || writeBusy || !db || !locate(draft).visible; };
    input.onkeydown = function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitButton.click(); } };
    sel.onchange = function () {
      var n = candidates[Number(sel.value)], b = hostRect(n);
      draft.anchor = makeAnchor(n, Math.max(b.left, Math.min(b.right, x)), Math.max(b.top, Math.min(b.bottom, y)));
      drawBox(locate(draft)); place(draft); schedule();
    };
    var actions = mk('div', 'qc-actions'); actions.append(btn('取消', close), submitButton);
    pop.append(h, sel, composerNote, input, actions); drawBox(locate(draft)); place(draft); input.focus();
    swallowClick = { x: x, y: y, at: Date.now() };
    pop.style.pointerEvents = 'none';
    setTimeout(function () { pop.style.pointerEvents = ''; }, 0);
    schedule();
  }

  function renderDetail(row, options) {
    options = options || {};
    var draftText = (options.keepReplyDraft && replyOpen) ? replyDraftValue() : '';
    var key = JSON.stringify([row.id, row.resolved, row.updatedAt, repliesOf(row).map(function (item) { return item.id; })]);
    if (options.keepReplyDraft && key === lastDetailKey) return;
    lastDetailKey = key;
    pop.replaceChildren(); pop.hidden = false; submitButton = null; composerNote = null;
    var h = mk('div', 'qc-head');
    var resolve = btn('', function () { save(row, !row.resolved); });
    resolve.classList.add('qc-icon-btn', 'qc-resolve');
    resolve.setAttribute('aria-label', row.resolved ? '恢复为未解决' : '标记已解决');
    resolve.setAttribute('aria-pressed', String(!!row.resolved));
    resolve.appendChild(svgIcon('M5 12.5l4 4 10-10'));
    resolve.title = row.resolved ? '恢复后，图钉会再出现在页面上' : '解决后，图钉从当前页面隐藏；列表里仍可找回';
    resolve.disabled = !db || writeBusy;
    var headActions = mk('div', 'qc-head-actions');
    headActions.append(resolve, closeBtn('关闭窗口', close));
    h.append(mk('strong', '', row.resolved ? '已解决' : '评论'), headActions);
    pop.setAttribute('aria-label', row.resolved ? '已解决评论' : '评论详情');
    var meta = mk('p', 'qc-note', [row.context.lang, row.context.region, row.context.state,
      row.context.composition, row.anchor.label].join(' · '));
    detailNote = mk('p', 'qc-note qc-warning', locate(row).reason || '');
    var thread = mk('div', 'qc-thread');
    repliesOf(row).forEach(function (item) {
      var reply = mk('div', 'qc-reply');
      reply.append(authorTime(item, 'p'), mk('div', '', item.body));
      thread.appendChild(reply);
    });
    var full = repliesOf(row).length >= 30;
    var composer = mk('div', 'qc-composer');
    if (full) {
      composer.appendChild(mk('p', 'qc-note', '这条评论已满 30 条补充。'));
    } else if (replyOpen || draftText) {
      var replyInput = mk('textarea');
      replyInput.placeholder = '补充这条评论…';
      replyInput.setAttribute('aria-label', '补充评论');
      replyInput.maxLength = 4000;
      replyInput.disabled = !db || writeBusy;
      var replyButton = btn('发布补充', function () {
        if (!replyInput.value.trim() || writeBusy || !db) return;
        var now = Date.now();
        save(row, undefined, { id: newId(), body: replyInput.value.trim(), createdAt: now });
      });
      replyButton.classList.add('qc-primary');
      replyButton.disabled = !replyInput.value.trim() || replyInput.disabled;
      replyInput.oninput = function () { replyButton.disabled = !replyInput.value.trim() || writeBusy || !db; };
      replyInput.onkeydown = function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); replyButton.click(); } };
      var cancelReply = btn('取消', function () {
        replyOpen = false; lastDetailKey = '';
        renderDetail(row);
      });
      var replyActions = mk('div', 'qc-actions'); replyActions.append(cancelReply, replyButton);
      composer.append(mk('p', 'qc-note', '可继续补充，不会新增图钉。'), replyInput, replyActions);
      if (draftText) {
        replyInput.value = draftText;
        replyButton.disabled = !draftText.trim() || replyInput.disabled;
      }
    } else {
      var replyToggle = btn('回复', function () {
        replyOpen = true; lastDetailKey = '';
        renderDetail(row, { focusReply: true });
      });
      replyToggle.setAttribute('aria-label', '回复这条评论');
      var threadActions = mk('div', 'qc-thread-actions');
      threadActions.appendChild(replyToggle);
      composer.appendChild(threadActions);
    }
    pop.append(h, meta, authorTime(row), mk('p', 'qc-note qc-sync-state', syncLabel(row)), detailNote, mk('div', 'qc-copy', row.body), thread, composer);
    if (api && row._sync) pop.appendChild(btn('立即重试同步', function () { retry(row); }));
    if (options.focusReply) {
      var input = pop.querySelector('textarea[aria-label="补充评论"]');
      if (input) input.focus();
    }
    place(row); schedule();
  }
  function namedModalNameOf(el) {
    if (!el || !el.getAttribute) return '';
    return String(el.getAttribute('data-modal-name') || '').trim();
  }
  function namedModalCatalog(frame) {
    return frame && Array.isArray(frame.__fxNamedModals) ? frame.__fxNamedModals : [];
  }
  function namedModalByName(name) {
    var wanted = String(name || '').trim();
    if (!wanted) return null;
    var frame = commentFrame();
    return namedModalCatalog(frame).find(function (entry) {
      return entry && String(entry.name || '') === wanted;
    }) || null;
  }
  function openNamedModalByName(name) {
    var frame = commentFrame();
    var modal = namedModalByName(name);
    if (!modal || !frame || typeof frame.__fxOpenNamedModal !== 'function') return false;
    frame.__fxOpenNamedModal(modal);
    return true;
  }
  function revealCommentSurface(node) {
    if (!node || !node.closest) return [];
    var frame = commentFrame();
    var opened = [];
    var innerRoot = frozenDoc() && frozenDoc().documentElement;
    for (var el = node; el && el !== host.stage && el !== innerRoot; el = el.parentElement) {
      if (!el.getAttribute) continue;
      var modalName = namedModalNameOf(el);
      if (modalName && el.getAttribute('data-modal-open') !== 'true'
          && openNamedModalByName(modalName)) {
        opened.push('modal:' + modalName);
      }
      var switchPage = el.getAttribute('data-switch-page');
      var switchId = el.getAttribute('data-switch');
      var variantIndex = el.getAttribute('data-switch-variant-index');
      if (switchPage == null && variantIndex != null) switchPage = variantIndex;
      if (switchPage != null && switchId && frame && typeof frame.__fxApplySwitch === 'function') {
        frame.__fxApplySwitch(switchId, Number(switchPage));
        opened.push('switch:' + switchId + ':' + switchPage);
      }
      var carouselHost = el.hasAttribute('data-motion-carousel') ? el
        : (el.closest ? el.closest('[data-motion-carousel]') : null);
      if (carouselHost && typeof carouselHost.__fxCarouselMoveTo === 'function') {
        var pages = carouselHost.querySelectorAll('[data-motion-carousel-page]');
        var idx = -1;
        for (var i = 0; i < pages.length; i++) {
          if (pages[i] === el || (pages[i].contains && pages[i].contains(el))) { idx = i; break; }
        }
        if (idx >= 0) {
          carouselHost.__fxCarouselMoveTo(idx, false);
          opened.push('carousel:' + idx);
        }
      }
    }
    return opened;
  }
  function show(row) {
    if (!row || writeBusy) return;
    var keepList = !panel.hidden;
    close(); setMode(false);
    panel.hidden = !keepList;
    if (!current(row) || tiled()) {
      if (typeof host.navigate !== 'function' || !host.navigate(row.context, row.viewport || {}) || !current(row) || tiled()) {
        say('评论所在的页面组合已不可用；仍可在列表查看或标记解决');
        active = row.id; openedResolved = !!row.resolved; renderDetail(row); return;
      }
    }
    active = row.id;
    replyOpen = false;
    openedResolved = !!row.resolved;
    dirty = true;
    var found = find(row);
    if (found.node && openNamedModalLayer() && !commentInOpenNamedModal(found.node)) closeOpenNamedModals();
    var opened = found.node ? revealCommentSurface(found.node) : [];
    dirty = true;
    var p = locate(row);
    var openedModal = opened.some(function (item) { return String(item).indexOf('modal:') === 0; })
      || !!(p.node && commentInOpenNamedModal(p.node));
    if (p.node && !openedModal) p.node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    renderDetail(row); drawList();
  }
  function drawList() {
    var open = rows.filter(function (r) { return !r.resolved; }).length;
    allCount.textContent = String(open);
    allButton.setAttribute('aria-label', '全部评论 · ' + open);
    var filtered = rows.filter(function (r) {
      return (scope.value === 'all' || current(r)) && (status.value === 'pending' ? !!r._sync :
        status.value === 'all' || !!r.resolved === (status.value === 'resolved'));
    }).slice().reverse();
    // Only rebuild on data/context/target changes, not every scroll frame.
    var descriptions = filtered.map(function (r) { return current(r) ? locate(r).reason || '' : ''; });
    var key = JSON.stringify([active, scope.value, status.value, filtered, descriptions]);
    if (key === lastListKey) return;
    lastListKey = key; list.replaceChildren();
    if (!filtered.length) list.appendChild(mk('p', 'qc-note', '此范围暂无评论'));
    filtered.forEach(function (r, i) {
      var b = btn('', function () { show(r); }); b.classList.add('qc-item');
      b.setAttribute('aria-current', String(active === r.id)); b.dataset.commentId = r.id;
      var statusMark = mk('span', 'qc-status ' + (r.resolved ? 'qc-status-done' : 'qc-status-open'), r.resolved ? '已解决' : '未解决');
      var metaLine = mk('small', '');
      metaLine.append(statusMark, doc.createTextNode([r.context.lang, r.context.region, r.context.state, r.context.composition].join(' / ')));
      var extra = repliesOf(r).length;
      b.append(metaLine, mk('span', '', r.body));
      if (extra) b.appendChild(mk('small', '', extra + ' 条补充'));
      b.append(authorTime(r, 'small'), mk('small', 'qc-sync-state', syncLabel(r)));
      if (descriptions[i]) b.appendChild(mk('small', 'qc-warning', descriptions[i]));
      list.appendChild(b);
    });
  }
  function syncPins() {
    var keep = new Set();
    var n = 0;
    rows.forEach(function (row) {
      if (row.resolved || !current(row) || tiled()) return;
      keep.add(row.id);
      n += 1;
      var b = pinButtons.get(row.id);
      if (!b) {
        b = btn('', function () { show(rows.find(function (r) { return r.id === row.id; })); });
        b.className = 'qc-pin'; b.dataset.commentId = row.id;
        pinButtons.set(row.id, b); pins.appendChild(b);
      }
      b.textContent = String(n); b.title = row.body;
      b.setAttribute('aria-label', '查看评论 ' + n + '：' + row.anchor.label);
    });
    pinButtons.forEach(function (b, id) { if (!keep.has(id)) { b.remove(); pinButtons.delete(id); } });
  }
  function refresh() {
    var key = ckey(ctx()) + ':' + tiled();
    if (key !== contextKey) {
      var keepList = !panel.hidden;
      if (contextKey && (draft || mode || (active && !keepList))) { close(); setMode(false); }
      panel.hidden = !keepList;
      contextKey = key; syncPins(); drawList();
    }
    schedule();
  }
  function schedule() {
    if (disposed || rafId != null) return;
    rafId = requestAnimationFrame(paint);
  }
  function paint() {
    rafId = null;
    if (disposed) return;
    var key = ckey(ctx()) + ':' + tiled();
    if (key !== contextKey) { refresh(); }
    var bar = toolbar.closest('.bar');
    root.style.setProperty('--qc-top', Math.min(innerHeight - 120, (bar ? bar.getBoundingClientRect().bottom : 0) + 12) + 'px');
    var positions = new Map();
    rows.forEach(function (row) {
      var b = pinButtons.get(row.id);
      if (!b) return;
      var p = locate(row); positions.set(row.id, p); b.hidden = !p.visible || !!p.coveredByOpenModal;
      if (p.visible && !p.coveredByOpenModal) { b.style.left = p.x + 'px'; b.style.top = p.y + 'px'; }
      b.setAttribute('aria-expanded', String(active === row.id));
    });
    var selected = draft || rows.find(function (r) { return r.id === active; });
    if (selected) {
      var p = positions.get(selected.id) || locate(selected);
      drawBox(p);
      if (draft && submitButton) {
        var input = pop.querySelector('textarea');
        submitButton.disabled = !db || writeBusy || !p.visible || !input || !input.value.trim();
        composerNote.textContent = p.reason || '蓝框就是评论范围，确认后发布。可选择父级扩大到整块内容。';
      } else if (detailNote) detailNote.textContent = p.reason || '';
      place(selected);
    } else if (!drag) { drawBox(mode && hover && hover.isConnected ? geometry(hover, { u: .5, v: .5 }) : null); }
    if (!panel.hidden) drawList();
    // CSS transitions can move anchors without DOM mutations or resize events.
    // Measure only while comments/selection are present; never traverse the tree per frame.
    if (!doc.hidden && (pinButtons.size || selected || mode)) schedule();
  }
  function nodeAtPoint(list, x, y) {
    var best = null, bestArea = Infinity;
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      var v = visibility(n);
      if (!v.b || !v.r || x < v.r.left || x > v.r.right || y < v.r.top || y > v.r.bottom) continue;
      var area = v.r.width * v.r.height;
      if (area < bestArea) { best = n; bestArea = area; }
    }
    return best;
  }
  function targetAt(x, y) {
    var top = doc.elementFromPoint(x, y);
    if (top && root.contains(top)) return null;
    var frame = frozenFrame();
    if (frame) {
      var fr = frame.getBoundingClientRect();
      if (x >= fr.left && x <= fr.right && y >= fr.top && y <= fr.bottom) {
        var inner = frozenDoc();
        if (inner && inner.elementsFromPoint) {
          var innerHits = inner.elementsFromPoint(x - fr.left, y - fr.top);
          var innerSeen = [];
          for (var j = 0; j < innerHits.length; j++) {
            var innerEl = innerHits[j];
            var innerNode = innerEl.closest && innerEl.closest('[data-node]');
            if (!innerNode || !ownsNode(innerNode) || innerSeen.indexOf(innerNode) >= 0) continue;
            innerSeen.push(innerNode);
            if (commentShellRank(innerNode) >= 80) continue;
            return innerNode;
          }
          if (dirty) rebuild();
          return nodeAtPoint(contentNodes, x, y) || nodeAtPoint(fallbackNodes, x, y);
        }
      }
    }
    var hits = doc.elementsFromPoint(x, y);
    var seen = [];
    for (var i = 0; i < hits.length; i++) {
      var el = hits[i];
      if (root.contains(el) || !host.stage.contains(el)) continue;
      var n = el.closest('[data-node]');
      if (!n || n === host.stage || !host.stage.contains(n) || seen.indexOf(n) >= 0) continue;
      seen.push(n);
      if (commentShellRank(n) >= 80) continue;
      return n;
    }
    if (dirty) rebuild();
    return nodeAtPoint(contentNodes, x, y) || nodeAtPoint(fallbackNodes, x, y);
  }
  host.stage.addEventListener('pointermove', function (e) {
    if (!mode || draft) return;
    if (drag) {
      drawBox({ r: { left: Math.min(e.clientX, drag.x), top: Math.min(e.clientY, drag.y),
        width: Math.abs(e.clientX - drag.x), height: Math.abs(e.clientY - drag.y) } });
    } else { hover = targetAt(e.clientX, e.clientY); schedule(); }
  }, true);
  host.stage.addEventListener('pointerdown', function (e) {
    if (!mode || draft || e.button !== 0) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var n = targetAt(e.clientX, e.clientY);
    if (!n) { say('这里没有可绑定的内容，请点选有蓝框的范围'); return; }
    drag = { x: e.clientX, y: e.clientY, node: n, pointerId: e.pointerId };
    try { host.stage.setPointerCapture(e.pointerId); } catch (_) {}
  }, true);
  host.stage.addEventListener('pointerup', function (e) {
    if (!drag) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var d = drag; drag = null;
    try { host.stage.releasePointerCapture(e.pointerId); } catch (_) {}
    var end = targetAt(e.clientX, e.clientY);
    if (!end) { say('请在同一内容块内完成框选'); schedule(); return; }
    if (Math.abs(e.clientX - d.x) > 6 || Math.abs(e.clientY - d.y) > 6) {
      var endChain = chain(end);
      var common = chain(d.node).find(function (n) { return endChain.indexOf(n) >= 0; });
      if (common) form(common, (e.clientX + d.x) / 2, (e.clientY + d.y) / 2);
      else { say('这些内容没有共同范围，请分别评论'); schedule(); }
    } else form(d.node, e.clientX, e.clientY);
  }, true);
  host.stage.addEventListener('pointercancel', function () { drag = null; hover = null; schedule(); }, true);
  host.stage.addEventListener('pointerleave', function () { if (!drag) { hover = null; schedule(); } });
  host.stage.addEventListener('click', function (e) { if (mode || draft) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  doc.addEventListener('click', function (e) {
    if (!swallowClick) return;
    if (pop.contains(e.target) || panel.contains(e.target) || toolbar.contains(e.target)) {
      swallowClick = null;
      return;
    }
    var recent = Date.now() - swallowClick.at < 600;
    var near = Math.abs(e.clientX - swallowClick.x) < 28 && Math.abs(e.clientY - swallowClick.y) < 28;
    if (recent && near) {
      e.preventDefault(); e.stopImmediatePropagation();
    }
    swallowClick = null;
  }, true);
  doc.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || writeBusy) return;
    if (!pop.hidden) { close(); setMode(false); return; }
    if (mode) { setMode(false); return; }
    panel.hidden = true;
  });
  try {
    channel = new BroadcastChannel('gameweb-qa-comments');
    channel.onmessage = function (e) { if (e.data && e.data.pageKey === dbKey) reload(); };
  } catch (_) { channel = null; }
  var observer = new MutationObserver(function (records) {
    // Animation/resize style changes do not change identities. Avoid rebuilding
    // the entire Figma node index on each animation frame.
    if (records.some(function (r) { return r.type === 'childList' || r.attributeName === 'data-node'; })) {
      dirty = true;
      lastListKey = '';
      if (!panel.hidden) drawList();
    }
    watchFrozenDoc();
    schedule();
  });
  observer.observe(host.stage, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-node', 'hidden', 'aria-hidden', 'style', 'class'] });
  var frozenObserverTarget = null;
  var frozenLoadBound = null;
  var frozenScrollBound = null;
  function watchFrozenDoc() {
    var frame = frozenFrame();
    if (frame && frozenLoadBound !== frame) {
      frozenLoadBound = frame;
      frame.addEventListener('load', function () { dirty = true; watchFrozenDoc(); schedule(); });
    }
    var inner = frozenDoc();
    if (inner && frozenScrollBound !== inner) {
      frozenScrollBound = inner;
      inner.addEventListener('scroll', schedule, true);
    }
    var next = inner && inner.documentElement;
    if (next === frozenObserverTarget) return;
    frozenObserverTarget = next;
    if (next) observer.observe(next, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-node', 'hidden', 'aria-hidden', 'style', 'class'] });
    dirty = true;
  }
  watchFrozenDoc();
  window.addEventListener('focus', reload);
  window.addEventListener('online', remoteTick);
  window.addEventListener('resize', schedule);
  window.addEventListener('qa-pref-change', refresh);
  doc.addEventListener('scroll', schedule, true);
  doc.addEventListener('visibilitychange', function () { if (!doc.hidden) { reload(); schedule(); } });
  window.addEventListener('pagehide', function (e) {
    if (e.persisted) return;
    disposed = true; if (channel) channel.close(); if (pollTimer) clearInterval(pollTimer); if (db) db.close(); observer.disconnect();
    if (rafId != null) cancelAnimationFrame(rafId); clearTimeout(timer);
  });
  modeButton.disabled = true;
  openDb().then(function () { modeButton.disabled = false; storageReady(); reload(); startRemote(); }).catch(function (e) {
    fail(e); panel.hidden = false;
  });
  contextKey = ckey(ctx()) + ':' + tiled();
  schedule();
  return { toolbar: toolbar, refresh: refresh };
}
