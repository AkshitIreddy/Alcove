"""Cute red book — six drafts.

The reader, on the first four concepts: "i dont like them, but i like red, maybe
you can make a cute red book".

So: one red book, charming, and it has to survive 16px. What makes a drawn
object read as CUTE rather than merely small is proportion and softness — a
chubby body, big corner radii, edges that bow instead of ruling straight (the
app's own flat language already says edges bow), and one warm accent. What
makes it survive 16px is the opposite discipline: few marks, fat marks, and the
lightest value laid directly on the darkest.

Every draft is the same red family from the app's palette so they can be judged
on FORM, which is the thing actually in question.

Usage: python shots-now/icon-redbook.py
"""
from PIL import Image, ImageDraw
import math
import os

INK = (79, 49, 32)
CREAM = (247, 240, 224)
PAPER = (236, 226, 203)
RED = (166, 58, 56)
RED_DK = (124, 42, 44)
RED_LT = (196, 84, 76)
GILT = (222, 178, 92)
MOSS = (106, 122, 84)
SKY = (122, 146, 158)

S = 1024
SS = 4  # supersample: draw big, shrink — keeps the bowed edges smooth


def bowed(d, x0, y0, x1, y1, bow, fill, r=0.0):
    """A rounded rect whose four edges bow outward slightly.

    This is the single move that separates 'drawn' from 'geometric'. `bow` is a
    fraction of the shorter side; 0.02–0.05 reads as a hand, more reads as a
    balloon.
    """
    w, h = x1 - x0, y1 - y0
    b = min(w, h) * bow
    rr = min(w, h) * r
    pts = []
    N = 22

    def edge(ax, ay, bx, by, ox, oy):
        for i in range(N + 1):
            t = i / N
            # quadratic bulge, zero at both ends
            k = 4 * t * (1 - t)
            pts.append((ax + (bx - ax) * t + ox * b * k, ay + (by - ay) * t + oy * b * k))

    edge(x0 + rr, y0, x1 - rr, y0, 0, -1)
    edge(x1 - rr, y0, x1, y0 + rr, 0.4, -0.4)
    edge(x1, y0 + rr, x1, y1 - rr, 1, 0)
    edge(x1, y1 - rr, x1 - rr, y1, 0.4, 0.4)
    edge(x1 - rr, y1, x0 + rr, y1, 0, 1)
    edge(x0 + rr, y1, x0, y1 - rr, -0.4, 0.4)
    edge(x0, y1 - rr, x0, y0 + rr, -1, 0)
    edge(x0, y0 + rr, x0 + rr, y0, -0.4, -0.4)
    d.polygon(pts, fill=fill)


def canvas():
    im = Image.new("RGBA", (S * SS, S * SS), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im), S * SS


def finish(im):
    return im.resize((S, S), Image.LANCZOS)


def draft_1():
    """CHUBBY, STANDING, RIBBON. A fat little book facing you, ribbon out the foot."""
    im, d, N = canvas()
    bowed(d, 0, 0, N, N, 0.0, CREAM, r=0.22)
    x0, x1 = N * 0.20, N * 0.80
    y0, y1 = N * 0.13, N * 0.87
    # the fore-edge: a pale sliver down the right, which is what says "book"
    bowed(d, x1 - N * 0.10, y0 + N * 0.02, x1, y1 - N * 0.02, 0.03, PAPER, r=0.14)
    bowed(d, x0, y0, x1 - N * 0.07, y1, 0.035, RED, r=0.16)
    # two gilt bands, fat enough to hold at 16px
    for yy in (0.30, 0.70):
        bowed(d, x0 + N * 0.03, y0 + (y1 - y0) * yy, x1 - N * 0.10, y0 + (y1 - y0) * yy + N * 0.045, 0.04, GILT, r=0.5)
    # label plate
    bowed(d, x0 + N * 0.075, N * 0.415, x1 - N * 0.145, N * 0.585, 0.05, CREAM, r=0.22)
    # ribbon out of the foot
    bowed(d, N * 0.44, y1 - N * 0.02, N * 0.52, y1 + N * 0.09, 0.05, GILT, r=0.3)
    return finish(im)


