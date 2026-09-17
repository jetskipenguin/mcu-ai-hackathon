"""Make the documented, silent presentation edit from verified source copies.

Pillow + imageio-ffmpeg are cache-only tools. Original recordings are read-only.
The explicit edit list and continuous confirmation interval are in demo-edit.json.
"""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess

import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("--sources", type=Path, default=ROOT / "node_modules/.cache/demo-recording/user-takes")
args = parser.parse_args()
plan = json.loads((HERE / "demo-edit.json").read_text())
work = ROOT / "node_modules/.cache/demo-recording/edit"
work.mkdir(exist_ok=True)
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
W, H, FPS = plan["width"], plan["height"], plan["fps"]
NAVY, MINT, WHITE, SLATE, AMBER = "#10243a", "#bcf58a", "#ffffff", "#adbecd", "#f6c66c"
sources = {}


def sha(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


for name, item in plan["inputs"].items():
    source = args.sources / item["cache_file"]
    assert sha(source) == item["sha256"], f"Source changed: {name}"
    sources[name] = source


def font(size, bold=False):
    # Standard installed macOS fonts; fall back for reproducible non-Mac tooling.
    name = "Arial Bold.ttf" if bold else "Arial.ttf"
    try:
        return ImageFont.truetype(f"/System/Library/Fonts/Supplemental/{name}", size)
    except OSError:
        return ImageFont.load_default(size=size)


def run(arguments):
    subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", *arguments], check=True)


def frame(key, second, output):
    run(["-ss", str(second), "-i", str(sources[key]), "-frames:v", "1", "-update", "1", str(output)])
    return Image.open(output).convert("RGB")


def overlay(stage, detail=False):
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, W, 105), fill=NAVY)
    draw.rectangle((0, 1018, W, H), fill=NAVY)
    label = {"off": "GOVERNANCE OFF", "on": "GOVERNANCE ON", "proof": "VERIFIED ACTION"}[stage]
    subtitle = {"off": "No per-action presence check", "on": "Fresh human confirmation required", "proof": "The matching server-side record"}[stage]
    draw.rounded_rectangle((38, 23, 448, 82), radius=14, fill=AMBER if stage == "off" else MINT)
    draw.text((61, 36), label, font=font(30, True), fill=NAVY)
    draw.text((489, 35), subtitle, font=font(31, True), fill=WHITE)
    draw.text((1692, 41), "RECORDED", font=font(23, True), fill=SLATE)
    footer = ("Continuous confirmation - real time, no time cut" if detail else
              "Chrome + ChatGPT extension  |  Waiting intervals trimmed; retained footage is real time")
    draw.text((43, 1035), footer, font=font(24), fill=SLATE)
    return canvas


def title_card(stage):
    image = Image.new("RGB", (W, H), NAVY)
    draw = ImageDraw.Draw(image)
    number = "01" if stage == "off" else "02"
    draw.text((112, 118), "COUNTERSIGN / RECORDED DEMO", font=font(30, True), fill=MINT)
    draw.text((108, 311), f"{number}  Governance {stage}", font=font(88, True), fill=WHITE)
    subtitle = "The assistant submits." if stage == "off" else "The application requires a human."
    draw.text((112, 453), subtitle, font=font(58), fill=MINT)
    draw.text((114, 768), "Same quiz. Same request. Same extension.", font=font(37), fill=WHITE)
    draw.text((114, 972), "Recorded in Chrome. Waiting intervals trimmed. Confirmation remains continuous.", font=font(24), fill=SLATE)
    return image


def proof_still():
    source = frame("on", 78, work / "audit-source-78.png")
    # Real code-block detail: omit session/user fields above route/action.
    crop = source.crop((1400, 790, 2055, 1372))
    private = ImageDraw.Draw(crop)
    private.rectangle((0, 365, crop.width, 441), fill="#e5ebf0")
    private.text((21, 387), "credential ID omitted", font=font(20), fill="#54647b")
    image = Image.new("RGB", (W, H), NAVY)
    image.paste(crop.resize((922, 819), Image.Resampling.LANCZOS), (938, 157))
    draw = ImageDraw.Draw(image)
    draw.text((78, 169), "THE RECORD", font=font(28, True), fill=MINT)
    draw.text((74, 268), "Human presence", font=font(60, True), fill=WHITE)
    draw.text((74, 344), "verified.", font=font(68, True), fill=MINT)
    draw.text((79, 514), "quiz-submit", font=font(42, True), fill=WHITE)
    draw.text((80, 601), "A fresh assertion for", font=font(35), fill=SLATE)
    draw.text((80, 648), "this submission.", font=font(35), fill=SLATE)
    draw.text((80, 789), "Presence + user verification", font=font(30), fill=WHITE)
    draw.text((80, 836), "UP = true    UV = true", font=font(32, True), fill=MINT)
    header = overlay("proof")
    image.paste(header, (0, 0), header)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 1018, W, H), fill=NAVY)
    draw.text((43, 1035), "Audit detail: still from this recording  |  Session data omitted; credential identifier masked", font=font(23), fill=SLATE)
    image.save(HERE / "assets/demo-proof.png", optimize=True)
    return image


