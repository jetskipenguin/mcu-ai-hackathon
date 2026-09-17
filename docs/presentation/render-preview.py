"""Validate the PPTX package and rasterize its separately exported, actual PDF.

Run after build-deck.cjs and the PDF export. Video decoding is a separate,
read-only check in verify-demo-video.py; neither check tests slide-app playback.
"""

import hashlib
import json
import math
import posixpath
import re
import zipfile
from pathlib import Path
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree as ET

import pymupdf
from PIL import Image, ImageDraw


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "p14": "http://schemas.microsoft.com/office/powerpoint/2010/main",
}
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
VIDEO_REL = NS["r"] + "/video"
MEDIA_REL = "http://schemas.microsoft.com/office/2007/relationships/media"
TITLE = "Same task. Different boundary."


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def native_text(tree):
    return " ".join(" ".join(node.itertext()) for node in tree.findall(".//a:t", NS))


def package_relationships(trees, parts):
    """Resolve every internal target, then check every nonempty r:* reference."""
    by_source, external = {}, []
    for name, tree in trees.items():
        if not name.endswith(".rels"):
            continue
        folder, filename = posixpath.split(name)
        assert posixpath.basename(folder) == "_rels", name
        source = "" if name == "_rels/.rels" else posixpath.join(posixpath.dirname(folder), filename[:-5])
        assert not source or source in parts, f"Orphan relationships: {name}"
        assert tree.tag == f"{{{REL_NS}}}Relationships", name
        relationships = by_source.setdefault(source, {})
        for rel in tree:
            assert rel.tag == f"{{{REL_NS}}}Relationship", name
            rid, kind, target = (rel.attrib[key] for key in ("Id", "Type", "Target"))
            assert rid and rid not in relationships, (name, rid)
            mode = rel.attrib.get("TargetMode", "Internal")
            assert mode in ("Internal", "External"), (name, mode)
            if mode == "External":
                assert kind == NS["r"] + "/hyperlink", f"External media/part link: {name}: {target}"
                external.append(target)
            else:
                uri = urlsplit(target)
                assert not uri.scheme and not uri.netloc and not uri.query, (name, target)
                path = unquote(uri.path)
                assert path and "\\" not in path, (name, target)
                target = posixpath.normpath(path.lstrip("/") if path.startswith("/") else
                                           posixpath.join(posixpath.dirname(source), path))
                assert target in parts, f"Dangling relationship: {name}: {rid} -> {target}"
            relationships[rid] = {"type": kind, "target": target, "external": mode == "External"}
    for name, tree in trees.items():
        if name.endswith(".rels"):
            continue
        for node in tree.iter():
            for key, rid in node.attrib.items():
                # PptxGenJS uses an empty r:id on its media-play action, not a link.
                if key.startswith(f"{{{NS['r']}}}") and rid:
                    assert rid in by_source.get(name, {}), f"Unresolved XML reference: {name}: {rid}"
    return by_source, sorted(external)


