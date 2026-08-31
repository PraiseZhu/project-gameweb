import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const renderer = readFileSync(new URL('../../templates/figma-render.js', import.meta.url), 'utf8');
const assetPipeline = readFileSync(new URL('../figma-assets.mjs', import.meta.url), 'utf8');
const coverageGate = readFileSync(new URL('../render-coverage.mjs', import.meta.url), 'utf8');

test('asset locking is based on ownerPath when DOM parent stack is incomplete', () => {
  assert.match(renderer, /const bakedOwnerChain = \[\]/);
  assert.match(renderer, /ancestorIds still\s+names those passed-through parents/);
  assert.match(renderer, /for \(const id of ancestorIds\.map\(\(raw\) => String\(__u\(raw\)\)\)\.reverse\(\)\) pushBakedOwner\(id\)/);
  assert.match(renderer, /const bakedOwnerId = bakedOwnerChain\.find\(\(id\) => !!this\._assetRec\(id\)\)/);
  assert.match(renderer, /parent && parent\.assetLock \|\| \(bakedOwnerId && !bakedOwnerReleased\)/);
});

test('platform-prefixed asset records keep bare-id exportBox geometry', () => {
  assert.match(renderer, /A platform-prefixed record can be a thin file\/imageRef pointer/);
  assert.match(renderer, /return \{ \.\.\.bareRec, \.\.\.platformRec, file: platformRec\.file \|\| bareRec\.file \}/);
});

