#!/usr/bin/env python3
"""
Blur identifying details out of a panel screenshot.

Why this exists, and why it only blurs:

The screenshots on the site and in the Store listing are real captures of the
panel running on a real token. That is the point of them — earlier versions
were mock-ups, and a mock-up cannot honestly sit under a caption claiming the
panel answers in three seconds.

So nothing here rewrites a value. Every percentage, score, wallet count and
timing in the output is exactly what the panel printed. What it does remove is
identity: the token's ticker, and the truncated holder addresses. Those are
public on-chain data, but a real ticker beside a "HIGH 84" dial on a marketing
page is a public accusation about somebody's project, and the addresses belong
to people who did not volunteer to illustrate our landing page.

A blur is visible. A reader can see that something was covered, which is the
difference between redacting an image and doctoring one.

Usage:
    python3 scripts/redact.py shot.png out.png --box 120,30,260,52 --box ...

Boxes are left,top,right,bottom in pixels of the input image. Run once with
--grid to get a numbered overlay to read the coordinates off.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


def parse_box(raw: str) -> tuple[int, int, int, int]:
    parts = raw.split(",")
    if len(parts) != 4:
        raise argparse.ArgumentTypeError(f"box needs left,top,right,bottom — got {raw!r}")
    left, top, right, bottom = (int(p) for p in parts)
    if right <= left or bottom <= top:
        raise argparse.ArgumentTypeError(f"box {raw!r} has no area")
    return left, top, right, bottom


def redact_region(image: Image.Image, box: tuple[int, int, int, int], block: int, mode: str) -> None:
    """
    Cover a region in place, unrecoverably, while still looking covered.

    Pixelation by default. A Gaussian blur strong enough to destroy small text
    flattens a large block into one dead colour, which reads as an empty panel
    rather than as something that was removed — the viewer cannot tell whether
    anything was ever there. A mosaic keeps the colours and the rough shapes,
    so a redacted leaderboard still looks like a leaderboard, and nobody has to
    wonder what was hidden.

    The block size is fixed rather than derived from the region, so a tall
    block is covered at the same coarseness as a single line of text.
    """
    region = image.crop(box)
    if region.width < 2 or region.height < 2:
        return

    if mode == "blur":
        image.paste(region.filter(ImageFilter.GaussianBlur(block)), box)
        return

    small = (max(1, region.width // block), max(1, region.height // block))
    mosaic = region.resize(small, Image.BILINEAR).resize(region.size, Image.NEAREST)
    image.paste(mosaic, box)


def draw_grid(image: Image.Image, step: int) -> Image.Image:
    """A coordinate overlay, so the boxes can be read off the image itself."""
    marked = image.convert("RGB").copy()
    draw = ImageDraw.Draw(marked)
    for x in range(0, marked.width, step):
        draw.line([(x, 0), (x, marked.height)], fill=(255, 0, 128), width=1)
        draw.text((x + 2, 2), str(x), fill=(255, 0, 128))
    for y in range(0, marked.height, step):
        draw.line([(0, y), (marked.width, y)], fill=(0, 200, 255), width=1)
        draw.text((2, y + 2), str(y), fill=(0, 200, 255))
    return marked


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path, nargs="?")
    parser.add_argument("--box", type=parse_box, action="append", default=[],
                        help="region to blur: left,top,right,bottom. Repeatable.")
    parser.add_argument("--block", type=int, default=9,
                        help="mosaic block size in pixels, or blur radius with --mode blur (default 9)")
    parser.add_argument("--mode", choices=("pixelate", "blur"), default="pixelate",
                        help="pixelate (default) keeps colour and shape; blur flattens")
    parser.add_argument("--grid", type=int, nargs="?", const=100,
                        help="write a coordinate overlay instead of blurring")
    args = parser.parse_args()

    image = Image.open(args.source)

    if args.grid:
        target = args.target or args.source.with_name(f"{args.source.stem}-grid.png")
        draw_grid(image, args.grid).save(target)
        print(f"grid every {args.grid}px -> {target}  ({image.width}x{image.height})")
        return 0

    if not args.box:
        parser.error("nothing to do: pass --box, or --grid to find the coordinates")
    if not args.target:
        parser.error("an output path is required")

    image = image.convert("RGB")
    for box in args.box:
        redact_region(image, box, args.block, args.mode)

    image.save(args.target)
    print(f"{args.mode}d {len(args.box)} region(s) -> {args.target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