def validate_package():
    video_path = HERE / "Countersign-demo.mp4"
    video = None
    with zipfile.ZipFile(HERE / "Countersign.pptx") as archive:
        assert archive.testzip() is None, "PPTX ZIP integrity failed"
        names = archive.namelist()
        assert len(names) == len(set(names)), "Duplicate ZIP entries"
        parts = {name for name in names if not archive.getinfo(name).is_dir()}
        trees = {name: ET.fromstring(archive.read(name)) for name in parts if name.endswith((".xml", ".rels"))}
        slides = [f"ppt/slides/slide{i}.xml" for i in range(1, 9)]
        notes = [f"ppt/notesSlides/notesSlide{i}.xml" for i in range(1, 9)]
        assert {name for name in parts if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)} == set(slides)
        assert {name for name in parts if re.fullmatch(r"ppt/notesSlides/notesSlide\d+\.xml", name)} == set(notes)
        relationships, external = package_relationships(trees, parts)
        slide_ids = trees["ppt/presentation.xml"].findall("p:sldIdLst/p:sldId", NS)
        assert [relationships["ppt/presentation.xml"][node.attrib[f"{{{NS['r']}}}id"]]["target"]
                for node in slide_ids] == slides, "Presentation slide order/count"
        for index, (slide, note) in enumerate(zip(slides, notes), 1):
            assert [rel["target"] for rel in relationships[slide].values()
                    if rel["type"] == NS["r"] + "/notesSlide"] == [note], (slide, "notes link")
            assert [rel["target"] for rel in relationships[note].values()
                    if rel["type"] == NS["r"] + "/slide"] == [slide], (note, "slide link")
            note_text = native_text(trees[note])
            assert f"SLIDE {index}" in note_text, note
            assert "PRODUCTION / EVIDENCE NOTES" in note_text, note

        slide3 = trees[slides[2]]
        title_shapes = [shape for shape in slide3.findall(".//p:sp", NS)
                        if TITLE in " ".join(native_text(shape).split())]
        assert title_shapes, "Slide 3 needs its native editable title"
        for shape in title_shapes:
            props = shape.find("p:nvSpPr/p:cNvPr", NS)
            assert props is not None and props.attrib.get("hidden", "0") not in ("1", "true"), "Hidden slide 3 title"
        assert "virtual authenticator" in native_text(trees[slides[3]]).lower(), "Slide 4 evidence qualification"

        content_types = trees["[Content_Types].xml"]
        defaults = {node.attrib["Extension"].lower(): node.attrib["ContentType"]
                    for node in content_types if node.tag.endswith("}Default")}
        overrides = {unquote(node.attrib["PartName"]).lstrip("/"): node.attrib["ContentType"]
                     for node in content_types if node.tag.endswith("}Override")}
        media = sorted(name for name in parts if name.startswith("ppt/media/"))
        png_hashes = {}
        for name in media:
            suffix = Path(name).suffix.lower()
            assert suffix in (".png", ".mp4"), f"Unexpected embedded media: {name}"
            expected_type = "image/png" if suffix == ".png" else "video/mp4"
            assert overrides.get(name, defaults.get(suffix[1:])) == expected_type, (name, "content type")
            if suffix == ".png":
                with archive.open(name) as stream, Image.open(stream) as image:
                    assert image.format == "PNG", name
                    image.verify()
                png_hashes[name] = hashlib.sha256(archive.read(name)).hexdigest()
        mp4s = [name for name in parts if name.lower().endswith(".mp4")]
        assert len(mp4s) == int(video_path.is_file()), "Expected exactly one embedded MP4 when the standalone exists"
        av_relationships = [(source, rid, rel) for source, rels in relationships.items() for rid, rel in rels.items()
                            if rel["type"].rsplit("/", 1)[-1] in ("audio", "video", "media")]
        video_nodes = [(name, node) for name in slides for node in trees[name].findall(".//a:videoFile", NS)]
        media_nodes = [(name, node) for name in slides for node in trees[name].findall(".//p14:media", NS)]
        if video_path.is_file():
            metadata = json.loads((HERE / "demo-video.json").read_text())
            assert metadata["output"] == video_path.name
            assert metadata["duration_seconds"] == 75.5 and metadata["fps"] == 30
            assert metadata["size"] == [1920, 1080] and metadata["audio"] is False
            digest = sha256(video_path)
            embedded = mp4s[0]
            assert embedded in media, embedded
            assert digest == metadata["sha256"] == hashlib.sha256(archive.read(embedded)).hexdigest(), "MP4 SHA-256 mismatch"
            assert video_path.stat().st_size == metadata["bytes"] == archive.getinfo(embedded).file_size, "MP4 byte count mismatch"
            assert external == [], f"Video deck must be self-contained: {external}"
            assert len(av_relationships) == 2 and {rel["type"] for _, _, rel in av_relationships} == {VIDEO_REL, MEDIA_REL}
            assert all(source == slides[2] and not rel["external"] and rel["target"] == embedded
                       for source, _, rel in av_relationships), "Video/media relationships must target the slide 3 MP4"
            assert len(video_nodes) == len(media_nodes) == 1, "Expected one native video object"
            for nodes, attribute, kind in ((video_nodes, "link", VIDEO_REL), (media_nodes, "embed", MEDIA_REL)):
                source, node = nodes[0]
                assert source == slides[2]
                rel = relationships[source][node.attrib[f"{{{NS['r']}}}{attribute}"]]
                assert rel == {"type": kind, "target": embedded, "external": False}, "Video XML must use its media relationship"
            pictures = [pic for pic in slide3.findall(".//p:pic", NS)
                        if pic.find(".//a:videoFile", NS) is not None and pic.find(".//p14:media", NS) is not None]
            assert len(pictures) == 1, "Video and media references must belong to the same object"
            cover = pictures[0].find("p:blipFill/a:blip", NS)
            assert cover is not None, "Missing video cover"
            cover_rel = relationships[slides[2]][cover.attrib[f"{{{NS['r']}}}embed"]]
            assert cover_rel["type"] == NS["r"] + "/image" and not cover_rel["external"]
            assert png_hashes[cover_rel["target"]] == sha256(HERE / "assets/demo-poster.png"), "Incorrect video cover"
            proof = HERE / "assets/demo-proof.png"
            if proof.is_file():
                assert sha256(proof) not in png_hashes.values(), "Audit proof still belongs inside the video, not directly on a slide"
            video = {
                "filename": video_path.name, "package_part": embedded, "slide": 3,
                "sha256": digest, "bytes": metadata["bytes"], "duration_seconds": metadata["duration_seconds"],
                "duration_source": "demo-video.json (decode checked separately by verify-demo-video.py)",
                "standalone_and_metadata_sha256_match": True, "poster": "assets/demo-poster.png",
                "recorded_action": metadata["evidence"],
            }
        else:
            assert not av_relationships and not video_nodes and not media_nodes, "Fallback must not contain media links/objects"
            assert external == ["http://localhost:3000/quiz/1", "http://localhost:3001/quiz/1"], external
    return {"notes_pages": len(notes), "external_links": external, "embedded_video": video is not None, "video": video}