test('ind/ instances consume the selected componentId slice instead of inventing CSS diamonds', () => {
  assert.match(renderer, /_assetRecForNode\(n, platform = null\)/);
  assert.match(renderer, /CONSUMER\.md: consume by instance componentId/);
  assert.match(renderer, /data-ind-variant-slice', 'componentId'/);
  assert.match(renderer, /ind-variant-slice-complete/);
  assert.match(renderer, /data-paint-as-fragment', 'art-fragment'/);
});

test('REGULAR_POLYGON play triangle uses non-rect shadow/clip mapping, not a CSS rectangle', () => {
  assert.match(renderer, /REGULAR_POLYGON: 1, ELLIPSE: 1, LINE: 1/);
});

test('only explicit interaction descendants remain renderable under baked assets', () => {
  assert.match(renderer, /const evidenceAttrs = interactionAttrs\.get\(String\(nid\)\)/);
  assert.match(renderer, /const hasStructuralInteraction = !!evidenceAttrs/);
  assert.match(renderer, /evidenceAttrs\['data-switch-action'\] != null/);
  assert.match(renderer, /data-hscroll-overflow-child/);
  assert.match(renderer, /underHscrollSurface/);
  assert.match(renderer, /node itself is actionable/);
});

test('live nested hscroll releases an ancestor designer-export bake instead of stacking rest pixels', () => {
  /* mix/ (or any named ancestor) may ship a designer-export composite of the
     rest-state first page. Nested named scroll/ is the live host. Painting both
     leaves the first page pinned under the moving tracks. Release is structural:
     any ancestor with an asset record under a live data-hscroll host, never a
     product node id. */
  assert.match(renderer, /liveHscrollBakeRelease/);
  assert.match(renderer, /data-asset-lock-released', 'live-hscroll-descendant'/);
  assert.match(renderer, /const bakeReleasedForLiveHscroll = liveHscrollBakeRelease\.has\(String\(__u\(nid\)\)\)/);
  assert.match(renderer, /assetRec && !bakeReleasedForLiveHscroll/);
  assert.match(renderer, /ancestorPfx === 'mix' \|\| ancestorPfx === 'scroll' \|\| ancestorClips/);
  assert.doesNotMatch(renderer, /__calendarOwnerAssetLock/);
  assert.doesNotMatch(renderer, /395:34991/);
});

test('renderer stamps the authored Figma layer name for resize name lookup', () => {
  assert.match(renderer, /el\.setAttribute\('data-name', layerName\)/);
  assert.match(renderer, /const layerName = String\(n\.name \?\? ''\)\.trim\(\)/);
});

test('hscroll browser check drives every overflow surface, not the first track only', () => {
  const check = readFileSync(new URL('../lib/figma-hscroll-browser-check.mjs', import.meta.url), 'utf8');
  assert.match(check, /const surfaces = \[\.\.\.host\.querySelectorAll/);
  assert.match(check, /surfaces\.every\(\(surface\) =>/);
  assert.match(check, /Math\.max\(0, \.\.\.surfaces\.map/);
});

test('exported assets do not receive source opacity a second time', () => {
  assert.match(renderer, /if \(st\.opacity != null && st\.opacity !== 1\) \{\s*if \(assetUrl\) el\.setAttribute\('data-opacity-via', 'asset-baked'\);\s*else el\.style\.opacity = String\(st\.opacity\);\s*\}/s);
});

test('component variant controls preserve each source thumbnail identity', () => {
  assert.match(renderer, /data-switch-identity-preserved/);
  assert.match(renderer, /retain\s+each\s+selectable's\s+own\s+complete\s+source\s+tree/);
});

test('Founder YouHei live copy pins Regular width axis instead of CSS condensed default', () => {
  assert.match(renderer, /_youHeiVariationSettings/);
  assert.match(renderer, /Named Regular is wdth=3 \(wide\)/);
  assert.match(renderer, /"wdth" \$\{wdth\}, "hght"/);
  assert.match(renderer, /el\.style\.fontVariationSettings = this\._youHeiVariationSettings\(/);
});

test('FONT_SIZE_% lineHeightPercent becomes a px line-height', () => {
  /* inventory/v2 often omits lineHeightPx and only ships lineHeightPercent.
     CSS default ~1.2 then makes 8 authored lines taller than the Figma 448px
     box, and the 650px 正文 clip eats the last line. */
  assert.match(renderer, /lineHeightPercent/);
  assert.match(renderer, /Number\(tx\.fontSize\) \* Number\(tx\.lineHeightPercent\) \/ 100/);
  assert.match(renderer, /el\.style\.lineHeight = lineHeightPx \+ 'px'/);
});

test('ready dotted orderKey rebuilds the parent clip stack', () => {
  /* html-from-handoff unwraps provenance, so orderKey is "0.1.1.2" not a
     locator. Parsing only /children/N left the DFS parent stack empty:
     正文 clipsContent never wrapped the carnival copy, which then spilled
     out of the 650px panel. */
  assert.match(renderer, /_seqFromOrderKey/);
  assert.match(renderer, /Ready 包解包后 orderKey 常是/);
  assert.match(renderer, /fromOrderKey\.length/);
  assert.match(renderer, /ancestorParentRecord/);
  assert.match(renderer, /\/\^\\d\+\(\?:\\\.\\d\+\)\*\$\//);
});

test('hscroll track releases only a parent viewport renderBox clip', () => {
  assert.match(renderer, /data-hscroll-track-clip-released/);
  assert.match(renderer, /parent-viewport-renderbox-edge/);
  assert.match(renderer, /hscrollTrackOverflow/);
  assert.match(renderer, /n\.clipsContent === true && !hscrollTrackClipRelease/);
  assert.match(renderer, /hscrollHostEl/);
  assert.match(renderer, /groups inside that track, can inherit a/);
});

test('renderer never invents CSS chevrons for BOOLEAN btn arrows', () => {
  assert.doesNotMatch(renderer, /data-directional-chevron/);
  assert.doesNotMatch(renderer, /__rightChevron/);
  assert.match(renderer, /Inventing CSS\s+chevrons or diamonds is forbidden/);
});

test('BOOLEAN delivered composite does not get a CSS solid plate under the slice', () => {
  assert.match(renderer, /A delivered BOOLEAN\/VECTOR slice already bakes the SOLID fill/);
  assert.match(renderer, /const hostNeedsSolidPlate = imageFills\.length > 0/);
  assert.match(renderer, /if \(hostNeedsSolidPlate\)/);
});

test('only named scroll/ with overflowing child is an hscroll host using the clip box', () => {
  /* #63 拍板保留日历 mix 例外：PC 日历稿没有 scroll/，mix/calendar 是唯一
     允许平移越界子层的非 scroll 宿主。断言对齐该口径，不再要求日历被排除。 */
  assert.match(renderer, /Named scroll\/ is the explicit host/);
  assert.match(renderer, /Named scroll\/ is the explicit host\. Calendar mix is the one/);
  assert.match(renderer, /A random\s+clipsContent frame is not a host\./);
  assert.match(renderer, /if \(\(!namedScroll && !calendarMix\) \|\| !clipHost\) return null/);
  assert.doesNotMatch(renderer, /namedMix && clipHost/);
  assert.match(renderer, /childAttrs\['data-hscroll-overflow-child'\] = 'true'/);
});

test('hscroll host drag uses pointer capture and converts vertical wheel to scrollLeft', () => {
  assert.match(renderer, /closest\('\[data-hscroll\]\[data-hscroll-drag="true"\]'\)/);
  assert.match(renderer, /data-hscroll-surface/);
  assert.match(renderer, /data-hscroll-overflow-child="true"/);
  assert.match(renderer, /data-hscroll-rest-left/);
  assert.match(renderer, /data-hscroll-max/);
  assert.match(renderer, /data-hscroll-host-clip/);
  assert.match(renderer, /hostClip \+ next/);
  assert.match(renderer, /Rest state keeps clip none/);
  assert.match(renderer, /hscrollSurfacesOf/);
  assert.match(renderer, /hscrollSurfaceOf/);
  assert.match(renderer, /setHscrollOffset\(drag\.surface, drag\.left - delta, drag\.host\)/);
  assert.match(renderer, /setHscrollOffset\(surface, hscrollOffsetOf\(surface\) \+ delta, host\)/);
  assert.match(renderer, /el\.style\.touchAction = 'pan-x'/);
  assert.doesNotMatch(renderer, /el\.style\.touchAction = 'pan-y'/);
  assert.match(renderer, /Native overflow-x[\s\S]*calendar left labels/s);
});

test('hscroll cross-axis shadow gutter is derived from source effects and applied to host + track', () => {
  /* The gutter must be derived from the Figma DROP_SHADOW effect parameters
     (radius ± offset), never from the viewport-clipped renderBox, and it must
     be consumed twice: the host absorbs it as border-box padding while the
     absolutely-positioned track shifts its inset by the same amount so
     painted child coordinates do not move. */
  assert.match(renderer, /attrs\['data-hscroll-shadow-gutter'\]/);
  assert.match(renderer, /radius - offY/);
  assert.match(renderer, /radius \+ offY/);
  assert.match(renderer, /el\.style\.boxSizing = 'border-box'/);
  assert.match(renderer, /data-hscroll-shadow-gutter-applied/);
  assert.match(renderer, /data-hscroll-track-gutter/);
  assert.match(renderer, /hscrollHostEl\.getAttribute\('data-hscroll-shadow-gutter'\)/);
});
test('owner-model scope/assetPolicy/role evidence is derived in the renderer, not trusted from truth', () => {
  /* truth 叶子纪律：scope/assetPolicy/role 是派生值，不许进 truth；
     renderer 必须从 owner 原值（name 前缀 / 类型 / parentId）渲染期重推并落 DOM。 */
  assert.match(renderer, /data-owner-role/);
  assert.match(renderer, /data-owner-asset-policy/);
  assert.match(renderer, /data-owner-scope/);
  assert.match(renderer, /data-owner-is-mask/);
  assert.match(renderer, /data-owner-mask-type/);
  assert.match(renderer, /data-owner-mask-children/);
});

test('paint siblings are absolute unless source-backed Auto Layout admits flow', () => {
  assert.match(renderer, /el\.style\.position = 'absolute';\s*el\.style\.left = \(\(box\.x/);
  assert.match(renderer, /Only a proven Auto Layout child may flow/);
});

test('page background and fixed overlay roots stay on the owner tree, not leaf re-stitching', () => {
  /* 9:31452/52:3263 作为 page-level placement owner 必须经 pagePaintOrder 挂载，
     不能从各 section 几何相交的叶子重新拼背景。 */
  assert.match(renderer, /pagePaintOrder && rawPagePaintOrder/);
  assert.match(renderer, /directBackgroundRoot/);
  assert.match(renderer, /data-paint-root/);
});

test('page background is never also painted through pageChrome', () => {
  assert.match(renderer, /notBackgroundRoot/);
  assert.match(renderer, /chromeNodes\.filter\(notBackgroundRoot\)/);
  assert.match(renderer, /rawChromeNodes\.filter\(notBackgroundRoot\)/);
});

test('multi-image fills resolve each imageRef instead of reusing the first file', () => {
  assert.match(renderer, /_assetFileForImageRef\(imageRef, preferredRec = null\)/);
  assert.match(renderer, /never reuse that first\s+file for a later fill/);
  assert.match(renderer, /data-image-ref/);
  assert.match(renderer, /data-image-fill-index/);
  assert.match(renderer, /data-solid-base-fill/);
  assert.match(assetPipeline, /imageRefs: imageRefs\.length \? imageRefs : undefined/);
  assert.match(assetPipeline, /Array\.isArray\(m\.imageRefs\) && m\.imageRefs\.length \? \{ imageRefs: m\.imageRefs \}/);
});

test('owner-delivered composite wins over a shared imageRef lookup', () => {
  /* Packed qa-assets may keep only `{file,imageRefs}`. That thin record is still
     this owner's delivered slice; a global imageRef walk would pick a shorter
     sibling crop and stretch it into a taller card. */
  assert.match(renderer, /Packed qa-assets may/);
  assert.match(renderer, /const hasDeliveredComposite = !!\(assetRec && url\);/);
  assert.match(renderer, /_assetFileForImageRef\(entry\.fill && entry\.fill\.imageRef, assetRec\)/);
  assert.match(renderer, /if \(!preferredRefs\.length \|\| preferredRefs\.includes\(ref\)\) return String\(preferred\.file\);/);
});

test('authored multiline text keeps source metrics instead of height step-fit', () => {
  assert.match(renderer, /authored-multiline-source-metrics/);
  assert.match(renderer, /Prefer authored Figma line metadata over a geometry-derived estimate/);
  assert.match(renderer, /authoredLineCount \|\| 0, geometryLineCount/);
});

test('hero cover scale stays on the hero slot, not the released page stage', () => {
  assert.match(renderer, /heroVisualScale = slotScale/);
  assert.match(renderer, /scale: pageStageScale/);
  assert.match(renderer, /data-hero-visual-scale/);
  assert.match(renderer, /heroVisualScale \/ pageStageScale/);
  assert.doesNotMatch(renderer, /pageStageScale = slotScale/);
  assert.match(renderer, /data-kv-cover-plane/);
  assert.match(renderer, /data-hero-ui-plane/);
  assert.match(renderer, /stage\.style\.zoom = String\(pageStageMode \? pageStageScale : \(pageScope \? 1 : k\)\)/);
});

test('page paint roots follow recorded pagePaintOrder locators on canvas-rooted snapshots', () => {
  /* A canvas fetch stores locators under /nodes/<canvas>/document/children/...
     while the page frame id is a descendant. Matching the snapshot key as the
     page frame would leave KV/background/content unbucketed. */
  assert.match(renderer, /recordedRoots/);
  assert.match(renderer, /Match the nearest recorded/);
  assert.match(renderer, /pagePrefix/);
});

test('section stage clip is sourced from Figma clipsContent, not a global default', () => {
  assert.match(renderer, /const sectionClipsContent = __u\(meta\.clipsContent\) === true/);
  assert.match(renderer, /stage\.style\.overflow = sectionClipsContent \? 'hidden' : 'visible'/);
  assert.match(renderer, /data-section-source-clips-content/);
});

test('baked image render spill exports and verifies the render canvas, never the layout box', () => {
  assert.match(assetPipeline, /const isBakedImageOwner = pfx === 'img' && \(n\.type === 'INSTANCE' \|\| n\.type === 'COMPONENT'\)/);
  assert.match(assetPipeline, /const exportBounds = \(\(hasSoftSpillEffect \|\| isBakedImageOwner\) && spillBox\(b, rb\)\) \? 'render' : 'box'/);
  assert.match(assetPipeline, /renderCropPolicy: exportBounds === 'render' && isBakedImageOwner/);
  assert.match(coverageGate, /if \(rec\?\.exportBounds !== 'render'\) problems\.push/);
  assert.match(coverageGate, /exportBox!=renderBox/);
});

test('mask fields are emitted as truth leaves and consumed, not forged', () => {
  /* extract 无条件落 isMask/maskType 叶子（缺席=非遮罩，Figma REST 省略）；
     maskChildren 在 mask owner 上保留 id/maskType 原值引用；renderer 跳过遮罩本体。 */
  const geo = readFileSync(new URL('../lib/figma-geo.mjs', import.meta.url), 'utf8');
  assert.match(geo, /if \(node\.isMask !== undefined\) entry\.isMask = fig/);
  assert.match(geo, /if \(node\.maskType !== undefined\) entry\.maskType = fig/);
  assert.match(geo, /maskChildren/);
  assert.match(renderer, /n\.notPainted === true \|\| n\.isMask === true\) continue/);
  assert.match(renderer, /data-owner-mask-type/);
});

test('owner-tree consumption: page/fixed roots keep paint order, placement origin, clips, sticky overlay', () => {
  /* 切片4（lead：renderer 消费已有 owner 语义，不补 truth 字段）。
     真实 Chrome 证据（1920 视口）：9:31452/52:3263 的 CSS left/top/w/h 与 truth 相对
     page-frame 坐标逐像素一致；pagePaintOrder 逐根挂层不重拼；pb clipsContent=true→overflow:hidden；
     fx 在 sticky fixedStage 下 frame-scroll 时视口 top 恒定（pinned）。下列源码锁保证消费路径不回退。 */
  assert.match(renderer, /pagePaintOrder && rawPagePaintOrder && pagePaintOrder\.length === rawPagePaintOrder\.length/);
  assert.match(renderer, /for \(let pi = 0; pi < pagePaintOrder\.length; pi\+\+\)/);
  assert.match(renderer, /layer\.setAttribute\('data-paint-source-key', key\)/);
  /* placement origin：子节点坐标相对真实 owner（parentId 优先，ownerPath 回退，stack 最后） */
  assert.match(renderer, /const directParentId = nodeParentId\(n\)/);
  assert.match(renderer, /const coordinateOwnerBox = directParentRecord\?\.box \|\| directParentNode\?\.box \|\| parent\?\.box \|\| null/);
  /* fixed overlay：sticky + 内部 zoom（owner 自身 zoom=1，相对定位不被重复缩放） */
  assert.match(renderer, /fixedStage\.style\.position = 'sticky'/);
  assert.match(renderer, /fixedStage\.style\.zoom = String\(k\)/);
});

test('hscroll gutter expands host box and survives the generic box.h height overwrite', () => {
  /* 2026-08-08 修正：border-box+固定 height 会把 padding 从内容盒吃掉（124→104），overflow:hidden
     反而把出血投影裁得更狠。host 总盒必须扩到 视口+gutter，且下游通用 box.h 赋值必须把
     data-hscroll-gutter-h 加回，否则高度又被压回 124。 */
  assert.match(renderer, /curH \+ gT \+ gB/);
  assert.match(renderer, /data-hscroll-gutter-h/);
  assert.match(renderer, /\(box\.h \?\? 0\) \+ \(Number\(el\.getAttribute\('data-hscroll-gutter-h'\)\)/);
});

test('fx-img follows the owner box instead of intrinsic pixels', () => {
  /* 无 exportBox：100% + object-fit:fill。有 exportBox：按 export 边界定位。
     两个分支都先 absolute，owner 裁剪并作为定位锚。禁止空 else 走原图像素。 */
  assert.match(renderer, /img\.style\.position = 'absolute'/);
  const block = renderer.match(/if \(exportBox\) \{[\s\S]*?img\.style\.left[\s\S]*?img\.style\.height[\s\S]*?\} else \{[\s\S]*?img\.style\.top = '0'[\s\S]*?img\.style\.objectFit = 'fill'[\s\S]*?\}/);
  assert.ok(block, 'exportBox if/else block must set dimensions on both branches');
  assert.match(block[0], /exportBox\.w \?\? box\.w \?\? 0/);
  assert.match(block[0], /exportBox\.h \?\? box\.h \?\? 0/);
  assert.match(block[0], /img\.style\.width = '100%'/);
  assert.match(block[0], /img\.style\.objectFit = 'fill'/);
  assert.match(renderer, /el\.style\.overflow = 'hidden'/);
  assert.match(renderer, /el\.style\.position = 'relative'/);
});

test('auto-layout axis alignment fields flow from fixture into truth and feed the renderer flex model', () => {
  /* 2026-08-08 切片6：counterAxisAlignItems/primaryAxisAlignItems 是 Figma 真值（非派生），
     renderer 的 flex 模型已读它们定 justifyContent/alignItems，但此前不进 truth → 恒回退 flex-start。 */
  const geo = readFileSync(new URL('../lib/figma-geo.mjs', import.meta.url), 'utf8');
  assert.match(geo, /'counterAxisAlignItems', 'primaryAxisAlignItems'/);
  assert.match(renderer, /const counter = String\(__u\(parentLayout\.counterAxisAlignItems\)/);
  assert.match(renderer, /const prim = String\(__u\(parentLayout\.primaryAxisAlignItems\)/);
  assert.match(renderer, /pel\.style\.alignItems = ai\[counter\]/);
  assert.match(renderer, /pel\.style\.justifyContent = jc\[prim\]/);
});

test('multiline HUG explanatory text keeps source width instead of max-content', () => {
  assert.match(renderer, /const sourceMultilineText = authoredLineCount > 1[\s\S]*Number\(box\.h\) > Number\(tx\.lineHeight\) \* 1\.35/);
  assert.match(renderer, /const sourceWidthHugText = directOwnerHugFrame && !compactDirectOwnerHugLabel[\s\S]*\(arForOwner === 'HEIGHT' \|\| \(arForOwner === 'WIDTH_AND_HEIGHT' && sourceMultilineText\)\)/);
  assert.match(renderer, /const inlineHugs = hugs && !sourceWidthHugText/);
  assert.match(renderer, /el\.style\.whiteSpace = \(inlineHugs \|\| sourceNoWrapTitle\) \? 'pre' : 'pre-wrap'/);
  assert.match(renderer, /if \(sourceWidthHugText && box\.w != null\) \{[\s\S]*el\.style\.width = box\.w \+ 'px'[\s\S]*el\.setAttribute\('data-text-owner-width-policy', 'source-width-hug-text'\)/);
  assert.match(renderer, /if \(!sourceWidthHugText && ownerW > Number\(box\.w \?\? 0\) \+ 0\.5 && ar === 'WIDTH_AND_HEIGHT'\)/);
});

test('source-width HUG text grows vertically and is not step-fit suppressed', () => {
  assert.match(renderer, /if \(sourceWidthHugText && box\.w != null\) \{[\s\S]*el\.style\.height = 'auto'[\s\S]*el\.style\.overflow = 'visible'[\s\S]*data-text-vertical-growth', 'expected'/);
  assert.match(renderer, /layoutSizingVertical: sourceWidthHugText\s*\?\s*'HUG'\s*:\s*__u\(n\.layout && n\.layout\.layoutSizingVertical\)/);
  assert.match(renderer, /if \(box\.h != null\) el\.style\[inlineHugs \? 'height' : 'minHeight'\] = box\.h \+ 'px'/);
  assert.match(renderer, /else if \(!inlineHugs && !constraint\.openFlow\) \{[\s\S]*data-fit-growth', 'natural'/);
  assert.doesNotMatch(renderer, /if \(box\.h != null\) el\.style\[hugs \? 'height' : 'minHeight'\]/);
});

test('compact HUG label behavior remains geometry-authorized only', () => {
  assert.match(renderer, /const compactHugLabelEvidence = \(\{ role, align, autoResize, ownerNode, ownerBox, directOwner, sourceBox \}\) =>/);
  assert.match(renderer, /verticalSlack <= sourceH \* 0\.6 \+ 0\.5/);
  assert.match(renderer, /sourceW >= ownerW \* 0\.55/);
  assert.match(renderer, /const boundedHugLabel = inlineHugs && !constraint\.openFlow && _centered && _fillsOwner/);
  assert.match(renderer, /if \(boundedHugLabel\) \{[\s\S]*data-fit-policy', 'bounded-hug-label'[\s\S]*fitCandidates\.push\(\{ el, tx, box, widthFit: _ownerW/);
});