def canvas_video_filter(view, stage):
    # Browser-only crop removes the macOS menu and Dock. The detail view changes
    # framing, never elapsed time, across the uninterrupted confirmation interval.
    crop = (40, 80, 2860, 1660) if view == "browser" else (140, 520, 2200, 1100)
    x, y, w, h = crop
    sw = int(min(1856 / w, 904 / h) * w) // 2 * 2
    sh = int(min(1856 / w, 904 / h) * h) // 2 * 2
    px, py = (W - sw) // 2, 110 + (904 - sh) // 2
    return (f"[0:v]setpts=PTS-STARTPTS,crop={w}:{h}:{x}:{y},scale={sw}:{sh}:flags=lanczos,"
            f"pad={W}:{H}:{px}:{py}:color=0x10243a[framed];"
            "[framed][1:v]overlay=0:0:shortest=1,fps=30,setsar=1,"
            "scale=iw:ih:out_color_matrix=bt709:out_range=tv,format=yuv420p[out]")


encode = ["-an", "-map_metadata", "-1", "-c:v", "libx264", "-preset", "fast", "-crf", "18",
          "-profile:v", "high", "-level:v", "4.1", "-pix_fmt", "yuv420p", "-r", str(FPS),
          "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
          "-threads", "4", "-movflags", "+faststart"]
segments = []
cursor = 0.0
for index, item in enumerate(plan["segments"]):
    duration = item.get("seconds", item.get("end", 0) - item.get("start", 0))
    output = work / f"part-{index:02d}.mp4"
    arguments = []
    if item["kind"] == "video":
        layer = work / f"overlay-{index:02d}.png"
        overlay(item["stage"], item["view"] == "confirmation").save(layer)
        arguments = ["-ss", str(item["start"]), "-i", str(sources[item["input"]]),
                     "-loop", "1", "-i", str(layer), "-filter_complex_threads", "2",
                     "-filter_complex", canvas_video_filter(item["view"], item["stage"]), "-map", "[out]"]
    else:
        still = work / f"still-{index:02d}.png"
        (proof_still() if item["kind"] == "proof-still" else title_card(item["stage"])).save(still)
        arguments = ["-loop", "1", "-framerate", str(FPS), "-i", str(still),
                     "-vf", "scale=1920:1080:out_color_matrix=bt709:out_range=tv,setsar=1,format=yuv420p"]
    frames = round(duration * FPS)
    assert abs(frames / FPS - duration) < 0.001
    run([*arguments, "-frames:v", str(frames), *encode, str(output)])
    segments.append({**item, "output_start": cursor, "output_end": cursor + duration, "frames": frames})
    cursor += duration
    print(f"Encoded segment {index + 1}/{len(plan['segments'])}: {duration:g}s", flush=True)

assert abs(cursor - plan["expected_duration_seconds"]) < 0.001
# Require source continuity throughout the entire protected interval, including
# across the spatial zoom. No retiming operation is present in either filter.
continuity = [s for s in segments if s.get("input") == "on" and s.get("start", -1) in [34, 41.5]]
assert [(s["start"], s["end"]) for s in continuity] == [(34, 41.5), (41.5, 56.5)]
assert continuity[0]["output_end"] == continuity[1]["output_start"]
listing = work / "concat.txt"
listing.write_text("".join(f"file '{(work / f'part-{i:02d}.mp4').as_posix()}'\n" for i in range(len(segments))))
output = HERE / plan["output"]
run(["-f", "concat", "-safe", "0", "-i", str(listing), "-map", "0:v:0", "-c", "copy", "-an",
     "-map_metadata", "-1", "-movflags", "+faststart", str(output)])

# Make a truthful cover from the real native-prompt moment in the finished edit.
poster_time = next(s["output_start"] for s in segments if s.get("view") == "confirmation") + 3.5
run(["-ss", str(poster_time), "-i", str(output), "-frames:v", "1", "-update", "1", str(HERE / "assets/demo-poster.png")])
poster = Image.open(HERE / "assets/demo-poster.png").convert("RGB")
draw = ImageDraw.Draw(poster)
draw.rounded_rectangle((1390, 913, 1876, 993), radius=18, fill=NAVY, outline=MINT, width=2)
draw.text((1420, 936), "CLICK TO PLAY  |  1:15", font=font(30, True), fill=MINT)
poster.save(HERE / "assets/demo-poster.png", optimize=True)
report = {"output": plan["output"], "sha256": sha(output), "bytes": output.stat().st_size,
          "duration_seconds": cursor, "fps": FPS, "size": [W, H], "audio": False,
          "segments": segments, "evidence": plan["evidence"], "editing_rules": plan["editing_rules"],
          "derived_assets": {
              "assets/demo-poster.png": {"sha256": sha(HERE / "assets/demo-poster.png"),
                                         "source": "on", "source_time_seconds": 45,
                                         "treatment": "Real prompt frame from final edit; play-button annotation."},
              "assets/demo-proof.png": {"sha256": sha(HERE / "assets/demo-proof.png"),
                                        "source": "on", "source_time_seconds": 78,
                                        "treatment": "Real audit still; session data cropped out, credential identifier visibly masked, editor annotations."}
          },
          "sources_unchanged": all(sha(sources[k]) == v["sha256"] for k, v in plan["inputs"].items())}
assert report["sources_unchanged"]
(HERE / "demo-video.json").write_text(json.dumps(report, indent=2) + "\n")
print(f"Created {output.name}: {cursor:g}s, {output.stat().st_size / 1024 / 1024:.2f} MiB; source hashes unchanged.")
