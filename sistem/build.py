"""
Pravi sajt iz foldera photos/ i fajla content.json.

Pokretanje: dupli klik na PREGLED.bat (lokalno) ili OBJAVI.bat (na internet).

Sta pravi:
  - data.js                 lista fotki i tekstova koju sajt cita
  - index.html              pocetna stranica (iz template.html)
  - <kategorija>/index.html prava stranica za svaku kategoriju (lukatomic.com/sport/ ...)
  - sitemap.xml, robots.txt za pretrazivace
  - thumbs/                 umanjene verzije fotki za brzo ucitavanje (ako je instaliran Pillow)

Pravila u photos/<kategorija>/:
  - cover.*            naslovna fotka kolone
  - ostale fotke       galerija, po imenu fajla (01.jpg, 02.jpg ...)
  - ime fajla = opis fotke za Google:  "03-nike-air-max-campaign.jpg" -> "Nike air max campaign"
  - .txt fajl          tekstualna plocica u mrezi (1. red = naslov, ostalo = sitan tekst),
                       stoji na mjestu koje joj ime odredi: "07z.txt" dolazi poslije "07.jpg"
  - photos/portrait.*  tvoja fotka u kontakt panelu (opciono)
"""
import datetime
import html
import json
import os
import re
import shutil
import struct
import sys

try:
    from PIL import Image, ImageOps
except Exception:  # sajt radi i bez toga, samo se ucitava sporije
    Image = None

SYS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SYS)
PHOTOS = os.path.join(ROOT, "photos")
THUMBS = os.path.join(ROOT, "thumbs")
EXTS = (".jpg", ".jpeg", ".png", ".webp")
THUMB_EDGE, COVER_EDGE = 1100, 1600
SIGS = {}  # otisak originala za svaku umanjenu verziju (thumbs/index.json)


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


def light(rel, edge, used):
    """Umanjena .webp verzija u thumbs/. Pravi se samo ako ne postoji ili je original noviji."""
    if not Image:
        return None
    src = os.path.join(ROOT, rel)
    out_rel = os.path.join("thumbs", os.path.relpath(os.path.splitext(src)[0], PHOTOS) + ".webp")
    out = os.path.join(ROOT, out_rel)
    used.add(os.path.normpath(out))
    try:
        st = os.stat(src); sig = f"{st.st_size}-{int(st.st_mtime)}"
        if SIGS.get(out_rel) == "small":
            if SIGS.get(out_rel + "#") == sig:
                return None
        if not os.path.exists(out) or SIGS.get(out_rel + "#") != sig:
            SIGS[out_rel + "#"] = sig; SIGS.pop(out_rel, None)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
            if max(im.size) <= edge * 1.15:
                SIGS[out_rel] = "small"
                if os.path.exists(out):
                    os.remove(out)
                return None  # vec je dovoljno mala
            im.thumbnail((edge, edge), Image.LANCZOS)
            im.save(out, "WEBP", quality=80, method=5)
        return out_rel.replace("\\", "/")
    except Exception as e:
        print("  ! umanjena verzija nije napravljena:", rel, e)
        return None


def caption(filename):
    """'03-nike-air-max-campaign.jpg' -> 'Nike air max campaign'; '03.jpg' -> ''"""
    stem = os.path.splitext(filename)[0]
    stem = re.sub(r"^[\d\s._-]+", "", stem)
    stem = re.sub(r"[_-]+", " ", stem).strip()
    return stem[:1].upper() + stem[1:] if stem else ""


def esc(s):
    return html.escape(str(s), quote=True)


