#!/usr/bin/env python3
"""Rebuild public/brian-logo.png with a transparent background from a flat RGB/RGBA source.

Reads the first argument (or ../public/brian-logo-source.png) and writes ../public/brian-logo.png.
"""
from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "brian-logo.png"
DEFAULT_SRC = ROOT / "public" / "brian-logo-source.png"


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
    if not src.is_file():
        print(f"Missing source image: {src}", file=sys.stderr)
        sys.exit(1)

    arr = np.array(Image.open(src).convert("RGBA"))
    h, w = arr.shape[0], arr.shape[1]
    rgb = arr[:, :, :3].astype(np.int16)

    thr = 236

    def is_conn_white(r: int, g: int, b: int) -> bool:
        return r >= thr and g >= thr and b >= thr

    visited = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not visited[y, x] and is_conn_white(*rgb[y, x]):
                visited[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if not visited[y, x] and is_conn_white(*rgb[y, x]):
                visited[y, x] = True
                q.append((y, x))

    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and is_conn_white(*rgb[ny, nx]):
                visited[ny, nx] = True
                q.append((ny, nx))

    out = arr.copy().astype(np.uint8)
    out[:, :, 3] = np.where(visited, 0, 255)

    r = out[:, :, 0].astype(np.float32)
    g = out[:, :, 1].astype(np.float32)
    b = out[:, :, 2].astype(np.float32)
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    with np.errstate(invalid="ignore", divide="ignore"):
        sat = np.where(mx < 1e-3, 0.0, (mx - mn) / np.maximum(mx, 1e-3))
    lum = (mx + mn) / (2.0 * 255.0)
    neutral_paper = (sat < 0.12) & (lum > 0.84)
    out[:, :, 3] = np.where(neutral_paper, 0, out[:, :, 3])

    a = out[:, :, 3].astype(np.float32)
    mr = np.minimum(np.minimum(out[:, :, 0], out[:, :, 1]), out[:, :, 2]).astype(np.float32)
    edge = np.clip((mr - 210) / 28.0, 0.0, 1.0)
    a = a * (1.0 - 0.85 * (1.0 - edge) * (mr > 218).astype(np.float32))
    out[:, :, 3] = np.clip(a, 0, 255).astype(np.uint8)

    Image.fromarray(out).save(OUT, format="PNG", optimize=True)
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
