# Static visual-asset gate

Static structure, node provenance, and text coverage prove that a page can be
structured. They do **not** prove that the page's visual material is present.
The static visual-asset gate is a separate hard gate before static completion,
`confirmed-final`, or final user preview.

## Required chain

For every visible Figma `IMAGE` fill **and every non-skipped declared
`sliceExport` owner** on every declared platform:

```text
source node ID → Figma imageRef or sliceExport.file → assets-manifest entry → rendered DOM asset
```

A declared slice owner is a source-backed visual contract even when the owner
has no IMAGE fill of its own (composite `bg/`, `img/` frames, BOOLEAN `btn/`
arrows, page-used `ind/` variant roots, navigation rails, card borders). Nested
slice descendants are covered by the outermost source owner; they must not
require a second DOM host.

The Main static axis audits the current page tree only. Modal and
component-variant trees stay in truth for Interaction/Switch, but they are not
simultaneously visible page pixels and must not block Main. Unknown source
leaves stay `unknownUnresolved`: draw-only, never wired, never counted as
static completion.

The manifest record requires a file and hash. IMAGE fills must preserve
`imageRefs`. Slice owners must preserve the declared `sliceExport.file`. DOM
evidence must show the matching node's asset rendered, complete, and visible.

A child fill may be covered by a baked owner only when the child record names
`bakedIntoOwner`, includes an explanation, and the owner manifest record
contains the same `imageRef`, file, and hash. Names, old seasonal files, or an
asset from another platform are never evidence.

Interactive non-rect owners (`BOOLEAN_OPERATION`, `VECTOR`, and similar) with
`behavior=click` and no slice / no source geometry remain a red gate
(`interactive-nonrect-source-geometry-missing`). Do not invent CSS chevrons,
diamonds, or screenshots to pass that gate.

## Provenance wrappers

Truth consumers must recursively unwrap `{ value, provenance }` **at the
current object before inspecting it**. This includes truth root, platform tree,
node, style, and fill. Traversing wrapper keys first can hide hundreds of IMAGE
nodes and falsely make asset picking look complete.

## Resumable export

Large source sets use `yise-asset-export-plan/v1`:

- fixed bounded batches;
- node ID and `imageRef` retained in every requirement;
- `completedNodeIds` and `pendingBatches` make restart state explicit;
- an incomplete plan is `partial:true`.

The network exporter may implement retries or resume independently. It must
write `assets-manifest.json.exportRun` with required/completed source nodes.
Any `partial`, `failed`, `noUrl`, or incomplete required/completed set is a
visual-asset failure, not a warning.

## Platform rule

PC and mobile (and every other declared source platform) receive independent:

1. source-scope collection;
2. visible IMAGE-fill requirement inventory;
3. manifest/imageRef coverage;
4. rendered-DOM coverage.

Success on one platform never permits omission on another.

## Final preview

`final-preview` requires both accepted complete static metadata and a successful
`yise-static-visual-asset-audit/v1` result:

```json
{ "visualAssetsComplete": true, "complete": true }
```

Without it, final preview blocks with `static-visual-assets-incomplete`.
