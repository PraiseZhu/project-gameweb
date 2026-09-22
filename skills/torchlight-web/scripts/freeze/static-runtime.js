(function () {
  'use strict';

  var MOBILE_MAX = 1126;
  var PC_DESIGN = 3840;
  var MOBILE_DESIGN = 750;
  var FREEZE = 1920;
  var SCRIM = 0.8;

  var PC_UNCHECKED = 'data:image/webp;base64,UklGRlwAAABXRUJQVlA4TE8AAAAvLoAJEC9AJm2T+ve7bz7mXyBA8N+qgUCA8F8lyYEAtiE0dws1AYA00AAiEIEIjgj2T7NYl1dE/ycAzKfh2rBh80J4pXhixuWpWfstDLMAAA==';
  var MOBILE_UNCHECKED = 'data:image/webp;base64,UklGRk4AAABXRUJQVlA4TEEAAAAvHUAGEBcgFkzmL9yZxfxPu0AgCWV/qVUC+gmMIklSVO/1x6pWAqPOY/hH9H8C2F2b4KSUsoIA8JeFy/yfrM0j+wA=';
  var PC_CHECKED = 'data:image/webp;base64,UklGRjQBAABXRUJQVlA4TCcBAAAvLoAJEB+hqG0jKXPwZ7uvmdnQmH+GbSMp8lH/xd49wyAKoDQXgQbSYPZ/LRIkMHwMTqDDHIUD4+UUoyhQQiDRB6XCl4Q4AdXJQVBBFiQgVZLq++rCJmrjP7M4A9e2bSsJYNNdesTY//+Rl3PrmI8R/XfktpEjsezT5N0Jf4DkLBmQycyRlSgHyUymxEREJylaL5FSJJ7TKbxdBCWE5yRKs7YGpExrS4hhU0GMVimPMzsqTCS6QMqVdYCU68TvJinLRKJuRERjLiZmDRJHz3bj1EsER88LzeYYbmZXPZEl+s3sbHs259nzm9mVMbwXfns6M2XcsRuO150lhpvZgyV77Wb2YQyf6Q4v9ox3+LItDODJkrW+LOkDiALwRziEnpMayXy1PggAAA==';
  var MOBILE_CHECKED = 'data:image/webp;base64,UklGRuYAAABXRUJQVlA4TNoAAAAvHUAGEOegoG0jJ7+fP90boTH/itu2cZTrdf9Rz68zgkhS8g04EkAEItjA6kbQBm+D8CtI4AdqgAYNg1sADD4DyCnU7MU9pQAgekACgPxkh7IgIH93L+PAlSTbSvOI4XZ5g5/9LzR2ifxH9H8CEndJWT/jniiL9DC4QpJD3EGuAxVYkB9Y0BEW5FbCdJJbC5zltXYAidc6QT28kafPlhEavZGj6aNlhEbvnCOW3i0jFHpL54ilUhYhl4MuYOktEne5aAMD2+WkDbAgN21Y0AG6Bh3y8n/w/oyjAQ==';

  function platOf(w) {
    return w <= MOBILE_MAX ? 'mobile' : 'pc';
  }
  function designWidthOf(frame, plat) {
    var dw = Number(frame && frame.getAttribute('data-design-width'));
    if (dw > 0) return dw;
    return plat === 'mobile' ? MOBILE_DESIGN : PC_DESIGN;
  }
  function columnWidth(w, dw) {
    if (!(w > 0)) return dw;
    if (dw <= 750 || w <= MOBILE_MAX) return w;
    if (w <= FREEZE) return FREEZE;
    return w;
  }
  function scaleK(w, dw) {
    if (Number.isFinite(w) && w > 0) {
      if (dw <= 750 || w <= MOBILE_MAX) return Math.min(1, w / 750);
      if (w <= FREEZE) return 0.5;
      return w / 3840;
    }
    return 1;
  }
  function windowStageWidth(dw, k, w) {
    if (!(dw > 0)) return dw;
    if (!(w > 0) || !(k > 0)) return dw;
    if (w > 1920) return dw;
    return Math.max(dw, w / k);
  }
  function nodeBox(el) {
    var parts = String(el && el.getAttribute && el.getAttribute('data-node-box') || '').split(',');
    return {
      x: Number(parts[0]) || 0,
      y: Number(parts[1]) || 0,
      w: Number(parts[2]) || 0,
      h: Number(parts[3]) || 0
    };
  }
  function nodeNameOf(el) {
    if (!el || !el.getAttribute) return '';
    return String(el.getAttribute('data-name') || el.getAttribute('data-node-name') || el.getAttribute('data-btn-name') || '');
  }
  function nodePrefixOf(el) {
    return String(el && el.getAttribute && el.getAttribute('data-prefix') || '');
  }
  function clusterKind(elOrName) {
    var name = '';
    var btn = '';
    if (elOrName && elOrName.getAttribute) {
      name = nodeNameOf(elOrName);
      btn = String(elOrName.getAttribute('data-btn-name') || '');
      if (elOrName.getAttribute('data-hero-cluster') === 'bottom') {
        var tagged = name || btn;
        if (!tagged) return 'cluster';
      }
    } else {
      name = String(elOrName || '');
    }
    if (/^slg(?:\/|$)/i.test(name) || /^img\/标题slg(?:@|$)/i.test(name)) return 'slg';
    if (/日历icon|日历按钮/i.test(name) || btn === '日历icon' || btn === '日历按钮') return 'calendar';
    if (/播放按钮/.test(name) || btn === '播放按钮') return 'play';
    if (/^首屏主按钮/.test(name)) return 'cta';
    if (/^标题(?:$|@)/.test(name)) return 'title';
    if (elOrName && elOrName.getAttribute && elOrName.getAttribute('data-hero-cluster') === 'bottom') return 'cluster';
    return '';
  }
  function isDropmenuNode(el) {
    if (!el || !el.getAttribute) return false;
    if (el.getAttribute('data-dropmenu') === 'true') return true;
    var pfx = nodePrefixOf(el);
    var name = nodeNameOf(el);
    return pfx === 'dropmenu' || /^dropmenu(?:\/|$)/i.test(name);
  }
  function isOverlayNode(el) {
    if (!el) return false;
    if (el.classList && el.classList.contains('fx-fixed-overlays')) return true;
    return !!(el.closest && el.closest('.fx-fixed-overlays, [data-node-id="page-fixed-overlays"]'));
  }
  function applyKvCover(hero, plat, dw, k, w, h, crop) {
    if (!hero || !(k > 0) || !(dw > 0)) return;
    var kv = hero.querySelector('[data-hero-visual-plane="kv"], [data-kv-cover-plane="cover-crop"], [data-name="kv"]');
    if (!kv) return;
    var box = nodeBox(kv);
    var sourceW = box.w || dw;
    var sourceH = box.h || Number(hero.getAttribute('data-hero-source-height')) || 0;
    if (!(sourceW > 0) || !(sourceH > 0)) return;
    var coverScale = Math.max(w / dw, h / sourceH);
    if (!(coverScale > 0)) return;
    var planeRatio = coverScale / k;
    var viewportWDesign = w / k;
    var viewportHDesign = h / k;
    var origin = plat === 'mobile' ? 'center 0' : 'center center';
    var coverLeftDesign = (viewportWDesign - sourceW * planeRatio) / 2 - crop;
    var coverTopDesign = origin === 'center 0' ? 0 : (viewportHDesign - sourceH * planeRatio) / 2;
    kv.style.left = coverLeftDesign + 'px';
    kv.style.top = coverTopDesign + 'px';
    kv.style.width = sourceW + 'px';
    kv.style.height = sourceH + 'px';
    kv.style.transformOrigin = '0 0';
    kv.style.transform = Math.abs(planeRatio - 1) > 0.001 ? ('scale(' + planeRatio + ')') : 'none';
    kv.setAttribute('data-hero-visual-plane-scale', String(planeRatio));
    kv.setAttribute('data-kv-cover-window', 'viewport');
    kv.setAttribute('data-kv-cover-origin', origin);
    hero.style.overflow = 'hidden';
  }
  function applyAgeBadge(frame, hero, k, w, h, crop) {
    var list = frame.querySelectorAll('[data-ss14-age-left], [data-btn-name="年龄"], [data-go*="适龄提示"]');
    var heroH = Number(hero && hero.getAttribute('data-hero-source-height')) || 0;
    var slot = k > 0 ? (h / k) : heroH;
    var ratio = heroH > 0 ? (slot / heroH) : 1;
    var half = heroH / 2;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.closest && el.closest('.fx-named-modal')) continue;
      if (hero && el.closest && !hero.contains(el)) continue;
      var box = nodeBox(el);
      var figmaX = box.x;
      var figmaY = box.y;
      var figmaW = box.w;
      var figmaH = box.h;
      if (w <= MOBILE_MAX) {
        el.style.left = figmaX + 'px';
        el.style.top = figmaY + 'px';
        if (figmaW > 0) el.style.width = figmaW + 'px';
        if (figmaH > 0) el.style.height = figmaH + 'px';
      } else {
        var freezeK = 0.5;
        var pageK = k > 0 ? k : 1;
        el.style.left = (-crop + figmaX * freezeK / pageK) + 'px';
        if (w <= FREEZE) {
          if (figmaW > 0) el.style.width = (figmaW * freezeK / pageK) + 'px';
          if (figmaH > 0) el.style.height = (figmaH * freezeK / pageK) + 'px';
        } else {
          if (figmaW > 0) el.style.width = figmaW + 'px';
          if (figmaH > 0) el.style.height = figmaH + 'px';
        }
        if (heroH > 0 && figmaH > 0) {
          var sourceBottom = figmaY + figmaH;
          el.style.top = (sourceBottom > half ? (sourceBottom * ratio - figmaH) : (figmaY * ratio)) + 'px';
        }
      }
      var img = el.querySelector('img');
      if (img) {
        img.style.width = el.style.width;
        img.style.height = el.style.height;
      }
      el.setAttribute('data-ss14-age-left', '1');
    }
  }
  function leftoverShiftX(k, w, dw) {
    if (!(w >= 740 && w <= MOBILE_MAX) || !(k > 0)) return 0;
    var design = dw > 0 && dw <= 750 ? dw : 750;
    return (w / k - design) / 2;
  }
  function applyHeroClusterY(hero, k, h) {
    if (!hero) return;
    var heroH = Number(hero.getAttribute('data-hero-source-height')) || 0;
    if (!(heroH > 0) || !(k > 0)) return;
    var slot = h / k;
    var ratio = slot / heroH;
    var half = heroH / 2;
    var kids = hero.children;
    var cluster = [];
    var i;
    for (i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (!el || el.nodeType !== 1) continue;
      var name = String(el.getAttribute('data-name') || el.getAttribute('data-node-name') || '');
      var kind = clusterKind(el) || clusterKind(name) || (el.getAttribute('data-hero-cluster') === 'bottom' ? 'cluster' : '');
      if (!kind) continue;
      var box = nodeBox(el);
      if (!(box.h > 0)) continue;
      if (kind === 'slg' && box.y < 50) continue;
      cluster.push({ el: el, box: box });
    }
    var bottom = 0;
    for (i = 0; i < cluster.length; i++) {
      var btm = cluster[i].box.y + cluster[i].box.h;
      if (btm > bottom) bottom = btm;
    }
    var shift = bottom > 0 ? (bottom * (ratio - 1)) : 0;
    for (i = 0; i < cluster.length; i++) {
      cluster[i].el.style.top = (cluster[i].box.y + shift) + 'px';
      cluster[i].el.setAttribute('data-hero-cluster', 'bottom');
      cluster[i].el.setAttribute('data-hero-cluster-shift', String(shift));
    }
    var kids = hero.children;
    for (i = 0; i < kids.length; i++) {
      var child = kids[i];
      if (!child || child.nodeType !== 1) continue;
      var childName = String(child.getAttribute('data-name') || child.getAttribute('data-node-name') || '');
      if (/^kv(?:\/|$)/i.test(childName) || child.getAttribute('data-hero-visual-plane') === 'kv') continue;
      if (/年龄@go=modal/.test(childName) || child.getAttribute('data-btn-name') === '年龄') continue;
      if (clusterKind(childName) || child.getAttribute('data-hero-cluster') === 'bottom') continue;
      var childBox = nodeBox(child);
      if (!(childBox.h > 0)) continue;
      var sourceBottom = childBox.y + childBox.h;
      child.style.top = (sourceBottom > half ? (sourceBottom * ratio - childBox.h) : (childBox.y * ratio)) + 'px';
    }
  }
  function applyLeftoverX(hero, later, k, w, dw) {
    var shiftX = leftoverShiftX(k, w, dw);
    function shiftNode(el) {
      if (!el || el.nodeType !== 1) return;
      if (el.closest && el.closest('.fx-named-modal')) return;
      var box = nodeBox(el);
      el.style.left = (box.x + shiftX) + 'px';
      if (Math.abs(shiftX) > 0.5) el.setAttribute('data-ss14-slg-center', String(shiftX));
      else el.removeAttribute('data-ss14-slg-center');
    }
    if (hero) {
      var heroKids = hero.children;
      for (var i = 0; i < heroKids.length; i++) {
        var el = heroKids[i];
        var name = String(el.getAttribute('data-name') || el.getAttribute('data-node-name') || '');
        if (/^kv(?:\/|$)/i.test(name) || el.getAttribute('data-hero-visual-plane') === 'kv') continue;
        if (/年龄@go=modal/.test(name) || el.getAttribute('data-btn-name') === '年龄') continue;
        if (el.getAttribute('data-prefix') === 'bg') continue;
        shiftNode(el);
      }
    }
  }
  function laterStagesOf(frame) {
    if (!frame || !frame.querySelectorAll) return [];
    return Array.prototype.slice.call(frame.querySelectorAll('[data-hero-slot-role="after-hero"]'));
  }
  function firstLaterOf(laters) {
    if (!laters || !laters.length) return null;
    return laters.reduce(function (lowest, el) {
      var y = parseFloat(el.style.top);
      var low = lowest == null ? Infinity : parseFloat(lowest.style.top);
      return isFinite(y) && y < low ? el : lowest;
    }, null);
  }
  function laterContentBottom(el) {
    if (!el) return 0;
    var top = parseFloat(el.style.top);
    if (!isFinite(top)) top = nodeBox(el).y;
    if (!isFinite(top)) top = 0;
    var h = parseFloat(el.style.height);
    if (!(h > 0)) h = nodeBox(el).h;
    return top + (h > 0 ? h : 0);
  }
  function laterSpanOf(laters) {
    var bottom = 0;
    for (var i = 0; i < (laters || []).length; i++) {
      var b = laterContentBottom(laters[i]);
      if (b > bottom) bottom = b;
    }
    return bottom;
  }
  function isPageBgBoard(el) {
    if (!el || !el.getAttribute) return false;
    if (el.getAttribute('data-hero-visual-plane') === 'kv') return false;
    var name = nodeNameOf(el);
    var prefix = nodePrefixOf(el);
    return prefix === 'bg' && /^bg\/(pc|mobile)$/i.test(name);
  }
  function capturedPageFrameHeight(page) {
    if (!page) return 0;
    var stored = parseFloat(page.getAttribute('data-page-frame-height'));
    if (stored > 0) return stored;
    var h = parseFloat(page.style.height);
    if (h > 0) {
      page.setAttribute('data-page-frame-height', String(h));
      return h;
    }
    return 0;
  }
  function backgroundBottom(frame, page) {
    var root = page || frame;
    if (!root || !root.querySelectorAll) return 0;
    var bgs = root.querySelectorAll('[data-prefix="bg"], [data-name^="bg/"]');
    var bottom = 0;
    for (var i = 0; i < bgs.length; i++) {
      if (!isPageBgBoard(bgs[i])) continue;
      var box = nodeBox(bgs[i]);
      var top = parseFloat(bgs[i].style.top);
      if (!isFinite(top)) top = box.y;
      var h = box.h > 0 ? box.h : parseFloat(bgs[i].style.height);
      if (isFinite(top) && h > 0 && top + h > bottom) bottom = top + h;
    }
    return bottom;
  }
  function chromeBottomOf(nodes) {
    var bottom = 0;
    for (var i = 0; i < (nodes || []).length; i++) {
      var el = nodes[i];
      var top = parseFloat(el.style.top);
      if (!isFinite(top)) top = nodeBox(el).y;
      var h = parseFloat(el.style.height);
      if (!(h > 0)) h = nodeBox(el).h;
      if (isFinite(top) && h > 0 && top + h > bottom) bottom = top + h;
    }
    return bottom;
  }
  function pageScrollHeight(frame, page, laters, slot, chrome) {
    var board = backgroundBottom(frame, page);
    var frameH = capturedPageFrameHeight(page);
    if (board > 0 && frameH > 0) return Math.min(board, frameH);
    if (board > 0) return board;
    if (frameH > 0) return frameH;
    return Math.max(slot > 0 ? slot : 0, laterSpanOf(laters), chromeBottomOf(chrome));
  }
  function afterHeroChromeOf(page, hero, laters) {
    if (!page || !page.querySelectorAll) return [];
    var nodes = page.querySelectorAll('[data-prefix="btn"], [data-name^="btn/"]');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (hero && hero.contains(el)) continue;
      var nested = false;
      for (var j = 0; j < (laters || []).length; j++) {
        if (laters[j].contains(el)) { nested = true; break; }
      }
      if (nested) continue;
      if (!el.getAttribute('data-later-capture-top')) {
        var capture = parseFloat(el.style.top);
        if (!isFinite(capture)) capture = nodeBox(el).y;
        el.setAttribute('data-later-capture-top', String(capture));
      }
      out.push(el);
    }
    return out;
  }
  function shiftAfterHeroChrome(nodes, laterShift) {
    if (!isFinite(laterShift)) return;
    for (var i = 0; i < (nodes || []).length; i++) {
      var captureTop = Number(nodes[i].getAttribute('data-later-capture-top'));
      if (isFinite(captureTop)) nodes[i].style.top = (captureTop + laterShift) + 'px';
    }
  }
  function applyPageBgCover(page, stageW) {
    if (!page || !(stageW > 0) || !page.querySelectorAll) return;
    var bgs = page.querySelectorAll('[data-prefix="bg"], [data-name^="bg/"]');
    for (var i = 0; i < bgs.length; i++) {
      var el = bgs[i];
      if (!isPageBgBoard(el)) continue;
      var box = nodeBox(el);
      var sourceW = box.w;
      var sourceH = box.h;
      if (!(sourceW > 0) || !(sourceH > 0)) continue;
      var cover = Math.max(stageW / sourceW, 1);
      var coverLeft = (stageW - sourceW * cover) / 2;
      var sourceTopNow = parseFloat(el.style.top);
      var baseTop = isFinite(sourceTopNow) ? sourceTopNow : box.y;
      el.style.left = coverLeft + 'px';
      el.style.top = baseTop + 'px';
      el.style.width = sourceW + 'px';
      el.style.height = sourceH + 'px';
      el.style.transformOrigin = '0 0';
      el.style.transform = Math.abs(cover - 1) > 1e-6 ? ('scale(' + cover + ')') : 'none';
      el.setAttribute('data-later-cover-plane', 'cover-crop');
      el.setAttribute('data-later-cover-window', 'page-window');
      el.setAttribute('data-later-cover-axis', 'x');
      el.setAttribute('data-later-cover-scale', String(cover));
    }
  }
  function applyLaterBgCover(later, stageW) {
    if (!later || !(stageW > 0)) return;
    var boxH = parseFloat(later.style.height) || nodeBox(later).h || 0;
    var bgs = later.querySelectorAll('[data-prefix="bg"], [data-name^="bg/"]');
    for (var i = 0; i < bgs.length; i++) {
      var el = bgs[i];
      if (el.getAttribute('data-hero-visual-plane') === 'kv') continue;
      if (isPageBgBoard(el)) continue;
      var box = nodeBox(el);
      var sourceW = box.w;
      var sourceH = box.h;
      if (!(sourceW > 0) || !(sourceH > 0) || !(boxH > 0)) continue;
      var cover = Math.max(stageW / sourceW, boxH / sourceH);
      if (!(cover > 0)) continue;
      var coverLeft = (stageW - sourceW * cover) / 2;
      var coverTop = (boxH - sourceH * cover) / 2;
      el.style.left = coverLeft + 'px';
      el.style.top = coverTop + 'px';
      el.style.width = sourceW + 'px';
      el.style.height = sourceH + 'px';
      el.style.transformOrigin = '0 0';
      el.style.transform = Math.abs(cover - 1) > 1e-6 ? ('scale(' + cover + ')') : 'none';
      el.setAttribute('data-later-cover-plane', 'cover-crop');
      el.setAttribute('data-later-cover-window', 'later-stage');
      el.setAttribute('data-later-cover-scale', String(cover));
    }
  }
  function applyStageBoxes(page, hero, laters, stageW, slot, chrome) {
    if (hero && stageW > 0) {
      hero.style.width = stageW + 'px';
      hero.style.overflow = 'hidden';
    }
    for (var i = 0; i < (laters || []).length; i++) {
      if (!(stageW > 0)) continue;
      laters[i].style.width = stageW + 'px';
    }
    if (page && stageW > 0) {
      page.style.width = stageW + 'px';
      var pageH = pageScrollHeight(page, page, laters, slot, chrome);
      if (pageH > 0) page.style.height = pageH + 'px';
    }
  }
  function applyPaintRoots(page, hero, laters, stageW, slot, chrome) {
    if (!page || !(stageW > 0)) return;
    var stages = page.querySelectorAll('.fx-stage');
    var s;
    for (s = 0; s < stages.length; s++) {
      stages[s].style.width = stageW + 'px';
    }
    var pageH = pageScrollHeight(page, page, laters, slot, chrome);
    var roots = page.querySelectorAll('[data-paint-root], .fx-root-layer');
    for (var r = 0; r < roots.length; r++) {
      var layer = roots[r];
      layer.style.width = stageW + 'px';
      var isHeroRoot = !!(layer.getAttribute('data-hero-crop-window')
        || layer === hero);
      var isLaterRoot = !!(layer.getAttribute('data-section-layer-box') === 'pageBox-clip'
        || layer.getAttribute('data-hero-slot-role') === 'after-hero');
      if (!isLaterRoot) {
        for (var li = 0; li < (laters || []).length; li++) {
          if (layer === laters[li]) { isLaterRoot = true; break; }
        }
      }
      var hostsLater = false;
      for (var lh = 0; lh < (laters || []).length; lh++) {
        if (layer.contains(laters[lh]) && layer !== laters[lh]) { hostsLater = true; break; }
      }
      var hostsBg = false;
      var layerBgs = layer.querySelectorAll('[data-prefix="bg"], [data-name^="bg/"]');
      for (var bg = 0; bg < layerBgs.length; bg++) {
        if (!isPageBgBoard(layerBgs[bg])) continue;
        hostsBg = true;
        break;
      }
      if (isHeroRoot && !hostsLater && !hostsBg) {
        if (slot > 0) layer.style.height = slot + 'px';
        layer.style.overflow = 'hidden';
      } else if (isLaterRoot || hostsLater || hostsBg) {
        if (pageH > 0) {
          layer.style.height = pageH + 'px';
          layer.style.overflow = (hostsLater || hostsBg) ? 'visible' : 'hidden';
        }
      } else if (pageH > 0) {
        layer.style.height = pageH + 'px';
      }
    }
    if (hero) {
      hero.style.width = stageW + 'px';
      hero.style.overflow = 'hidden';
      if (slot > 0) hero.style.height = slot + 'px';
    }
    for (var j = 0; j < (laters || []).length; j++) {
      laters[j].style.width = stageW + 'px';
    }
  }
  function applyLaterUiCenter(later, stageW, dw) {
    if (!later || !(stageW > 0) || !(dw > 0)) return;
    var shift = (stageW - dw) / 2;
    var kids = later.children;
    for (var i = 0; i < kids.length; i++) {
      var node = kids[i];
      if (!node || node.nodeType !== 1) continue;
      if (node.closest && node.closest('.fx-named-modal')) continue;
      var nm = String(node.getAttribute('data-name') || node.getAttribute('data-node-name') || '');
      var prefix = String(node.getAttribute('data-prefix') || '');
      if (prefix === 'bg' || prefix === 'kv' || /^bg(?:\/|$)/i.test(nm) || /^kv(?:\/|$)/i.test(nm)) continue;
      if (isDropmenuNode(node) || isOverlayNode(node)) continue;
      var box = nodeBox(node);
      if (shift > 0.5) {
        node.style.left = (box.x + shift) + 'px';
        node.setAttribute('data-later-mobile-center', String(shift));
      } else {
        if (node.getAttribute('data-later-mobile-center')) {
          node.style.left = box.x + 'px';
          node.removeAttribute('data-later-mobile-center');
        }
      }
    }
  }
  function assertOverlayBeforePage(frame) {
    if (!frame) return;
    var overlay = frame.querySelector('.fx-fixed-overlays');
    var page = frame.querySelector('[data-node-id="page-scope"]');
    if (!overlay || !page || overlay.parentNode !== page.parentNode) return;
    var pos = overlay.compareDocumentPosition(page);
    if (pos & 2) frame.insertBefore(overlay, page);
  }
  function abutHeroJoin(hero, laters, k) {
    var later = firstLaterOf(laters);
    if (!hero || !later || !(k > 0)) return;
    var hb = hero.getBoundingClientRect();
    var lb = later.getBoundingClientRect();
    var gap = lb.top - hb.bottom;
    if (!(gap > 0.05 && gap < 2)) return;
    var delta = gap / k;
    for (var i = 0; i < laters.length; i++) {
      var top = parseFloat(laters[i].style.top);
      if (!isFinite(top)) continue;
      laters[i].style.top = (top - delta) + 'px';
    }
  }
  function applyDropmenuLock(frame, k, w) {
    if (!(w >= 740 && w <= MOBILE_MAX)) return;
    var menus = frame.querySelectorAll('[data-name^="dropmenu/多语言"], [data-dropmenu-name*="多语言"]');
    for (var i = 0; i < menus.length; i++) {
      var el = menus[i];
      var parent = el.parentElement;
      var parentX = parent ? nodeBox(parent).x : 370;
      if (!(parentX > 0)) parentX = 370;
      el.style.left = (506 - parentX) + 'px';
      el.setAttribute('data-ss14-dropmenu-lock', '1');
    }
  }
  function lockProductScrollX(frame) {
    if (!frame || frame.__fxScrollXLock) return;
    frame.__fxScrollXLock = true;
    frame.addEventListener('scroll', function () {
      if (frame.scrollLeft) frame.scrollLeft = 0;
    }, { passive: true });
    frame.addEventListener('wheel', function (ev) {
      if (ev.deltaX && Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) ev.preventDefault();
      if (frame.scrollLeft) frame.scrollLeft = 0;
    }, { passive: false });
  }
  function applyFixViewportPin(el, k, w, h) {
    if (!el) return;
    var pinV = String(el.getAttribute('data-fix-pin-v') || '').toUpperCase();
    var pinH = String(el.getAttribute('data-fix-pin-h') || '').toUpperCase();
    var slotH = (k > 0 && h > 0) ? (h / k) : 0;
    var slotW = (k > 0 && w > 0) ? (w / k) : 0;
    var gapBottom = Number(el.getAttribute('data-fix-gap-bottom'));
    var gapTop = Number(el.getAttribute('data-fix-gap-top'));
    var gapRight = Number(el.getAttribute('data-fix-gap-right'));
    var gapLeft = Number(el.getAttribute('data-fix-gap-left'));
    var boardW = Number(el.getAttribute('data-fix-board-w'));
    var box = nodeBox(el);
    var sourceW = box.w;
    var sourceH = box.h;
    var nearBoardBottom = isFinite(gapBottom) && isFinite(gapTop) && (gapBottom + sourceH) <= gapTop;
    var nearBoardCenter = isFinite(gapLeft) && isFinite(gapRight)
      && Math.abs(gapLeft - gapRight) <= Math.max(2, sourceW * 0.15);
    if ((pinV === 'BOTTOM' || (pinV === 'TOP' && nearBoardBottom)) && isFinite(gapBottom) && slotH > 0) {
      el.style.top = (slotH - gapBottom - sourceH) + 'px';
      el.setAttribute('data-fix-anchor', 'bottom-gap');
    } else if (pinV === 'CENTER' && slotH > 0) {
      el.style.top = ((slotH - sourceH) / 2) + 'px';
      el.setAttribute('data-fix-anchor', 'center');
    }
    if ((pinH === 'CENTER' || ((pinH === 'LEFT' || pinH === 'RIGHT') && nearBoardCenter)) && slotW > 0) {
      el.style.left = ((slotW - sourceW) / 2) + 'px';
      el.setAttribute('data-fix-anchor-h', 'center');
    } else if (pinH === 'RIGHT' && isFinite(gapRight) && isFinite(boardW) && boardW > 0) {
      el.style.left = (boardW - gapRight - sourceW) + 'px';
      el.setAttribute('data-fix-anchor-h', 'right');
    } else if (pinH === 'LEFT' && isFinite(gapLeft) && !el.hasAttribute('data-topbar-chrome')) {
      el.style.left = gapLeft + 'px';
      el.setAttribute('data-fix-anchor-h', 'left');
    }
  }
  function activeFrame() {
    var plat = platOf(window.innerWidth);
    return document.querySelector('.frame[data-tree="' + plat + '"]');
  }
  function originalDisplay(node) {
    if (!node) return '';
    if (node.getAttribute('data-fx-original-display') != null) {
      return node.getAttribute('data-fx-original-display') || '';
    }
    return '';
  }
  function hideInPlace(node, hidden) {
    if (!node || node.nodeType !== 1) return;
    if (node.getAttribute('data-fx-original-display') == null) {
      node.setAttribute('data-fx-original-display', node.style.display || '');
    }
    var orig = originalDisplay(node);
    node.hidden = !!hidden;
    node.style.display = hidden ? 'none' : ((orig && orig !== 'none') ? orig : '');
    node.setAttribute('aria-hidden', hidden ? 'true' : 'false');
  }
  function isCloseControl(el) {
    if (!el || !el.getAttribute) return false;
    var named = el.getAttribute('data-name') || el.getAttribute('data-node-name') || '';
    var btn = el.getAttribute('data-btn-name') || '';
    var name = named || (el.getAttribute('data-prefix') === 'btn' && btn ? 'btn/' + btn : btn);
    return /^(?:btn|img)\s*[\/／]\s*关闭按钮(?:@|$)/i.test(String(name || '').trim())
      || btn === '关闭按钮';
  }
  function closeControlFromEvent(ev) {
    var hit = ev.target && ev.target.closest
      ? ev.target.closest('[data-btn-name], [data-node-name], [data-name]')
      : null;
    if (!hit) return null;
    return isCloseControl(hit) ? hit : null;
  }
  function modalNameOf(go) {
    return String(go || '').replace(/^modal\//, '');
  }
  function findModal(frame, goName) {
    var raw = modalNameOf(goName);
    var list = frame.querySelectorAll('.fx-named-modal');
    for (var i = 0; i < list.length; i++) {
      var n = list[i].getAttribute('data-modal-name') || '';
      if (n === raw || n === goName || ('modal/' + n) === goName) return list[i];
    }
    return null;
  }
  function ensureScrim(host, opacity) {
    var alpha = Number(opacity);
    if (!isFinite(alpha)) alpha = SCRIM;
    var scrim = host.querySelector('[data-modal-scrim="true"]');
    if (alpha <= 0) {
      if (scrim) scrim.remove();
      return null;
    }
    if (!scrim) {
      scrim = document.createElement('div');
      scrim.setAttribute('data-modal-scrim', 'true');
      scrim.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:0;';
      host.insertBefore(scrim, host.firstChild);
    }
    scrim.style.background = 'rgba(0,0,0,' + alpha + ')';
    return scrim;
  }
  function lockScroll(frame, lock) {
    if (lock) {
      if (frame.getAttribute('data-modal-prev-overflow') == null) {
        frame.setAttribute('data-modal-prev-overflow', frame.style.overflowY || '');
      }
      frame.style.overflowY = 'hidden';
      frame.setAttribute('data-modal-scroll-lock', 'true');
    } else {
      var prev = frame.getAttribute('data-modal-prev-overflow');
      if (prev != null) frame.style.overflowY = prev;
      frame.removeAttribute('data-modal-scroll-lock');
    }
  }
  function pinModal(frame, layer) {
    var host = layer.parentElement;
    var w = Number.parseFloat(frame.style.width) || frame.clientWidth || window.innerWidth;
    var h = Number.parseFloat(frame.style.height) || frame.clientHeight || window.innerHeight;
    var source = String(layer.getAttribute('data-modal-source-box') || '').split(',');
    var plat = frame.getAttribute('data-tree') || platOf(window.innerWidth);
    var dw = designWidthOf(frame, plat);
    var designW = Number(source[2]) || parseFloat(layer.style.width) || (plat === 'mobile' ? 750 : 3840);
    var designH = Number(source[3]) || parseFloat(layer.style.height) || (plat === 'mobile' ? 1334 : 2160);
    var mobileSheet = plat === 'mobile' || dw <= 750;
    var scale = mobileSheet
      ? (w / Math.max(designW, 1))
      : Math.max(w / Math.max(designW, 1), h / Math.max(designH, 1));
    if (host && host.classList.contains('fx-named-modals')) {
      if (!host.getAttribute('data-modal-rest-width')) {
        host.setAttribute('data-modal-rest-width', host.style.width || (dw + 'px'));
        host.setAttribute('data-modal-rest-height', host.style.height || '');
        host.setAttribute('data-modal-rest-zoom', host.style.zoom || '');
      }
      host.style.position = 'absolute';
      host.style.left = '0px';
      host.style.top = (Number(frame.scrollTop) || 0) + 'px';
      host.style.width = w + 'px';
      host.style.height = h + 'px';
      host.style.zoom = '1';
      host.style.transform = 'none';
      host.style.pointerEvents = 'auto';
      host.style.zIndex = '2147483001';
      host.style.overflow = 'hidden';
      host.setAttribute('data-modal-fill', mobileSheet ? 'contain' : 'cover');
      ensureScrim(host, SCRIM);
    }
    hideInPlace(layer, false);
    layer.removeAttribute('hidden');
    layer.setAttribute('data-modal-open', 'true');
    var scaledW = designW * scale;
    var scaledH = designH * scale;
    var phoneOverflow = mobileSheet || scaledW > w + 1 || scaledH > h + 1;
    if (phoneOverflow) {
      var sheet = layer.querySelector(':scope > [data-modal-sheet="true"]');
      if (!sheet) {
        sheet = document.createElement('div');
        sheet.setAttribute('data-modal-sheet', 'true');
        sheet.style.position = 'absolute';
        sheet.style.left = '0px';
        sheet.style.top = '0px';
        while (layer.firstChild) sheet.appendChild(layer.firstChild);
        layer.appendChild(sheet);
      }
      var offsetX = (w - scaledW) / 2;
      var offsetY = scaledH > h + 1 ? (h - scaledH) / 2 : 0;
      sheet.style.width = designW + 'px';
      sheet.style.height = designH + 'px';
      sheet.style.zoom = '1';
      sheet.style.transformOrigin = '0 0';
      sheet.style.transform = 'translate(' + offsetX + 'px,' + offsetY + 'px) scale(' + scale + ')';
      layer.style.left = '0px';
      layer.style.top = '0px';
      layer.style.width = w + 'px';
      layer.style.height = h + 'px';
      layer.style.maxWidth = 'none';
      layer.style.maxHeight = 'none';
      layer.style.zoom = '1';
      layer.style.transformOrigin = '0 0';
      layer.style.transform = 'none';
      layer.style.overflow = 'hidden';
    } else {
      layer.style.left = '0px';
      layer.style.top = '0px';
      layer.style.width = designW + 'px';
      layer.style.height = designH + 'px';
      layer.style.maxWidth = 'none';
      layer.style.maxHeight = 'none';
      layer.style.zoom = '1';
      layer.style.transformOrigin = '0 0';
      layer.style.transform = 'scale(' + scale + ')';
      layer.style.overflow = layer.getAttribute('data-modal-clip') === 'source' ? 'hidden' : 'visible';
    }
    layer.style.pointerEvents = 'auto';
    layer.style.zIndex = '41';
    lockScroll(frame, true);
  }
  function unpinHost(frame, layer) {
    var host = layer && layer.parentElement;
    if (!host || !host.classList.contains('fx-named-modals')) return;
    var still = frame.querySelector('.fx-named-modal[data-modal-open="true"]');
    if (still) return;
    var plat = frame.getAttribute('data-tree') || platOf(window.innerWidth);
    var dw = designWidthOf(frame, plat);
    var w = window.innerWidth || document.documentElement.clientWidth || 0;
    var k = scaleK(w, dw);
    host.style.position = 'absolute';
    host.style.left = '0';
    host.style.top = '0';
    host.style.width = host.getAttribute('data-modal-rest-width') || (dw + 'px');
    host.style.height = host.getAttribute('data-modal-rest-height') || '';
    host.style.transform = '';
    host.style.zoom = host.getAttribute('data-modal-rest-zoom') || String(k);
    host.style.pointerEvents = 'none';
    host.style.zIndex = '40';
    host.style.overflow = 'visible';
    host.removeAttribute('data-modal-fill');
    var scrim = host.querySelector('[data-modal-scrim="true"]');
    if (scrim) scrim.remove();
    lockScroll(frame, false);
  }
  function closeModal(frame, layer) {
    if (!layer) return;
    hideInPlace(layer, true);
    layer.setAttribute('hidden', '');
    layer.removeAttribute('data-modal-open');
    layer.style.transform = '';
    unpinHost(frame, layer);
  }
  function openModal(frame, layer) {
    if (!layer) return;
    var open = frame.querySelectorAll('.fx-named-modal[data-modal-open="true"]');
    for (var i = 0; i < open.length; i++) {
      if (open[i] !== layer) closeModal(frame, open[i]);
    }
    pinModal(frame, layer);
  }
  function paintRegionOptions(owner, selectedIdx) {
    if (!owner) return;
    var idx = Number(selectedIdx);
    if (!Number.isFinite(idx) || idx < 0) idx = Number(owner.__fxRegionIndex);
    if (!Number.isFinite(idx) || idx < 0) idx = Number(owner.getAttribute('data-region-index'));
    if (!Number.isFinite(idx) || idx < 0) idx = 0;
    var labels = ['台灣+886', '香港+852', '澳門+853'];
    var btns = owner.querySelectorAll('[data-name="btn/号码地区选择"], [data-btn-name="号码地区选择"]');
    for (var i = 0; i < btns.length; i++) {
      var btn = btns[i];
      var nextState = ((i % 3) === idx) ? 'highlight' : 'normal';
      btn.setAttribute('data-btn-variant-state', nextState);
      btn.setAttribute('data-btn-variant-fill-source', nextState);
      var kids = btn.children;
      var overlayState = '';
      var k;
      for (k = 0; k < kids.length; k++) {
        var probe = kids[k];
        if (probe.nodeType !== 1) continue;
        var st = probe.getAttribute('data-btn-variant-state');
        if (st && probe.getAttribute('data-name') !== 'btn/号码地区选择') {
          overlayState = st;
          break;
        }
      }
      for (k = 0; k < kids.length; k++) {
        var child = kids[k];
        if (child.nodeType !== 1) continue;
        var childState = child.getAttribute('data-btn-variant-state');
        var isOverlay = !!(childState && child.getAttribute('data-name') !== 'btn/号码地区选择');
        if (isOverlay) hideInPlace(child, childState !== nextState);
        else hideInPlace(child, overlayState === nextState);
      }
      var label = labels[i % 3];
      var texts = btn.querySelectorAll('[data-name="台灣+886"]');
      for (k = 0; k < texts.length; k++) texts[k].textContent = label;
    }
  }
  function applyDropmenu(owner, nextState) {
    if (!owner) return;
    owner.setAttribute('data-dropmenu-state', nextState);
    var isRegion = /切换地区/.test(String(owner.getAttribute('data-name') || owner.getAttribute('data-dropmenu-name') || ''));
    var sc = Number(owner.getAttribute('data-dropmenu-scale')) || 1;
    var children = owner.children;
    var i;
    if (isRegion && nextState === 'off') {
      owner.style.height = (68 * sc) + 'px';
      owner.style.overflow = 'hidden';
      owner.style.zIndex = owner.getAttribute('data-fx-prev-z') || '';
      for (i = 0; i < children.length; i++) {
        var child = children[i];
        var nm = (child.getAttribute && child.getAttribute('data-name')) || '';
        if (child.getAttribute('data-dropmenu-layer') === 'true') {
          hideInPlace(child, true);
          continue;
        }
        if (/号码地区选择|Frame 1312316825/.test(nm)) hideInPlace(child, true);
        else hideInPlace(child, false);
      }
      return;
    }
    owner.style.overflow = nextState === 'on' ? 'visible' : (owner.style.overflow || '');
    if (nextState === 'on') {
      if (!owner.getAttribute('data-fx-prev-z')) owner.setAttribute('data-fx-prev-z', owner.style.zIndex || '');
      owner.style.zIndex = '50';
    } else {
      owner.style.zIndex = owner.getAttribute('data-fx-prev-z') || '';
    }
    for (i = 0; i < children.length; i++) {
      var node = children[i];
      if (node.getAttribute && node.getAttribute('data-dropmenu-layer') === 'true') {
        var layerState = node.getAttribute('data-dropmenu-layer-state');
        hideInPlace(node, layerState ? layerState !== nextState : nextState !== 'on');
        continue;
      }
      hideInPlace(node, false);
    }
    if (isRegion && nextState === 'on') paintRegionOptions(owner);
  }
  function toggleDropmenu(owner) {
    var current = owner.getAttribute('data-dropmenu-state');
    if (current !== 'on' && current !== 'off') current = 'off';
    applyDropmenu(owner, current === 'on' ? 'off' : 'on');
  }
  function closeDropmenus(frame) {
    var list = frame.querySelectorAll('[data-dropmenu="true"]');
    for (var i = 0; i < list.length; i++) applyDropmenu(list[i], 'off');
  }
  function findImg(el) {
    if (!el) return null;
    return el.querySelector('img.fx-img, img') || (el.tagName === 'IMG' ? el : null);
  }
  function isCheckButton(el) {
    if (!el || el.nodeType !== 1) return false;
    var name = String(el.getAttribute('data-btn-name') || el.getAttribute('data-name') || '');
    return name === '勾选按钮' || name === 'btn/勾选按钮';
  }
  function isMobileCheck(el) {
    var img = findImg(el);
    var current = img ? String(img.getAttribute('src') || '') : '';
    if (current === MOBILE_UNCHECKED || current === MOBILE_CHECKED) return true;
    if (current === PC_UNCHECKED || current === PC_CHECKED) return false;
    var boxH = Number.parseFloat(el && el.style && el.style.height || '');
    return Number.isFinite(boxH) && boxH > 0 && boxH <= 32;
  }
  function setCheckState(el, state) {
    if (!isCheckButton(el)) return false;
    var img = findImg(el);
    if (!img) return false;
    var on = state === 'on';
    img.setAttribute('src', on ? (isMobileCheck(el) ? MOBILE_CHECKED : PC_CHECKED) : (isMobileCheck(el) ? MOBILE_UNCHECKED : PC_UNCHECKED));
    el.setAttribute('data-check-state', on ? 'on' : 'off');
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.setAttribute('data-btn-variant-state', on ? 'highlight' : 'normal');
    return true;
  }
  function toast(frame, msg, sticky) {
    var host = frame.__fxCopyToast;
    if (!host) {
      host = document.createElement('div');
      host.setAttribute('data-copy-toast', 'true');
      host.style.cssText = 'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:9999;background:#1e232c;color:#fff;border:1px solid #39424f;border-radius:8px;padding:10px 16px;font-size:13px;box-shadow:0 12px 32px rgba(0,0,0,.5);max-width:80%;';
      document.body.appendChild(host);
      frame.__fxCopyToast = host;
    }
    host.textContent = msg;
    host.style.display = 'block';
    clearTimeout(frame.__fxCopyToastTimer);
    if (!sticky) frame.__fxCopyToastTimer = setTimeout(function () { host.style.display = 'none'; }, 2200);
  }
  function applyAdaptive() {
    var w = window.innerWidth || document.documentElement.clientWidth || 0;
    var h = window.innerHeight || document.documentElement.clientHeight || 0;
    var plat = platOf(w);
    document.documentElement.setAttribute('data-plat', plat);
    var wraps = document.querySelectorAll('[data-tree-wrap]');
    for (var i = 0; i < wraps.length; i++) {
      var on = wraps[i].getAttribute('data-tree-wrap') === plat;
      wraps[i].hidden = !on;
      wraps[i].style.width = w + 'px';
      wraps[i].style.height = h + 'px';
      wraps[i].style.overflow = 'hidden';
      wraps[i].style.overflowX = 'clip';
      wraps[i].style.padding = '0';
      wraps[i].style.border = '0';
      wraps[i].style.boxShadow = 'none';
    }
    var frames = document.querySelectorAll('.frame[data-tree]');
    for (var f = 0; f < frames.length; f++) {
      var frame = frames[f];
      var onFrame = frame.getAttribute('data-tree') === plat;
      frame.hidden = !onFrame;
      if (!onFrame) continue;
      var dw = designWidthOf(frame, plat);
      var k = scaleK(w, dw);
      var col = columnWidth(w, dw);
      var crop = 0;
      if (col > 0 && w > 0 && Math.abs(col - w) > 0.5 && k > 0) crop = ((w - col) / 2) / k;
      var stageW = windowStageWidth(dw, k, w);
      frame.style.width = w + 'px';
      frame.style.height = h + 'px';
      frame.style.overflowY = frame.getAttribute('data-modal-scroll-lock') === 'true' ? 'hidden' : 'auto';
      frame.style.overflowX = 'clip';
      frame.style.position = 'relative';
      frame.style.left = '0';
      frame.style.transform = 'none';
      frame.setAttribute('data-product-column-width', String(col));
      frame.setAttribute('data-product-column-left', String((w - col) / 2));
      frame.setAttribute('data-fx-base', plat === 'mobile' ? 'mobile' : 'pc');
      if (col !== w) frame.setAttribute('data-product-column-frozen', '1920');
      else frame.removeAttribute('data-product-column-frozen');
      var page = frame.querySelector('[data-node-id="page-scope"]');
      if (page) {
        capturedPageFrameHeight(page);
        page.style.zoom = String(k);
        page.style.width = stageW + 'px';
        page.style.left = crop + 'px';
        page.style.overflowX = 'clip';
        page.style.overflowY = 'hidden';
        page.style.overflow = 'clip hidden';
        page.setAttribute('data-page-stage-scale', String(k));
        page.setAttribute('data-page-stage-crop-left', String(crop));
        page.setAttribute('data-product-column-clip', String(col));
      }
      var hero = frame.querySelector('[data-hero-slot-role="hero"], [data-motion-role="kv"], [data-hero-section]');
      var laters = laterStagesOf(frame);
      var later = firstLaterOf(laters);
      if (hero) {
        if (!hero.getAttribute('data-hero-capture-slot')) {
          hero.setAttribute('data-hero-capture-slot', String(parseFloat(hero.style.height) || 0));
        }
        for (var li = 0; li < laters.length; li++) {
          if (!laters[li].getAttribute('data-later-capture-top')) {
            laters[li].setAttribute('data-later-capture-top', String(parseFloat(laters[li].style.top) || 0));
          }
        }
        var laterChrome = afterHeroChromeOf(page, hero, laters);
        var captureSlot = Number(hero.getAttribute('data-hero-capture-slot'));
        var slot = k > 0 ? (h / k) : captureSlot;
        if (slot > 0) {
          hero.style.height = slot + 'px';
          hero.style.overflow = 'hidden';
          hero.setAttribute('data-hero-slot-design-height', String(slot));
          frame.setAttribute('data-hero-slot-design-height', String(slot));
          if (isFinite(captureSlot)) {
            var laterShift = slot - captureSlot;
            for (var ls = 0; ls < laters.length; ls++) {
              var captureTop = Number(laters[ls].getAttribute('data-later-capture-top'));
              if (isFinite(captureTop)) laters[ls].style.top = (captureTop + laterShift) + 'px';
            }
            shiftAfterHeroChrome(laterChrome, laterShift);
          }
          applyStageBoxes(page, hero, laters, stageW, slot, laterChrome);
          applyPaintRoots(page, hero, laters, stageW, slot, laterChrome);
          applyKvCover(hero, plat, dw, k, w, h, crop);
          applyHeroClusterY(hero, k, h);
          applyLeftoverX(hero, null, k, w, dw);
          applyPageBgCover(page, stageW);
          for (var lu = 0; lu < laters.length; lu++) {
            applyLaterUiCenter(laters[lu], stageW, dw);
            applyLaterBgCover(laters[lu], stageW);
          }
          applyAgeBadge(frame, hero, k, w, h, crop);
          abutHeroJoin(hero, laters, k);
        }
      }
      applyDropmenuLock(frame, k, w);
      lockProductScrollX(frame);
      var fix = frame.querySelector('.fx-fixed-zoom');
      if (fix) {
        fix.style.transform = 'scale(' + k + ')';
        fix.style.transformOrigin = '0 0';
        fix.style.zoom = '1';
      }
      var topbarChrome = frame.querySelectorAll('[data-topbar-chrome="true"]');
      var clusterRight = 0;
      for (var t = 0; t < topbarChrome.length; t++) {
        var clusterBox = String(topbarChrome[t].getAttribute('data-node-box') || '').split(',');
        var clusterLeft = Number(clusterBox[0]);
        var clusterW = Number(clusterBox[2]);
        if (isFinite(clusterLeft) && isFinite(clusterW) && clusterW > 0 && (clusterLeft + clusterW / 2) > dw * 0.5) {
          clusterRight = Math.max(clusterRight, clusterLeft + clusterW);
        }
      }
      var clusterShift = (clusterRight > 0 && k > 0 && w > 0) ? ((w / k) - clusterRight) : 0;
      for (var t2 = 0; t2 < topbarChrome.length; t2++) {
        var chromeEl = topbarChrome[t2];
        var chromeBox = String(chromeEl.getAttribute('data-node-box') || '').split(',');
        var sourceLeft = Number(chromeBox[0]);
        var sourceW = Number(chromeBox[2]);
        if (!(isFinite(sourceLeft) && isFinite(sourceW) && sourceW > 0)) continue;
        if ((sourceLeft + sourceW / 2) <= dw * 0.5) {
          chromeEl.style.left = sourceLeft + 'px';
          chromeEl.removeAttribute('data-topbar-viewport-shift');
          continue;
        }
        if (Math.abs(clusterShift) > 0.5) {
          chromeEl.style.left = (sourceLeft + clusterShift) + 'px';
          chromeEl.setAttribute('data-topbar-viewport-shift', String(clusterShift));
        } else {
          chromeEl.style.left = sourceLeft + 'px';
          chromeEl.removeAttribute('data-topbar-viewport-shift');
        }
      }
      assertOverlayBeforePage(frame);
      var overlays = frame.querySelectorAll('.fx-fixed-overlays');
      for (var o = 0; o < overlays.length; o++) {
        var overlay = overlays[o];
        var zoomEl = overlay.querySelector('.fx-fixed-zoom');
        var bottoms = [];
        var roots = zoomEl ? zoomEl.children : [];
        for (var n = 0; n < roots.length; n++) {
          var box = String(roots[n].getAttribute && roots[n].getAttribute('data-node-box') || '').split(',');
          var y = Number(box[1]);
          var hh = Number(box[3]);
          if (isFinite(y) && isFinite(hh) && hh > 0) bottoms.push(y + hh);
        }
        var slotFloor = k > 0 ? (h / k) : 0;
        var span = Math.max.apply(null, bottoms.concat([slotFloor, 1]));
        if (zoomEl) {
          zoomEl.style.width = dw + 'px';
          zoomEl.style.height = span + 'px';
          zoomEl.setAttribute('data-fix-zoom-span', String(span));
          zoomEl.style.transform = 'scale(' + k + ')';
          zoomEl.style.transformOrigin = '0 0';
          zoomEl.style.zoom = '1';
        }
        var hostH = span * k;
        overlay.style.position = 'sticky';
        overlay.style.left = '0';
        overlay.style.top = '0';
        overlay.style.width = '100%';
        overlay.style.overflow = 'visible';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '20';
        overlay.style.height = hostH + 'px';
        overlay.style.marginBottom = (-hostH) + 'px';
        overlay.setAttribute('data-fix-pin-height', String(hostH));
        var pinRoots = zoomEl ? zoomEl.children : [];
        for (var p = 0; p < pinRoots.length; p++) {
          applyFixViewportPin(pinRoots[p], k, w, h);
        }
      }
      var closedHost = frame.querySelector('.fx-named-modals');
      if (closedHost && !frame.querySelector('.fx-named-modal[data-modal-open="true"]')) {
        closedHost.style.zoom = String(k);
      }
      var open = frame.querySelector('.fx-named-modal[data-modal-open="true"]');
      if (open) pinModal(frame, open);
    }
    document.documentElement.setAttribute('data-product-view', '1');
    document.documentElement.style.overflowX = 'clip';
    document.documentElement.style.fontSize = '16px';
    document.body.style.overflowX = 'clip';
    document.body.style.overflow = 'hidden';
    document.body.style.fontSize = '16px';
  }

  document.addEventListener('click', function (ev) {
    var frame = ev.target && ev.target.closest ? ev.target.closest('.frame[data-tree]') : null;
    if (!frame) frame = activeFrame();
    if (!frame) return;

    var check = ev.target && ev.target.closest
      ? ev.target.closest('[data-btn-name="勾选按钮"], [data-name="btn/勾选按钮"]')
      : null;
    if (check) {
      var next = check.getAttribute('data-check-state') === 'on' ? 'off' : 'on';
      setCheckState(check, next);
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }

    var innerBtn = ev.target && ev.target.closest ? ev.target.closest('[data-prefix="btn"], [data-btn-name]') : null;
    var dropmenuOwner = ev.target && ev.target.closest ? ev.target.closest('[data-dropmenu="true"]') : null;
    if (innerBtn && dropmenuOwner && dropmenuOwner.contains(innerBtn)
      && dropmenuOwner.getAttribute('data-dropmenu-state') === 'on') {
      var regionHit = innerBtn.closest('[data-name="btn/号码地区选择"]') || innerBtn;
      var regionScope = innerBtn.closest('[data-dropmenu-layer="true"]') || dropmenuOwner;
      var regionBtns = regionScope.querySelectorAll('[data-name="btn/号码地区选择"]');
      var regionIdx = Array.prototype.indexOf.call(regionBtns, regionHit);
      var regionLabel = String((innerBtn.textContent || innerBtn.getAttribute('data-name') || '')).replace(/\s+/g, ' ').trim();
      var regionCode = ['+886', '+852', '+853'][regionIdx] || (regionLabel.match(/\+\d+/) || [])[0];
      if (regionCode) {
        var codes = dropmenuOwner.querySelectorAll('[data-name="+886"]');
        for (var c = 0; c < codes.length; c++) codes[c].textContent = regionCode;
      }
      if (regionIdx >= 0) {
        dropmenuOwner.__fxRegionIndex = regionIdx;
        dropmenuOwner.setAttribute('data-region-index', String(regionIdx));
        paintRegionOptions(dropmenuOwner, regionIdx);
      }
      closeDropmenus(frame);
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    if (dropmenuOwner && dropmenuOwner.getAttribute('data-dropmenu-mount-status') === 'owner-local-mutually-exclusive') {
      toggleDropmenu(dropmenuOwner);
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }

    var closeBtn = closeControlFromEvent(ev);
    if (closeBtn) {
      var hostModal = closeBtn.closest('.fx-named-modal');
      if (hostModal) {
        var returnName = hostModal.getAttribute('data-modal-return');
        closeModal(frame, hostModal);
        if (returnName) {
          var back = findModal(frame, returnName);
          if (back) openModal(frame, back);
        }
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
    }

    var goHit = ev.target && ev.target.closest ? ev.target.closest('[data-go]') : null;
    if (goHit) {
      var goName = goHit.getAttribute('data-go');
      var modal = findModal(frame, goName);
      if (modal) {
        var from = goHit.closest('.fx-named-modal');
        if (from && modal !== from && !/预约完成/.test(String(modal.getAttribute('data-modal-name') || ''))) {
          modal.setAttribute('data-modal-return', from.getAttribute('data-modal-name') || '');
        } else {
          modal.removeAttribute('data-modal-return');
        }
        openModal(frame, modal);
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
    }

    var copyBtn = ev.target && ev.target.closest ? ev.target.closest('[data-copy-code]') : null;
    if (copyBtn) {
      ev.preventDefault();
      var codeId = copyBtn.getAttribute('data-copy-code');
      var codeEl = codeId ? frame.querySelector('[data-node="' + codeId + '"]') : null;
      var codeText = (codeEl && (codeEl.textContent || '').trim()) || '';
      if (!codeText) {
        toast(frame, '复制失败，请手动复制', true);
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(codeText).then(function () {
          toast(frame, '已复制兑换码：' + codeText);
        }).catch(function () {
          toast(frame, '复制失败，请手动复制：' + codeText, true);
        });
      } else {
        toast(frame, '复制失败，请手动复制：' + codeText, true);
      }
      return;
    }

    if (!ev.target.closest('[data-dropmenu="true"]')) closeDropmenus(frame);
  }, true);

  window.addEventListener('resize', function () {
    if (applyAdaptive._raf) return;
    applyAdaptive._raf = requestAnimationFrame(function () {
      applyAdaptive._raf = 0;
      applyAdaptive();
    });
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyAdaptive);
  else applyAdaptive();
})();
