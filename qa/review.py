from PIL import Image
import os, statistics, glob

def seam(p):
    im = Image.open(p).convert("RGB"); w,h = im.size; px = im.load()
    lr = statistics.mean(abs(px[0,y][c]-px[w-1,y][c]) for y in range(h) for c in range(3))
    tb = statistics.mean(abs(px[x,0][c]-px[x,h-1][c]) for x in range(w) for c in range(3))
    ref= statistics.mean(abs(px[w//2,y][c]-px[w//2+1,y][c]) for y in range(h) for c in range(3))
    return lr,tb,ref

def sheet(folder, cols, out, cell=340):
    files = sorted(glob.glob(f"assets/generated/{folder}/*.png"))
    rows = (len(files)+cols-1)//cols
    sh = Image.new("RGB",(cols*cell, rows*(cell+22)), (26,24,22))
    for i,f in enumerate(files):
        im = Image.open(f).convert("RGB").resize((cell-8,cell-8), Image.LANCZOS)
        x = (i%cols)*cell+4; y=(i//cols)*(cell+22)+18
        sh.paste(im,(x,y))
    sh.save(out)
    return files

print("== materials seam check ==")
for f in sorted(glob.glob("assets/generated/materials/*.png")):
    lr,tb,ref = seam(f)
    ok = "OK " if (lr < ref*1.35 and tb < ref*1.35) else "SEAM"
    print(f"  {ok} {os.path.basename(f):22s} lr={lr:5.1f} tb={tb:5.1f} ref={ref:5.1f}")
print("== wallpaper seam check ==")
for f in sorted(glob.glob("assets/generated/wallpaper/*.png")):
    lr,tb,ref = seam(f)
    ok = "OK " if (lr < ref*1.35 and tb < ref*1.35) else "SEAM"
    print(f"  {ok} {os.path.basename(f):22s} lr={lr:5.1f} tb={tb:5.1f} ref={ref:5.1f}")

sheet("materials",5,"qa/sheet-materials.png")
sheet("wallpaper",4,"qa/sheet-wallpaper.png")
sheet("foliage",3,"qa/sheet-foliage.png")
print("sheets written")
