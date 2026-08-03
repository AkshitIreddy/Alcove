"""Cute red book, second pass.

What went wrong in pass one, so it is not repeated: `bowed()` was applied to the
OUTER TILE as well as the book, which turned the badge into a pill on one draft
and an octagon on another. And the corner radii ran to 22% of the shorter side,
which is enough to stop a rectangle reading as a book at all — draft 4 came out
as a red egg with a face on it.

Rules for this pass:
  - the tile is a clean rounded square; only the BOOK's edges bow, and gently
  - book corners get 6–10% radius: soft, still a book
  - cuteness comes from PROPORTION (short and fat), a tilt, and one warm accent
  - the silhouette at 16px must still read as a book, so the fore-edge sliver
    and at least one cream mark have to be fat enough to survive

Usage: python shots-now/icon-redbook2.py
"""
from PIL import Image, ImageDraw
import math
import os

INK = (79, 49, 32)
CREAM = (247, 240, 224)
PAPER = (235, 224, 200)
RED = (168, 56, 54)
RED_DK = (128, 40, 42)
RED_LT = (198, 88, 78)
GILT = (224, 180, 92)
MOSS = (106, 122, 84)
SKY = (118, 142, 156)

S = 1024
SS = 4


def tile(d, N, colour):
    """The badge: a clean rounded square. Never bowed — that was pass one's bug."""
    d.rounded_rectangle((0, 0, N - 1, N - 1), radius=int(N * 0.22), fill=colour)


def bowed(d, x0, y0, x1, y1, bow, fill, r=0.08):
    w, h = x1 - x0, y1 - y0
    b = min(w, h) * bow
    rr = min(w, h) * r
    pts = []
    N = 20

    def edge(ax, ay, bx, by, ox, oy):
        for i in range(N + 1):
            t = i / N
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


def fin(im):
    return im.resize((S, S), Image.LANCZOS)


def a_standing():
    """SHORT AND FAT, standing, gilt bands and a label. The classic."""
    im, d, N = canvas()
    tile(d, N, CREAM)
    x0, x1, y0, y1 = N * 0.19, N * 0.81, N * 0.17, N * 0.83
    bowed(d, x1 - N * 0.085, y0 + N * 0.015, x1, y1 - N * 0.015, 0.025, PAPER, r=0.10)
    bowed(d, x0, y0, x1 - N * 0.055, y1, 0.03, RED, r=0.09)
    for yy in (0.255, 0.745):
        yc = y0 + (y1 - y0) * yy
        bowed(d, x0 + N * 0.025, yc, x1 - N * 0.085, yc + N * 0.042, 0.03, GILT, r=0.4)
    bowed(d, x0 + N * 0.07, N * 0.405, x1 - N * 0.13, N * 0.595, 0.035, CREAM, r=0.13)
    bowed(d, N * 0.435, y1 - N * 0.01, N * 0.505, y1 + N * 0.095, 0.04, GILT, r=0.25)
    return fin(im)


