"""Four icon concepts, drawn to survive 16px.

The current mark fails below ~48px (see icon-audit.png). Three causes, and every
concept here answers all three:

  1. The art sat inside a badge, so at 16px the drawing was ~11px. These BLEED
     to the edge - the badge IS the artwork.
  2. A dark red dome inside a red badge: the biggest shape had no contrast with
     its own ground. These put the lightest value against the darkest.
  3. Eight competing elements. At 16px an icon gets ONE silhouette, so each of
     these has exactly one, with at most two supporting marks.

Everything is drawn from the app's own flat palette and the one-ink-outline
rule, so the mark and the interior finally agree.

Usage: python shots-now/icon-concepts.py
"""
from PIL import Image, ImageDraw
import os

# The house palette (src/art/flat.ts + tokens.css).
INK = (79, 49, 32)
CREAM = (247, 240, 224)
PAPER = (238, 228, 206)
OXBLOOD = (124, 42, 44)
PLUM = (92, 48, 66)
TIMBER = (192, 138, 82)
TIMBER_DK = (150, 100, 56)
MOSS = (106, 122, 84)
GILT = (214, 168, 82)
SKY = (122, 146, 158)

S = 1024  # master size; every concept is drawn at this and downsampled


def rr(d, box, r, fill, outline=None, w=0):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=w)


def concept_a() -> Image.Image:
    """THE ARCH. One shape: a lit alcove cut out of a solid ground.

    The whole tile is the bookcase; the arch is a hole with light in it. At
    16px this is a dark square with a pale arch - which is still, recognisably,
    an alcove.
    """
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    rr(d, (0, 0, S - 1, S - 1), S * 0.22, OXBLOOD)
    # The recess: a tall arch, generous, bleeding most of the tile's width.
    m = S * 0.17
    top = S * 0.15
    bot = S * 0.80
    d.rounded_rectangle((m, top + S * 0.18, S - m, bot), radius=S * 0.03, fill=CREAM)
    d.ellipse((m, top, S - m, top + S * 0.36), fill=CREAM)
    # Three books, the only interior marks. Wide enough to hold at 16px.
    bw = (S - 2 * m - S * 0.10) / 3
    for i, (c, hh) in enumerate([(PLUM, 0.30), (TIMBER, 0.36), (MOSS, 0.26)]):
        x = m + S * 0.05 + i * bw
        d.rounded_rectangle(
            (x, bot - S * hh, x + bw * 0.74, bot - S * 0.055),
            radius=S * 0.012,
            fill=c,
        )
    # The plinth the books stand on - one dark bar, reads at every size.
    d.rounded_rectangle((m, bot - S * 0.055, S - m, bot), radius=S * 0.012, fill=INK)
    return im


def concept_b() -> Image.Image:
    """THE OPEN BOOK. The simplest true thing the app is about.

    Two pale leaves and a dark gutter on a warm ground. The silhouette is a
    wide, low wedge - completely unlike anything else on a taskbar.
    """
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    rr(d, (0, 0, S - 1, S - 1), S * 0.22, PLUM)
    cx, cy = S / 2, S * 0.56
    wing = S * 0.36
    lift = S * 0.13
    # Left and right leaves as filled polygons, drawn big and simple.
    d.polygon(
        [(cx - 8, cy - S * 0.20), (cx - wing, cy - S * 0.20 + lift),
         (cx - wing, cy + S * 0.20), (cx - 8, cy + S * 0.16)],
        fill=CREAM,
    )
    d.polygon(
        [(cx + 8, cy - S * 0.20), (cx + wing, cy - S * 0.20 + lift),
         (cx + wing, cy + S * 0.20), (cx + 8, cy + S * 0.16)],
        fill=PAPER,
    )
    # The gutter: one dark stroke, the thing that makes it read as a BOOK.
    d.rounded_rectangle(
        (cx - S * 0.018, cy - S * 0.21, cx + S * 0.018, cy + S * 0.17),
        radius=S * 0.014,
        fill=INK,
    )
    # A ribbon, the one flourish, and it doubles as a colour accent.
    d.rounded_rectangle(
        (cx + S * 0.10, cy + S * 0.02, cx + S * 0.145, cy + S * 0.30),
        radius=S * 0.012,
        fill=GILT,
    )
    return im


