"""Inspect the supplied mark before touching it.

Two questions decide what processing it needs:
  1. What is the surround? A white box behind a rounded badge looks fine on a
     white page and wrong on a dark taskbar, so it has to become transparent.
  2. Which of its marks survive being shrunk? The spiral rings, the dashed
     stitching and the two small stars are the fine detail that killed the last
     icon at 16px.
"""
from PIL import Image
from collections import Counter

src = Image.open("assets/brand/alcove-art.png").convert("RGBA")
w, h = src.size
px = src.load()

print(f"size: {w}x{h}")

# Corners tell us the surround.
for name, (x, y) in [
    ("top-left", (2, 2)),
    ("top-right", (w - 3, 2)),
    ("bottom-left", (2, h - 3)),
    ("bottom-right", (w - 3, h - 3)),
    ("mid-left", (2, h // 2)),
]:
    print(f"  {name:13s} {px[x, y]}")

# How much of the image is near-white?
near_white = 0
for y in range(0, h, 4):
    for x in range(0, w, 4):
        r, g, b, a = px[x, y]
        if r > 244 and g > 244 and b > 244:
            near_white += 1
total = (h // 4) * (w // 4)
print(f"near-white coverage: {100 * near_white / total:.1f}%")

# Dominant colours, to confirm the red and cream we will need to match.
c = Counter()
for y in range(0, h, 3):
    for x in range(0, w, 3):
        r, g, b, a = px[x, y]
        if a > 200:
            c[(r // 16 * 16, g // 16 * 16, b // 16 * 16)] += 1
print("dominant colours:")
for col, n in c.most_common(6):
    print(f"  #{col[0]:02x}{col[1]:02x}{col[2]:02x}  {100 * n / sum(c.values()):.1f}%")
