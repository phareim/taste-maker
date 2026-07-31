#!/usr/bin/env python3
"""Generate the TasteCapture app icon.

Matches the house style shared by `do`, `write` and `sleeper-chat`: warm
speckled paper, a single large ET Book capital in charcoal, and a rust
hairline rule with round terminals plus a shorter, thinner rule below — the
same Tufte hairline motif the web app uses in components/tufte/HairlineRule.vue.

Every colour and coordinate below was measured off the existing icons rather
than eyeballed, so this sits in the same family rather than merely near it.
`do` is D, `write` is W, taste-maker is T.

Deterministic: the speckle field uses a fixed seed, so regenerating produces a
byte-identical file and never shows up as a spurious diff.

    python3 ios/scripts/make-icon.py

Needs Pillow and fontTools:  pip3 install Pillow fonttools
"""

import io
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont

REPO = Path(__file__).resolve().parents[2]
FONT_WOFF = REPO / "public/tufte/fonts/et-book-roman.woff"
OUT = REPO / "ios/TasteCapture/Assets.xcassets/AppIcon.appiconset/icon.png"

SIZE = 1024
LETTER = "T"

# Sampled from sleeper-chat's icon.png.
PAPER = (247, 243, 241)
INK = (48, 40, 34)
RUST = (193, 74, 42)

# Normalized against a 1024px canvas, measured off write.png / do.png.
CAP_HEIGHT = 300          # glyph cap-height in px; T carries less ink than
                          # D or W, so it needs a touch more to match weight
BASELINE = 655            # glyph baseline y
RULE_Y = 693.5            # main rule centre y
RULE_HALF_W = 161         # main rule half-width
RULE_THICK = 8
DOT_R = 7
RULE2_Y = 732             # second, quieter rule
RULE2_HALF_W = 83
RULE2_THICK = 3

SUPERSAMPLE = 4           # draw big, downsample — gives clean antialiased curves


def load_font(px: int) -> ImageFont.FreeTypeFont:
    """ET Book ships as WOFF; FreeType needs a bare SFNT, so strip the wrapper."""
    if not FONT_WOFF.exists():
        sys.exit(f"missing font: {FONT_WOFF}")
    tt = TTFont(str(FONT_WOFF))
    tt.flavor = None
    buf = io.BytesIO()
    tt.save(buf)
    buf.seek(0)
    return ImageFont.truetype(buf, px)


def fit_font_to_cap_height(target_px: int) -> tuple[ImageFont.FreeTypeFont, tuple]:
    """Pick the point size whose rendered LETTER is exactly target_px tall.

    Measuring the real ink bbox beats trusting font metrics — ET Book's
    reported ascent includes space this glyph doesn't use.
    """
    size = target_px * 2
    for _ in range(24):
        font = load_font(int(size))
        bbox = font.getbbox(LETTER)
        height = bbox[3] - bbox[1]
        if height == 0:
            size *= 1.5
            continue
        if abs(height - target_px) <= 1:
            return font, bbox
        size *= target_px / height
    return load_font(int(size)), load_font(int(size)).getbbox(LETTER)


def draw_speckles(draw: ImageDraw.ImageDraw, s: int) -> None:
    """The warm fleck field that makes the paper read as paper."""
    rng = random.Random(20260731)
    for _ in range(210):
        x = rng.uniform(0, SIZE) * s
        y = rng.uniform(0, SIZE) * s
        r = rng.uniform(0.6, 2.2) * s
        # Warm browns, biased light so the field stays quiet.
        shade = rng.randint(20, 115)
        colour = (110 + shade, 92 + shade, 68 + shade)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=colour)


def rule(draw: ImageDraw.ImageDraw, s: int, cy: float, half_w: float,
         thick: float, dots: bool) -> None:
    cx = SIZE / 2
    x0, x1 = (cx - half_w) * s, (cx + half_w) * s
    y = cy * s
    h = thick * s / 2
    draw.rectangle([x0, y - h, x1, y + h], fill=RUST)
    if dots:
        r = DOT_R * s
        for x in (x0, x1):
            draw.ellipse([x - r, y - r, x + r, y + r], fill=RUST)


def main() -> None:
    s = SUPERSAMPLE
    img = Image.new("RGB", (SIZE * s, SIZE * s), PAPER)
    draw = ImageDraw.Draw(img)

    draw_speckles(draw, s)
    rule(draw, s, RULE_Y, RULE_HALF_W, RULE_THICK, dots=True)
    rule(draw, s, RULE2_Y, RULE2_HALF_W, RULE2_THICK, dots=False)

    font, bbox = fit_font_to_cap_height(CAP_HEIGHT * s)
    glyph_w = bbox[2] - bbox[0]
    glyph_h = bbox[3] - bbox[1]
    # getbbox offsets are relative to the drawing origin, so subtract them to
    # land the ink exactly where we want it.
    x = (SIZE * s - glyph_w) / 2 - bbox[0]
    y = BASELINE * s - glyph_h - bbox[1]
    draw.text((x, y), LETTER, font=font, fill=INK)

    # iOS masks the corners itself: the asset must be a full-bleed opaque
    # square. Rounding it here would show up as a dark fringe on device.
    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, "PNG")
    print(f"wrote {OUT.relative_to(REPO)} ({SIZE}x{SIZE})")


if __name__ == "__main__":
    main()