def b_tilted():
    """LEANING, with a gilt star. The tilt is the charm."""
    im, d, N = canvas()
    tile(d, N, CREAM)
    layer = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    x0, x1, y0, y1 = N * 0.25, N * 0.75, N * 0.15, N * 0.85
    bowed(ld, x1 - N * 0.075, y0 + N * 0.015, x1, y1 - N * 0.015, 0.025, PAPER, r=0.10)
    bowed(ld, x0, y0, x1 - N * 0.05, y1, 0.03, RED, r=0.09)
    cx, cy, rad = N * 0.455, N * 0.44, N * 0.10
    pts = []
    for i in range(10):
        ang = -math.pi / 2 + i * math.pi / 5
        rr = rad if i % 2 == 0 else rad * 0.45
        pts.append((cx + rr * math.cos(ang), cy + rr * math.sin(ang)))
    ld.polygon(pts, fill=GILT)
    bowed(ld, x0 + N * 0.035, N * 0.635, x1 - N * 0.085, N * 0.675, 0.03, GILT, r=0.4)
    layer = layer.rotate(-8, resample=Image.BICUBIC, center=(N // 2, N // 2))
    im.alpha_composite(layer)
    return fin(im)


def c_stack():
    """A LITTLE STACK, red on top and biggest. Pass one's best idea, tidied."""
    im, d, N = canvas()
    tile(d, N, CREAM)
    bowed(d, N * 0.15, N * 0.665, N * 0.85, N * 0.795, 0.02, SKY, r=0.22)
    bowed(d, N * 0.19, N * 0.545, N * 0.81, N * 0.660, 0.02, MOSS, r=0.24)
    bowed(d, N * 0.12, N * 0.375, N * 0.88, N * 0.540, 0.025, RED, r=0.18)
    bowed(d, N * 0.155, N * 0.445, N * 0.845, N * 0.487, 0.03, GILT, r=0.4)
    bowed(d, N * 0.615, N * 0.50, N * 0.685, N * 0.865, 0.04, GILT, r=0.25)
    return fin(im)


def d_ribbon_big():
    """ONE FAT RIBBON. The book is plain; the ribbon does all the talking."""
    im, d, N = canvas()
    tile(d, N, CREAM)
    x0, x1, y0, y1 = N * 0.20, N * 0.80, N * 0.16, N * 0.84
    bowed(d, x1 - N * 0.08, y0 + N * 0.015, x1, y1 - N * 0.015, 0.025, PAPER, r=0.10)
    bowed(d, x0, y0, x1 - N * 0.05, y1, 0.03, RED, r=0.09)
    # a wide cream ribbon straight down the cover, over the foot
    bowed(d, N * 0.395, y0 - N * 0.015, N * 0.545, y1 + N * 0.10, 0.02, CREAM, r=0.10)
    bowed(d, N * 0.425, N * 0.44, N * 0.515, N * 0.53, 0.05, RED, r=0.45)
    return fin(im)


def e_openbook():
    """OPEN, SHORT AND WIDE, in a red case. Solid rather than outline-y."""
    im, d, N = canvas()
    tile(d, N, CREAM)
    bowed(d, N * 0.09, N * 0.315, N * 0.91, N * 0.755, 0.035, RED, r=0.13)
    bowed(d, N * 0.135, N * 0.355, N * 0.487, N * 0.715, 0.04, PAPER, r=0.11)
    bowed(d, N * 0.513, N * 0.355, N * 0.865, N * 0.715, 0.04, CREAM, r=0.11)
    bowed(d, N * 0.482, N * 0.325, N * 0.518, N * 0.745, 0.02, RED_DK, r=0.35)
    bowed(d, N * 0.615, N * 0.60, N * 0.685, N * 0.875, 0.04, GILT, r=0.25)
    return fin(im)


def f_red_ground():
    """RED GROUND, cream book. The inverse — and the only one that is red at 16px."""
    im, d, N = canvas()
    tile(d, N, RED)
    x0, x1, y0, y1 = N * 0.22, N * 0.78, N * 0.18, N * 0.82
    bowed(d, x1 - N * 0.075, y0 + N * 0.015, x1, y1 - N * 0.015, 0.025, PAPER, r=0.10)
    bowed(d, x0, y0, x1 - N * 0.05, y1, 0.03, CREAM, r=0.09)
    for yy in (0.26, 0.74):
        yc = y0 + (y1 - y0) * yy
        bowed(d, x0 + N * 0.025, yc, x1 - N * 0.075, yc + N * 0.038, 0.03, RED, r=0.4)
    bowed(d, x0 + N * 0.065, N * 0.415, x1 - N * 0.115, N * 0.585, 0.035, GILT, r=0.13)
    bowed(d, N * 0.44, y1 - N * 0.01, N * 0.51, y1 + N * 0.09, 0.04, GILT, r=0.25)
    return fin(im)


DRAFTS = [
    ("A standing", a_standing),
    ("B tilted + star", b_tilted),
    ("C stack", c_stack),
    ("D fat ribbon", d_ribbon_big),
    ("E open book", e_openbook),
    ("F red ground", f_red_ground),
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
bd.text((pad, 9), "CUTE RED BOOK v2 - master, TRUE SIZE (top of cell), magnified (bottom)", fill=(232, 222, 208))

for r, (name, fn) in enumerate(DRAFTS):
    m = fn()
    m.save(f"shots-now/out/redbook2-{name.split()[0].lower()}.png")
    y = head + r * (cell + pad + 18)
    t = Image.new("RGB", (cell, cell), (250, 246, 238))
    big = m.resize((cell, cell), Image.LANCZOS)
    t.paste(big.convert("RGB"), (0, 0), big)
    board.paste(t, (pad, y))
    bd.text((pad, y + cell + 3), name, fill=(232, 222, 208))
    for i, s in enumerate(SIZES):
        x = pad + cell + pad + i * (cell + pad)
        small = m.resize((s, s), Image.LANCZOS)
        c = Image.new("RGB", (cell, cell), (28, 26, 25))
        c.paste((250, 246, 238), (0, 0, cell, cell // 2))
        c.paste(small.convert("RGB"), ((cell - s) // 2, (cell // 2 - s) // 2), small)
        z = small.resize((s * ZOOM, s * ZOOM), Image.NEAREST)
        zc = z.crop((0, 0, min(cell, z.width), min(cell // 2 - 6, z.height)))
        c.paste(zc.convert("RGB"), ((cell - zc.width) // 2, cell // 2 + 4), zc)
        board.paste(c, (x, y))
        bd.text((x, y + cell + 3), f"{s}px", fill=(190, 180, 168))

board.save("shots-now/out/icon-redbook2.png")
print("wrote shots-now/out/icon-redbook2.png", board.size)