def main():
    with open(os.path.join(ROOT, "content.json"), encoding="utf-8") as f:
        site = json.load(f)

    name = site["name"]
    role = site.get("role", "Photographer")
    base = site.get("url", "").rstrip("/")
    seo = site.get("seo", {})
    years = datetime.date.today().year - int(seo["experienceSince"]) if seo.get("experienceSince") else None
    fill = lambda t: t.replace("{name}", name).replace("{role}", role).replace("{years}", str(years or ""))
    absu = lambda rel: base + "/" + rel.lstrip("/")
    used, total = set(), 0
    sig_path = os.path.join(THUMBS, "index.json")
    if os.path.exists(sig_path):
        with open(sig_path, encoding="utf-8") as f:
            SIGS.update(json.load(f))
    used.add(os.path.normpath(sig_path))

    for cat in site["categories"]:
        folder = os.path.join(PHOTOS, cat["slug"])
        files = sorted((x for x in (os.listdir(folder) if os.path.isdir(folder) else []) if x.lower().endswith(EXTS + (".txt",))), key=str.lower)
        images = [x for x in files if not x.lower().endswith(".txt")]
        stem = lambda x: os.path.splitext(x)[0].lower()
        depth = next((x for x in images if stem(x) == "cover-depth"), None)
        images = [x for x in images if x != depth]
        cover = next((x for x in images if stem(x) == "cover"), next((x for x in images if stem(x).startswith("cover")), images[0] if images else None))
        label = f"{cat['title']} photography by {name}"
        cat["cover"] = entry(os.path.join("photos", cat["slug"], cover)) if cover else None
        if cat["cover"]:
            cat["cover"]["alt"] = f"{label} — {role.lower()}"
            small = light(cat["cover"]["src"], COVER_EDGE, used)
            if small:
                cat["cover"]["small"] = small
            if depth:
                cat["cover"]["depth"] = "photos/" + cat["slug"] + "/" + depth
                if cat.get("parallax") is not None:
                    cat["cover"]["parallax"] = float(cat["parallax"])
        items = []
        for x in files:
            if x == cover or x == depth:
                continue
            rel = os.path.join("photos", cat["slug"], x)
            if x.lower().endswith(".txt"):
                with open(os.path.join(ROOT, rel), encoding="utf-8-sig") as f:
                    lines = [l.strip() for l in f.read().splitlines() if l.strip()]
                if lines:
                    items.append({"text": True, "title": lines[0], "note": " ".join(lines[1:])})
                continue
            e = entry(rel)
            if not e:
                continue
            cap = caption(x)
            e["alt"] = f"{cap} — {label}" if cap else label
            thumb = light(rel, THUMB_EDGE, used)
            if thumb:
                e["thumb"] = thumb
            items.append(e)
        cat["items"] = items
        cat["photos"] = [i for i in items if not i.get("text")]
        cat["pageTitle"] = fill(cat.get("seoTitle") or seo.get("categoryTitle", "{category} Photography — {name}")).replace("{category}", cat["title"])
        cat["pageDesc"] = fill(cat.get("seoDescription") or seo.get("categoryDescription", "{category} photography by {name}.")).replace("{category}", cat["title"])
        total += len(cat["photos"])
        print(f"  {cat['slug']:<14} {len(cat['photos']):>3} fotki" + ("" if cover else "   ! nema naslovne"))

    site["portrait"] = None
    for x in sorted(os.listdir(PHOTOS)):
        if os.path.splitext(x)[0].lower() == "portrait" and x.lower().endswith(EXTS):
            site["portrait"] = entry(os.path.join("photos", x))
    for x in sorted(os.listdir(PHOTOS)):
        if os.path.splitext(x)[0].lower() == "portrait-depth" and x.lower().endswith(EXTS) and site["portrait"]:
            site["portrait"]["depth"] = "photos/" + x
    site["pageTitle"] = fill(seo.get("title", "{name} — {role}"))
    site["pageDesc"] = fill(seo.get("description", site.get("about", "")))

    # umanjene verzije koje vise nemaju original
    if Image and os.path.isdir(THUMBS):
        for d, _, fs in os.walk(THUMBS):
            for x in fs:
                if os.path.normpath(os.path.join(d, x)) not in used:
                    os.remove(os.path.join(d, x))

    if Image:
        os.makedirs(THUMBS, exist_ok=True)
        with open(sig_path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(SIGS, f, indent=0, sort_keys=True)

    def versioned(o):
        if isinstance(o, list):
            return [versioned(x) for x in o]
        if isinstance(o, dict):
            r = {}
            for k, v in o.items():
                if k in ("src", "thumb", "small", "depth") and isinstance(v, str) and os.path.exists(os.path.join(ROOT, v)):
                    st = os.stat(os.path.join(ROOT, v)); r[k] = f"{v}?v={int(st.st_mtime) % 100000000:x}{st.st_size % 4096:x}"
                else:
                    r[k] = versioned(v)
            return r
        return o

    public = versioned({k: v for k, v in site.items() if k not in ("seo",)})
    with open(os.path.join(ROOT, "data.js"), "w", encoding="utf-8", newline="\n") as f:
        f.write("// Generisano preko build.py - ne mijenjati rucno.\nwindow.SITE = ")
        json.dump(public, f, ensure_ascii=False, indent=1)
        f.write(";\n")

    # ---------- stranice + podaci za pretrazivace ----------
    with open(os.path.join(SYS, "template.html"), encoding="utf-8") as f:
        template = f.read()
    cats = [c for c in site["categories"] if c["cover"]]
    version = datetime.datetime.now().strftime("%y%m%d%H%M")
    person_id, site_id = base + "/#person", base + "/#website"
    person = {
        "@type": "Person", "@id": person_id, "name": name, "url": base + "/", "jobTitle": role,
        "description": site["pageDesc"],
        "knowsAbout": ["Commercial photography", "Advertising photography"] + [c["title"] + " photography" for c in cats],
        "hasOccupation": {"@type": "Occupation", "name": role, "skills": ", ".join(c["title"] + " photography" for c in cats)},
    }
    if site.get("portrait"): person["image"] = absu(site["portrait"]["src"])
    if site.get("email"): person["email"] = "mailto:" + site["email"]
    if site.get("phone"): person["telephone"] = site["phone"]
    if site.get("instagram"): person["sameAs"] = ["https://www.instagram.com/" + site["instagram"].lstrip("@")]
    if site.get("location"): person["address"] = {"@type": "PostalAddress", "addressLocality": site["location"]}
    website = {"@type": "WebSite", "@id": site_id, "url": base + "/", "name": name, "inLanguage": "en", "publisher": {"@id": person_id}}

    def image_obj(p):
        return {"@type": "ImageObject", "contentUrl": absu(p["src"]), "name": p.get("alt", ""), "width": p["w"], "height": p["h"],
                "creator": {"@id": person_id}, "creditText": name, "copyrightNotice": "\u00a9 " + name}

    def page(path, title, desc, image, graph, noscript):
        out = template
        for k, v in {
            "TITLE": esc(title), "DESC": esc(desc), "NAME": esc(name), "URL": esc(base + path),
            "IMAGE": esc(absu(image["src"])) if image else "", "IMAGE_ALT": esc(image.get("alt", "")) if image else "",
            "H1": esc(f"{name} — {role}"), "V": version, "NOSCRIPT": noscript,
            "JSONLD": json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False).replace("</", "<\\/"),
        }.items():
            out = out.replace("{{" + k + "}}", v)
        out = out.replace('href="sistem/css/style.css"', f'href="sistem/css/style.css?v={version}"')
        folder = os.path.join(ROOT, path.strip("/"))
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, "index.html"), "w", encoding="utf-8", newline="\n") as f:
            f.write(out)

    nav = "".join(f'<li><a href="/{c["slug"]}/">{esc(c["title"])} photography</a></li>' for c in cats)
    home_ns = f'<h1>{esc(name)} — {esc(role)}</h1><p>{esc(site["pageDesc"])}</p><ul>{nav}</ul>'
    page("/", site["pageTitle"], site["pageDesc"], cats[0]["cover"] if cats else None, [website, person], home_ns)

    for c in cats:
        url = f"{base}/{c['slug']}/"
        gallery = {
            "@type": ["CollectionPage", "ImageGallery"], "@id": url + "#gallery", "url": url, "name": c["pageTitle"],
            "description": c["pageDesc"], "isPartOf": {"@id": site_id}, "author": {"@id": person_id}, "inLanguage": "en",
            "primaryImageOfPage": image_obj(c["cover"]), "image": [image_obj(p) for p in c["photos"]],
        }
        crumbs = {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": name, "item": base + "/"},
            {"@type": "ListItem", "position": 2, "name": c["title"] + " photography", "item": url}]}
        ns = f'<h1>{esc(c["pageTitle"])}</h1><p>{esc(c["pageDesc"])}</p>' + "".join(
            f'<h2>{esc(i["title"])}</h2><p>{esc(i["note"])}</p>' if i.get("text") else
            f'<img src="{esc(i["src"])}" alt="{esc(i["alt"])}" width="{i["w"]}" height="{i["h"]}" loading="lazy">' for i in c["items"]
        ) + f'<ul><li><a href="/">{esc(name)}</a></li>{nav}</ul>'
        page(f"/{c['slug']}/", c["pageTitle"], c["pageDesc"], c["cover"], [website, person, gallery, crumbs], ns)

    today = datetime.date.today().isoformat()
    def url_xml(path, imgs):
        im = "".join(f"<image:image><image:loc>{esc(absu(p['src']))}</image:loc></image:image>" for p in imgs)
        return f"<url><loc>{esc(base + path)}</loc><lastmod>{today}</lastmod>{im}</url>"
    xml = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
           url_xml("/", [c["cover"] for c in cats])]
    xml += [url_xml(f"/{c['slug']}/", [c["cover"]] + c["photos"]) for c in cats]
    with open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(xml) + "\n</urlset>\n")
    with open(os.path.join(ROOT, "robots.txt"), "w", encoding="utf-8", newline="\n") as f:
        f.write(f"User-agent: *\nAllow: /\n\nSitemap: {base}/sitemap.xml\n")

    if not Image:
        print("  (Pillow nije instaliran - umanjene verzije fotki su preskocene)")
    print(f"Gotovo: {total} fotki, {len(cats)} stranica kategorija + pocetna")


if __name__ == "__main__":
    sys.exit(main())