def concept_c() -> Image.Image:
    """THE SPINE. One book, seen edge-on, the way the shelf shows them.

    A tall bar with two gilt bands and a label. This is the strongest 16px
    silhouette of the four because it is a single vertical - nothing else in a
    taskbar looks like it.
    """
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    rr(d, (0, 0, S - 1, S - 1), S * 0.22, PAPER)
    x0, x1 = S * 0.30, S * 0.70
    y0, y1 = S * 0.10, S * 0.90
    d.rounded_rectangle((x0, y0, x1, y1), radius=S * 0.05, fill=OXBLOOD)
    # Two bands and a label plate: the three marks a spine actually has.
    for yy in (0.30, 0.70):
        d.rectangle((x0, y0 + (y1 - y0) * yy, x1, y0 + (y1 - y0) * yy + S * 0.035), fill=GILT)
    d.rounded_rectangle(
        (x0 + S * 0.045, S * 0.40, x1 - S * 0.045, S * 0.58),
        radius=S * 0.02,
        fill=CREAM,
    )
    return im


def concept_d() -> Image.Image:
    """THE ALCOVE AS A LETTER. An 'A' whose crossbar is a shelf of books.

    A wordmark that is also the thing. Risky at 16px - tested here rather than
    assumed - but it is the only one that says the app's NAME.
    """
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    rr(d, (0, 0, S - 1, S - 1), S * 0.22, OXBLOOD)
    apex = (S * 0.5, S * 0.16)
    lft = (S * 0.20, S * 0.86)
    rgt = (S * 0.80, S * 0.86)
    d.polygon([apex, lft, (S * 0.32, S * 0.86), (S * 0.5, S * 0.34)], fill=CREAM)
    d.polygon([apex, rgt, (S * 0.68, S * 0.86), (S * 0.5, S * 0.34)], fill=CREAM)
    # The crossbar is a shelf with two books on it.
    d.rounded_rectangle((S * 0.28, S * 0.60, S * 0.72, S * 0.665), radius=S * 0.014, fill=CREAM)
    d.rounded_rectangle((S * 0.365, S * 0.475, S * 0.435, S * 0.60), radius=S * 0.012, fill=TIMBER)
    d.rounded_rectangle((S * 0.455, S * 0.445, S * 0.525, S * 0.60), radius=S * 0.012, fill=MOSS)
    return im


CONCEPTS = [
    ("A - the arch", concept_a),
    ("B - open book", concept_b),
    ("C - the spine", concept_c),
    ("D - A is an alcove", concept_d),
]

SIZES = [16, 24, 32, 48, 64, 128]
ZOOM = 5
os.makedirs("shots-now/out", exist_ok=True)

cell = 160
pad = 18
head = 30
rows = len(CONCEPTS)
board_w = pad + cell + pad + len(SIZES) * (cell + pad) + pad
board_h = head + rows * (cell + pad + 18) + pad

board = Image.new("RGB", (board_w, board_h), (34, 30, 28))
bd = ImageDraw.Draw(board)
bd.text((pad, 9), "ICON CONCEPTS - master, then TRUE SIZE, then the same pixels magnified", fill=(232, 222, 208))

for r, (name, fn) in enumerate(CONCEPTS):
    master = fn()
    y = head + r * (cell + pad + 18)
    big = master.resize((cell, cell), Image.LANCZOS)
    tile = Image.new("RGB", (cell, cell), (244, 238, 224))
    tile.paste(big.convert("RGB"), (0, 0), big)
    board.paste(tile, (pad, y))
    bd.text((pad, y + cell + 3), name, fill=(232, 222, 208))
    master.save(f"shots-now/out/icon-concept-{name[0].lower()}.png")

    for i, s in enumerate(SIZES):
        x = pad + cell + pad + i * (cell + pad)
        small = master.resize((s, s), Image.LANCZOS)
        t = Image.new("RGB", (cell, cell), (28, 26, 25))
        # true size, top-left on cream
        t.paste((244, 238, 224), (0, 0, cell, cell // 2))
        t.paste(small.convert("RGB"), ((cell - s) // 2, (cell // 2 - s) // 2), small)
        # magnified, bottom
        z = small.resize((s * ZOOM, s * ZOOM), Image.NEAREST)
        zc = z.crop((0, 0, min(cell, z.width), min(cell // 2, z.height)))
        t.paste(zc.convert("RGB"), ((cell - zc.width) // 2, cell // 2 + 4), zc)
        board.paste(t, (x, y))
        bd.text((x, y + cell + 3), f"{s}px", fill=(190, 180, 168))

board.save("shots-now/out/icon-concepts.png")
print("wrote shots-now/out/icon-concepts.png", board.size)
