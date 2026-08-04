"""What icon is ACTUALLY inside the installed exe?

Parses the PE resource tree directly rather than asking Windows for a
thumbnail. Two reasons, both learned the hard way:

  - a 32px thumbnail is small enough to hide WHICH artwork it is, and the
    question here is exactly that. An earlier version of this check reported
    "the icon is there" while the binary still carried the previous app's mark.
  - the HICON route needs handle types declared or GetObjectW overflows on
    64-bit Python.

Run with no argument for the installed copy, or pass a path to check a build
before installing it.

    python shots-now/icon-installed.py
    python shots-now/icon-installed.py src-tauri/target/release/alcove.exe
"""
import io
import os
import struct
import sys

from PIL import Image

DEFAULT = os.path.expandvars(r"%LOCALAPPDATA%\Alcove\alcove.exe")
path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
data = open(path, "rb").read()
print(f"{path}\n  {len(data):,} bytes")

pe_off = struct.unpack_from("<I", data, 0x3C)[0]
assert data[pe_off:pe_off + 4] == b"PE\0\0", "not a PE file"
n_sections, = struct.unpack_from("<H", data, pe_off + 6)
opt_size, = struct.unpack_from("<H", data, pe_off + 20)
opt_off = pe_off + 24
magic, = struct.unpack_from("<H", data, opt_off)
dd_off = opt_off + (112 if magic == 0x20B else 96)
rsrc_rva, _rsrc_size = struct.unpack_from("<II", data, dd_off + 2 * 8)

sec_off = opt_off + opt_size
sections = []
for i in range(n_sections):
    o = sec_off + i * 40
    vsize, vaddr, rawsize, rawptr = struct.unpack_from("<IIII", data, o + 8)
    sections.append((vaddr, vsize, rawptr, rawsize))


def rva_to_off(rva: int):
    for va, vs, rp, rs in sections:
        if va <= rva < va + max(vs, rs):
            return rp + (rva - va)
    return None


base = rva_to_off(rsrc_rva)


def walk(off: int, ids=()):
    n_named, n_id = struct.unpack_from("<HH", data, off + 12)
    out = []
    for i in range(n_named + n_id):
        e = off + 16 + i * 8
        nid, offset = struct.unpack_from("<II", data, e)
        child = base + (offset & 0x7FFFFFFF)
        if offset & 0x80000000:
            out += walk(child, ids + (nid,))
        else:
            drva, dsize = struct.unpack_from("<II", data, child)
            out.append((ids + (nid,), rva_to_off(drva), dsize))
    return out


RT_ICON = 3
entries = [e for e in walk(base) if e[0] and e[0][0] == RT_ICON]
print(f"  RT_ICON frames embedded: {len(entries)}")

best = None
sizes = []
for _ids, off, size in entries:
    blob = data[off:off + size]
    if blob[:8] == b"\x89PNG\r\n\x1a\n":
        im = Image.open(io.BytesIO(blob)).convert("RGBA")
    else:
        w, h = struct.unpack_from("<ii", blob, 4)
        h //= 2
        bpp, = struct.unpack_from("<H", blob, 14)
        if bpp != 32:
            continue
        im = Image.frombuffer(
            "RGBA", (w, h), blob[40:40 + w * h * 4], "raw", "BGRA", 0, 1
        ).transpose(Image.FLIP_TOP_BOTTOM)
    sizes.append(im.width)
    if best is None or im.width > best.width:
        best = im

print(f"  frame sizes: {sorted(sizes)}")
if best is None:
    print("  NO 32bpp ICON FOUND")
    raise SystemExit(1)

os.makedirs("shots-now/out", exist_ok=True)
out = "shots-now/out/icon-installed.png"
best.resize((256, 256), Image.NEAREST).save(out)
print(f"  largest {best.width}x{best.height} -> {out}")