def validate_layout():
    layout = json.loads((ROOT / "node_modules/.cache/countersign-deck-layout.json").read_text())
    assert layout["slides"] == len(layout["timed_seconds"]) == 8
    assert sum(layout["timed_seconds"]) == 390 and layout["buffer_seconds"] == 30
    assert layout["qa_seconds"] == 180
    width, height = layout["canvas"]["width"], layout["canvas"]["height"]
    assert abs(width / height - 16 / 9) < 0.01
    assert layout["objects"]
    for item in layout["objects"]:
        x, y, w, h = (item[key] for key in ("x", "y", "w", "h"))
        assert 1 <= item["slide"] <= 8 and all(math.isfinite(n) for n in (x, y, w, h)), item
        assert x >= -0.01 and y >= -0.01 and w >= 0 and h >= 0, item
        assert x + w <= width + 0.01 and y + h <= height + 0.01, item
    return layout


def render_pdf(embedded_video=False):
    preview = HERE / "preview"
    preview.mkdir(exist_ok=True)
    expected = ["A valid session", "Countersign.", TITLE, "Participation", "Add a checkpoint", "AI drafts.", "Training is", "Choose one action."]
    page_text = []
    with pymupdf.open(HERE / "Countersign.pdf") as pdf:
        assert len(pdf) == 8
        for i, page in enumerate(pdf):
            value = page.get_text()
            assert expected[i] in " ".join(value.split()), (i + 1, value)
            if i == 3:
                assert "virtual authenticator" in " ".join(value.lower().split()), "Slide 4 PDF evidence qualification"
            if i == 2 and embedded_video:
                poster_areas = [rect.get_area() for entry in page.get_images(full=True)
                                for rect in page.get_image_rects(entry[0])]
                assert poster_areas and max(poster_areas) >= page.rect.get_area() * 0.6, "Slide 3 PDF poster is missing or too small"
            assert abs(page.rect.width / page.rect.height - 16 / 9) < 0.01
            for block in page.get_text("dict")["blocks"]:
                if "lines" not in block:
                    continue
                for line in block["lines"]:
                    for span in line["spans"]:
                        box = pymupdf.Rect(span["bbox"])
                        assert box.x0 >= -0.5 and box.y0 >= -0.5, (i + 1, span)
                        assert box.x1 <= page.rect.width + 0.5 and box.y1 <= page.rect.height + 0.5, (i + 1, span)
            page.get_pixmap(matrix=pymupdf.Matrix(1.6, 1.6), alpha=False).save(preview / f"slide-{i + 1:02d}.png")
            page_text.append({"slide": i + 1, "text": value})

    thumb_w, thumb_h, gutter, top = 800, 450, 28, 34
    sheet = Image.new("RGB", (thumb_w * 2 + gutter * 3, (thumb_h + top) * 4 + gutter * 5), "#e5ebf0")
    draw = ImageDraw.Draw(sheet)
    for index in range(8):
        col, row = index % 2, index // 2
        x, y = gutter + col * (thumb_w + gutter), gutter + row * (thumb_h + top + gutter)
        draw.text((x, y + 5), f"{index + 1:02d}  /  COUNTERSIGN", fill="#10243a", font_size=17)
        with Image.open(preview / f"slide-{index + 1:02d}.png") as image:
            sheet.paste(image.resize((thumb_w, thumb_h), Image.Resampling.LANCZOS), (x, y + top))
    sheet.save(HERE / "Countersign-preview.png", optimize=True)
    return page_text


