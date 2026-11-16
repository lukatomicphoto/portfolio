"""
Skenira photos/<kategorija>/ i pravi data.js koji sajt cita.

Pokretanje:  python build.py   (ili dupli klik na update.bat)

Pravila:
  - photos/<slug>/cover.*   -> naslovna fotka kolone (ako je nema, uzima se prva fotka)
  - sve ostale fotke u folderu -> galerija, sortirane po imenu fajla (01.jpg, 02.jpg ...)
  - photos/portrait.*       -> tvoja fotka u info panelu (opciono)
  - nazivi, redoslijed kategorija i tekstovi su u content.json
Bez ikakvih dodatnih biblioteka.
"""
import json
import os
import struct
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PHOTOS = os.path.join(ROOT, "photos")
EXTS = (".jpg", ".jpeg", ".png", ".webp")


def jpeg_size(f):
    f.seek(2)
    orientation = 1
    while True:
        b = f.read(1)
        if not b:
            return None
        if b != b"\xff":
            continue
        marker = f.read(1)
        while marker == b"\xff":
            marker = f.read(1)
        if not marker:
            return None
        m = marker[0]
        if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
            continue
        seg = f.read(2)
        if len(seg) < 2:
            return None
        length = struct.unpack(">H", seg)[0]
        if m == 0xE1:  # EXIF -> orijentacija
            data = f.read(length - 2)
            if data[:6] == b"Exif\x00\x00":
                orientation = exif_orientation(data[6:]) or 1
            continue
        if m in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            data = f.read(5)
            h, w = struct.unpack(">HH", data[1:5])
            if orientation in (5, 6, 7, 8):
                w, h = h, w
            return w, h
        f.seek(length - 2, 1)


def exif_orientation(t):
    try:
        e = "<" if t[:2] == b"II" else ">"
        off = struct.unpack(e + "I", t[4:8])[0]
        n = struct.unpack(e + "H", t[off:off + 2])[0]
        for i in range(n):
            p = off + 2 + i * 12
            tag, typ = struct.unpack(e + "HH", t[p:p + 4])
            if tag == 0x0112:
                return struct.unpack(e + "H", t[p + 8:p + 10])[0]
    except Exception:
        pass
    return None


def png_size(f):
    f.seek(16)
    return struct.unpack(">II", f.read(8))


def webp_size(f):
    f.seek(12)
    chunk = f.read(4)
    f.seek(20)
    d = f.read(10)
    if chunk == b"VP8 ":
        w, h = struct.unpack("<HH", d[6:10])
        return w & 0x3FFF, h & 0x3FFF
    if chunk == b"VP8L":
        b = struct.unpack("<I", d[1:5])[0]
        return (b & 0x3FFF) + 1, ((b >> 14) & 0x3FFF) + 1
    if chunk == b"VP8X":
        w = d[4] | (d[5] << 8) | (d[6] << 16)
        h = d[7] | (d[8] << 8) | (d[9] << 16)
        return w + 1, h + 1
    return None


def image_size(path):
    with open(path, "rb") as f:
        head = f.read(12)
        if head[:2] == b"\xff\xd8":
            return jpeg_size(f)
        if head[:8] == b"\x89PNG\r\n\x1a\n":
            return png_size(f)
        if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
            return webp_size(f)
    return None


def entry(rel):
    size = image_size(os.path.join(ROOT, rel))
    if not size:
        print("  ! preskacem (ne mogu procitati dimenzije):", rel)
        return None
    return {"src": rel.replace("\\", "/"), "w": int(size[0]), "h": int(size[1])}


def main():
    with open(os.path.join(ROOT, "content.json"), encoding="utf-8") as f:
        site = json.load(f)

    total = 0
    for cat in site["categories"]:
        folder = os.path.join(PHOTOS, cat["slug"])
        files = sorted(
            (x for x in (os.listdir(folder) if os.path.isdir(folder) else []) if x.lower().endswith(EXTS)),
            key=str.lower,
        )
        cover = next((x for x in files if x.lower().startswith("cover")), files[0] if files else None)
        cat["cover"] = entry(os.path.join("photos", cat["slug"], cover)) if cover else None
        photos = [entry(os.path.join("photos", cat["slug"], x)) for x in files if x != cover]
        cat["photos"] = [p for p in photos if p]
        total += len(cat["photos"])
        print(f"  {cat['slug']:<14} {len(cat['photos']):>3} fotki" + ("" if cover else "   ! nema naslovne"))

    site["portrait"] = None
    for x in sorted(os.listdir(PHOTOS)):
        if x.lower().startswith("portrait") and x.lower().endswith(EXTS):
            site["portrait"] = entry(os.path.join("photos", x))

    with open(os.path.join(ROOT, "data.js"), "w", encoding="utf-8") as f:
        f.write("// Generisano preko build.py - ne mijenjati rucno.\nwindow.SITE = ")
        json.dump(site, f, ensure_ascii=False, indent=1)
        f.write(";\n")
    print(f"Gotovo: data.js ({total} fotki u {len(site['categories'])} kategorija)")


if __name__ == "__main__":
    sys.exit(main())
