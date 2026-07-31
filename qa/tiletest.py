from PIL import Image
import sys
src = Image.open("assets/generated/materials/leather-cracked.png").convert("RGB")
w,h = src.size
s = src.resize((w//2, h//2), Image.LANCZOS)
sw,sh = s.size
sheet = Image.new("RGB",(sw*2, sh*2))
for x in range(2):
    for y in range(2):
        sheet.paste(s,(x*sw,y*sh))
sheet.save("qa/tile-test-leather.png")
# measure seam: compare left/right edge columns and top/bottom rows
import statistics
px = src.load()
def coldiff(a,b):
    return statistics.mean(abs(px[a,y][c]-px[b,y][c]) for y in range(h) for c in range(3))
def rowdiff(a,b):
    return statistics.mean(abs(px[x,a][c]-px[x,b][c]) for x in range(w) for c in range(3))
print("L-R edge mean abs diff:", round(coldiff(0,w-1),1))
print("T-B edge mean abs diff:", round(rowdiff(0,h-1),1))
print("(interior reference ~", round(coldiff(w//2, w//2+1),1), ")")
