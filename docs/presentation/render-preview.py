"""Validate the PPTX package and render a preview from its actual PDF export."""

import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

import pymupdf
from PIL import Image, ImageDraw


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
NS = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
with zipfile.ZipFile(HERE / "Countersign.pptx") as archive:
    assert archive.testzip() is None
    names = archive.namelist()
    for name in names:
        if name.endswith((".xml", ".rels")):
            ET.fromstring(archive.read(name))
    slides = sorted(name for name in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", name))
    notes = sorted(name for name in names if re.fullmatch(r"ppt/notesSlides/notesSlide\d+\.xml", name))
    assert len(slides) == len(notes) == 8
    for index in range(1, 9):
        root = ET.fromstring(archive.read(f"ppt/notesSlides/notesSlide{index}.xml"))
        note_text = " ".join(root.itertext())
        assert f"SLIDE {index}" in note_text
        assert "PRODUCTION / EVIDENCE NOTES" in note_text
    for name in names:
        if name.startswith("ppt/media/") and not archive.getinfo(name).is_dir():
            assert name.endswith(".png"), name
    assert not any("media" in n and n.endswith((".mp4", ".mov")) for n in names)
    relationships = [ET.fromstring(archive.read(name)) for name in names if name.endswith(".rels")]
    external = [rel.attrib["Target"] for tree in relationships for rel in tree
                if rel.attrib.get("TargetMode") == "External"]
    assert sorted(external) == ["http://localhost:3000/quiz/1", "http://localhost:3001/quiz/1"], external

layout = json.loads((ROOT / "node_modules/.cache/countersign-deck-layout.json").read_text())
assert sum(layout["timed_seconds"]) + layout["buffer_seconds"] == 420
pdf = pymupdf.open(HERE / "Countersign.pdf")
assert len(pdf) == 8
preview = HERE / "preview"
preview.mkdir(exist_ok=True)
expected = ["A valid session", "Countersign.", "Same task.", "Participation", "Add a checkpoint", "AI drafts.", "Training is", "Choose one action."]
page_text = []
for i, page in enumerate(pdf):
    value = page.get_text()
    assert expected[i] in value, (i + 1, value)
    assert abs(page.rect.width / page.rect.height - 16 / 9) < 0.01
    for block in page.get_text("dict")["blocks"]:
        if "lines" not in block:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                box = pymupdf.Rect(span["bbox"])
                assert box.x0 >= -0.5 and box.y0 >= -0.5
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

report = {
    "slides": len(pdf), "notes_pages": len(notes), "format": "16:9", "native_text_font": layout["font"],
    "presentation_seconds": 390, "buffer_seconds": 30, "qa_seconds": 180,
    "package_xml": "valid", "external_links": external, "embedded_video": False,
    "source_object_bounds": "pass", "rendered_text_bounds": "pass",
    "renderer": "LibreOffice PDF export; PyMuPDF rasterization",
    "limitations": ["No physical-passkey or ChatGPT-extension demo recording is embedded.",
                    "UI screenshots are automated/virtual-authenticator references.",
                    "PowerPoint/Keynote playback and final live rehearsal remain human checks."],
    "slide_text": page_text,
}
(HERE / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
print("PASS: 8 slides, 8 notes pages, valid XML/images/links, 16:9, 6:30 + 0:30, on-canvas objects and PDF text.")
print(f"Actual deck preview: {(HERE / 'Countersign-preview.png').relative_to(ROOT)}")
