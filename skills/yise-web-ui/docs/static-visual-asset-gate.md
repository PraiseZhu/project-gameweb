# Static visual-asset gate

Static structure, node provenance, and text coverage prove that a page can be
structured. They do **not** prove that the page's visual material is present.
The static visual-asset gate is a separate hard gate before static completion,
`confirmed-final`, or final user preview.

## Required chain

For every visible Figma `IMAGE` fill on every declared platform:

```text
source node ID → Figma imageRef → assets-manifest entry → rendered DOM asset
```

The manifest record requires a file and hash and must preserve `imageRefs`. DOM
evidence must show the matching node's asset rendered, complete, and visible.

A child fill may be covered by a baked owner only when the child record names
`bakedIntoOwner`, includes an explanation, and the owner manifest record
contains the same `imageRef`, file, and hash. Names, old seasonal files, or an
asset from another platform are never evidence.

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
