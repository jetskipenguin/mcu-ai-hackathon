"""Make documented, unretouched crops of real app UI for the deck.

Run with Pillow available; --capture-dir names the isolated capture handoff.
This script does not contact the app, an LLM, or a credential store.
"""

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("--capture-dir", type=Path, required=True)
args = parser.parse_args()
args.capture_dir = args.capture_dir.resolve()
output = HERE / "assets"
output.mkdir(exist_ok=True)

sources = [
    (
        ROOT / "docs/build-log/presentation-quiz-desktop.png",
        "quiz-submit.png",
        (160, 2250, 1120, 2740),
        "Governed quiz UI; automated layout capture. Not a pending native prompt or an extension run.",
    ),
    (
        ROOT / "docs/build-log/presentation-record-desktop.png",
        "record-masked.png",
        (68, 805, 742, 997),
        "Default-masked synthetic record fields; automated layout capture, not a completed reveal.",
    ),
    (
        args.capture_dir / "discussion-ai-assisted-virtual-post.png",
        "discussion-disclosure.png",
        (38, 180, 850, 315),
        "Actual published disclosure badges from an isolated Chrome virtual-authenticator flow. Not physical-sensor or ChatGPT-extension evidence.",
    ),
    (
        args.capture_dir / "policy-current-quiz-summary.png",
        "policy-rule-heading.png",
        (36, 28, 1090, 155),
        "Current policy-review quiz rule. Active and draft are identical; no model generation or approval was performed for capture.",
    ),
    (
        args.capture_dir / "policy-current-quiz-summary.png",
        "policy-approve-control.png",
        (342, 351, 672, 450),
        "The real per-rule approval control, cropped separately. No approval was performed.",
    ),
]

manifest = []
for source, name, box, status in sources:
    with Image.open(source) as image:
        assert image.format == "PNG", source
        assert 0 <= box[0] < box[2] <= image.width, (source, box, image.size)
        assert 0 <= box[1] < box[3] <= image.height, (source, box, image.size)
        crop = image.crop(box).convert("RGB")
        crop.save(output / name, optimize=True)
        manifest.append({
            "asset": name,
            "source": str(source.relative_to(ROOT)),
            "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "source_size": list(image.size),
            "crop_box": list(box),
            "size": list(crop.size),
            "status": status,
        })

(output / "sources.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(f"Prepared {len(manifest)} real-UI crops in {output.relative_to(ROOT)}")