def draft_2():
    """TILTED, WITH A STAR. Leaning like a book propped on a shelf."""
    im, d, N = canvas()
    bowed(d, 0, 0, N, N, 0.0, CREAM, r=0.22)
    layer = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    x0, x1 = N * 0.26, N * 0.74
    y0, y1 = N * 0.14, N * 0.86
    bowed(ld, x1 - N * 0.09, y0 + N * 0.02, x1, y1 - N * 0.02, 0.03, PAPER, r=0.14)
    bowed(ld, x0, y0, x1 - N * 0.06, y1, 0.04, RED, r=0.17)
    # one gilt star on the cover — the whole charm of it
    cx, cy, rad = N * 0.47, N * 0.50, N * 0.115
    pts = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        rr = rad if i % 2 == 0 else rad * 0.44
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    ld.polygon(pts, fill=GILT)
    bowed(ld, x0 + N * 0.02, y1 - N * 0.14, x1 - N * 0.06, y1 - N * 0.09, 0.05, GILT, r=0.5)
    layer = layer.rotate(-9, resample=Image.BICUBIC, center=(N // 2, N // 2))
    im.alpha_composite(layer)
    return finish(im)


def draft_3():
    """A LITTLE STACK. Three books, the middle one red and biggest."""
    im, d, N = canvas()
    bowed(d, 0, 0, N, N, 0.0, CREAM, r=0.22)
    bowed(d, N * 0.16, N * 0.66, N * 0.84, N * 0.80, 0.03, MOSS, r=0.30)
    bowed(d, N * 0.13, N * 0.44, N * 0.87, N * 0.645, 0.03, RED, r=0.24)
    bowed(d, N * 0.20, N * 0.26, N * 0.80, N * 0.425, 0.03, SKY, r=0.28)
    # gilt rule on the red one only, so the eye lands there
    bowed(d, N * 0.17, N * 0.545, N * 0.83, N * 0.585, 0.04, GILT, r=0.5)
    # a ribbon slipping out of the stack
    bowed(d, N * 0.62, N * 0.60, N * 0.685, N * 0.90, 0.05, GILT, r=0.3)
    return finish(im)


def draft_4():
    """FACE. A book with two dots for eyes — the literal reading of 'cute'."""
    im, d, N = canvas()
    bowed(d, 0, 0, N, N, 0.0, CREAM, r=0.22)
    x0, x1 = N * 0.17, N * 0.83
    y0, y1 = N * 0.20, N * 0.82
    bowed(d, x1 - N * 0.09, y0 + N * 0.02, x1, y1 - N * 0.02, 0.03, PAPER, r=0.16)
    bowed(d, x0, y0, x1 - N * 0.06, y1, 0.045, RED, r=0.22)
    ey = N * 0.46
    for ex in (N * 0.35, N * 0.57):
        d.ellipse((ex - N * 0.045, ey - N * 0.055, ex + N * 0.045, ey + N * 0.055), fill=CREAM)
        d.ellipse((ex - N * 0.022, ey - N * 0.020, ex + N * 0.022, ey + N * 0.030), fill=INK)
    # a small smile, drawn as an arc with real weight
    d.arc((N * 0.40, N * 0.55, N * 0.55, N * 0.66), start=15, end=165, fill=CREAM, width=int(N * 0.022))
    bowed(d, N * 0.44, y1 - N * 0.02, N * 0.52, y1 + N * 0.10, 0.05, GILT, r=0.3)
    return finish(im)


def draft_5():
    """OPEN, CHUBBY, HELD. Wide and low, two fat leaves in a red case."""
    im, d, N = canvas()
    bowed(d, 0, 0, N, N, 0.0, CREAM, r=0.22)
    bowed(d, N * 0.10, N * 0.30, N * 0.90, N * 0.78, 0.05, RED, r=0.16)
    bowed(d, N * 0.145, N * 0.335, N * 0.495, N * 0.735, 0.06, PAPER, r=0.14)
    bowed(d, N * 0.505, N * 0.335, N * 0.855, N * 0.735, 0.06, CREAM, r=0.14)
    bowed(d, N * 0.478, N * 0.315, N * 0.522, N * 0.755, 0.03, RED_DK, r=0.4)
    bowed(d, N * 0.60, N * 0.60, N * 0.665, N * 0.90, 0.05, GILT, r=0.3)
    return finish(im)


def draft_6():
    """THE POCKET BOOK. Fat, short, deep-red, one cream band across the middle."""
    im, d, N = canvas()
    bowed(d, 0, 0, N, N, 0.0, RED_DK, r=0.22)
    x0, x1 = N * 0.18, N * 0.82
    y0, y1 = N * 0.19, N * 0.81
    bowed(d, x1 - N * 0.10, y0 + N * 0.025, x1, y1 - N * 0.025, 0.035, PAPER, r=0.18)
    bowed(d, x0, y0, x1 - N * 0.065, y1, 0.05, RED_LT, r=0.24)
    bowed(d, x0 + N * 0.015, N * 0.415, x1 - N * 0.05, N * 0.585, 0.05, CREAM, r=0.10)
    bowed(d, N * 0.30, N * 0.465, N * 0.60, N * 0.500, 0.06, RED_DK, r=0.5)
    bowed(d, N * 0.30, N * 0.525, N * 0.52, N * 0.556, 0.06, RED_DK, r=0.5)
    bowed(d, N * 0.43, y1 - N * 0.02, N * 0.51, y1 + N * 0.10, 0.05, GILT, r=0.3)
    return finish(im)


DRAFTS = [
    ("1 chubby + ribbon", draft_1),
    ("2 tilted + star", draft_2),
    ("3 little stack", draft_3),
    ("4 with a face", draft_4),
    ("5 open + chubby", draft_5),
    ("6 pocket book", draft_6),
]

SIZES = [16, 24, 32, 48, 64]
ZOOM = 5
os.makedirs("shots-now/out", exist_ok=True)

cell = 168
pad = 16
head = 30
board_w = pad + cell + pad + len(SIZES) * (cell + pad) + pad
board_h = head + len(DRAFTS) * (cell + pad + 18) + pad
board = Image.new("RGB", (board_w, board_h), (34, 30, 28))
bd = ImageDraw.Draw(board)
bd.text((pad, 9), "CUTE RED BOOK - master, then TRUE SIZE (top of cell) and magnified (bottom)", fill=(232, 222, 208))

for r, (name, fn) in enumerate(DRAFTS):
    m = fn()
    m.save(f"shots-now/out/redbook-{name[0]}.png")
    y = head + r * (cell + pad + 18)
    t = Image.new("RGB", (cell, cell), (244, 238, 224))
    big = m.resize((cell, cell), Image.LANCZOS)
    t.paste(big.convert("RGB"), (0, 0), big)
    board.paste(t, (pad, y))
    bd.text((pad, y + cell + 3), name, fill=(232, 222, 208))
    for i, s in enumerate(SIZES):
        x = pad + cell + pad + i * (cell + pad)
        small = m.resize((s, s), Image.LANCZOS)
        c = Image.new("RGB", (cell, cell), (28, 26, 25))
        c.paste((244, 238, 224), (0, 0, cell, cell // 2))
        c.paste(small.convert("RGB"), ((cell - s) // 2, (cell // 2 - s) // 2), small)
        z = small.resize((s * ZOOM, s * ZOOM), Image.NEAREST)
        zc = z.crop((0, 0, min(cell, z.width), min(cell // 2 - 6, z.height)))
        c.paste(zc.convert("RGB"), ((cell - zc.width) // 2, cell // 2 + 4), zc)
        board.paste(c, (x, y))
        bd.text((x, y + cell + 3), f"{s}px", fill=(190, 180, 168))

board.save("shots-now/out/icon-redbook.png")
print("wrote shots-now/out/icon-redbook.png", board.size)
