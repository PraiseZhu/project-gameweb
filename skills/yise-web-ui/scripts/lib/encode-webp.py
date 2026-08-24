#!/usr/bin/env python3
"""PNG → WebP encoder used by figma-assets.

Keeps pixel size 1:1. Alpha images use lossless WebP; opaque images use
lossy quality 90. Input is a JSON jobs file; output is JSON on stdout.
Never overwrites the source PNG.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image


def encode_one(src: Path, dest: Path, lossless: bool, quality: int) -> dict:
    with Image.open(src) as im:
        im.load()
        has_alpha = "A" in im.getbands() or im.mode in ("RGBA", "LA", "PA")
        mode = "RGBA" if has_alpha else "RGB"
        if im.mode != mode:
            im = im.convert(mode)
        dest.parent.mkdir(parents=True, exist_ok=True)
        use_lossless = bool(lossless or has_alpha)
        im.save(
            dest,
            "WEBP",
            quality=quality,
            method=6,
            lossless=use_lossless,
        )
        return {
            "src": str(src),
            "dest": str(dest),
            "bytes": dest.stat().st_size,
            "width": im.size[0],
            "height": im.size[1],
            "alpha": has_alpha,
            "lossless": use_lossless,
        }


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: encode-webp.py <jobs.json>"}), file=sys.stderr)
        return 2
    jobs = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    quality = int(jobs.get("quality") or 90)
    results = []
    errors = []
    for job in jobs.get("jobs") or []:
        src = Path(job["src"])
        dest = Path(job["dest"])
        try:
            results.append(encode_one(src, dest, bool(job.get("lossless")), quality))
        except Exception as exc:  # noqa: BLE001 — report per-file, keep the batch going
            errors.append({"src": str(src), "dest": str(dest), "error": str(exc)})
    print(json.dumps({"ok": not errors, "results": results, "errors": errors}, ensure_ascii=False))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