def main():
    package = validate_package()
    layout = validate_layout()
    page_text = render_pdf(package["embedded_video"])
    recorded = package["embedded_video"]
    report = {
        "slides": len(page_text), **package, "format": "16:9", "native_text_font": layout["font"],
        "presentation_seconds": sum(layout["timed_seconds"]), "buffer_seconds": layout["buffer_seconds"],
        "qa_seconds": layout["qa_seconds"], "package_xml": "valid", "package_relationships": "pass",
        "external_media_links": [], "source_object_bounds": "pass", "rendered_text_bounds": "pass",
        "pdf_video_poster": "visible_image_coverage_pass" if recorded else "not_applicable",
        "renderer": "Actual deck PDF export; PyMuPDF rasterization",
        "pptx_sha256": sha256(HERE / "Countersign.pptx"), "pdf_sha256": sha256(HERE / "Countersign.pdf"),
        "evidence": {
            "slide_3": {
                "kind": "recorded_quiz_demo" if recorded else "live_demo_placeholder",
                "source": "Two user-supplied real Chrome/ChatGPT-extension recordings; demo-video.json records the matching audit action."
                          if recorded else "Static governed-quiz UI reference; no recording embedded.",
                "native_prompt": "Visibly captured in the real recording, as confirmed by the user; not a virtual-authenticator UI reference."
                                 if recorded else "Not captured in this slide.",
            },
            "slide_4": "Automated UI reference: disclosure badges from an isolated virtual-authenticator flow; not the recorded quiz demo.",
            "slide_6": "Policy-review UI detail crops; not evidence of new policy generation or approval.",
        },
        "powerpoint_keynote_playback": "not_tested",
        "limitations": [
            "Package/PDF validation does not decode the MP4; run verify-demo-video.py separately."
            if recorded else "No physical-passkey or ChatGPT-extension demo recording is embedded in the fallback deck.",
            "PDF/PNG previews show the video cover only, not playback." if recorded else "Slide 3 is a live-demo holding slide.",
            "PowerPoint/Keynote playback and final live rehearsal remain human checks.",
        ],
        "slide_text": page_text,
    }
    (HERE / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
    media_status = "one byte-matched embedded MP4" if recorded else "PNG-only fallback with two quiz hyperlinks"
    print(f"PASS: 8 slides, 8 linked notes pages, valid XML/PNG/relationships, {media_status}.")
    print("PASS: 16:9, 6:30 + 0:30, native slide 3 title, on-canvas layout objects and PDF text.")
    print(f"Actual deck preview: {(HERE / 'Countersign-preview.png').relative_to(ROOT)}")
    print("PowerPoint/Keynote playback: not tested.")


if __name__ == "__main__":
    main()
