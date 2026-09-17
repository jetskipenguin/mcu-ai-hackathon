"""Read-only demo edit/hash validation and full FFmpeg decode (no ffprobe).

From the repository root:
  PYTHONPATH="$PWD/node_modules/.cache/recording-python" \
    python3 docs/presentation/verify-demo-video.py

The default source copies are in node_modules/.cache/demo-recording/user-takes.
Use --sources to select another directory containing the manifest's cache files.
This checks declared edit continuity and decoded timestamps, not slide-app
playback or a visual comparison against the original recordings.
"""

import argparse
from datetime import datetime
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import re
import subprocess

import imageio_ffmpeg


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
FPS, FRAMES = 30, 2265
DURATION = Fraction("75.5")


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def seconds(value):
    return Fraction(str(value))


def validate_manifest(plan, metadata, source_dir):
    assert plan["version"] == 1
    assert plan["output"] == metadata["output"] == "Countersign-demo.mp4"
    assert [plan["width"], plan["height"]] == metadata["size"] == [1920, 1080]
    assert plan["fps"] == metadata["fps"] == FPS and metadata["audio"] is False
    assert seconds(plan["expected_duration_seconds"]) == seconds(metadata["duration_seconds"]) == DURATION
    assert set(plan["inputs"]) == {"off", "on"}
    source_hashes = {}
    for key, source in plan["inputs"].items():
        assert Path(source["cache_file"]).name == source["cache_file"], "Source must be a local cache filename"
        digest = sha256(source_dir / source["cache_file"])
        assert digest == source["sha256"], f"Source hash mismatch: {key}"
        source_hashes[key] = digest

    allowed_keys = {
        "title": {"kind", "stage", "seconds"},
        "video": {"kind", "stage", "input", "start", "end", "view"},
        "proof-still": {"kind", "stage", "input", "source_time", "seconds"},
    }
    assert len(plan["segments"]) == len(metadata["segments"])
    cursor, frames = Fraction(0), 0
    for index, (planned, actual) in enumerate(zip(plan["segments"], metadata["segments"])):
        assert set(planned) == allowed_keys[planned["kind"]], f"Unexpected edit/retiming field in segment {index}"
        assert set(actual) == set(planned) | {"output_start", "output_end", "frames"}, index
        assert all(actual[key] == value for key, value in planned.items()), f"Edit/metadata disagreement: segment {index}"
        if planned["kind"] == "video":
            assert planned["input"] in plan["inputs"] and planned["view"] in ("browser", "confirmation")
            assert seconds(planned["start"]) >= 0
            duration = seconds(planned["end"]) - seconds(planned["start"])
        else:
            duration = seconds(planned["seconds"])
            if planned["kind"] == "proof-still":
                assert planned["input"] in plan["inputs"] and seconds(planned["source_time"]) >= 0
        assert duration > 0 and (duration * FPS).denominator == 1, index
        assert seconds(actual["output_start"]) == cursor, f"Output gap/overlap: segment {index}"
        assert seconds(actual["output_end"]) == cursor + duration, f"Retimed segment: {index}"
        assert actual["frames"] == duration * FPS, f"Frame count mismatch: segment {index}"
        cursor += duration
        frames += actual["frames"]
    assert cursor == DURATION and frames == FRAMES

    assert plan["continuous_confirmation_source_interval"] == [34, 56.5]
    confirmation = [(i, segment) for i, segment in enumerate(metadata["segments"])
                    if segment["kind"] == "video" and segment["input"] == "on"
                    and seconds(segment["start"]) < seconds(56.5) and seconds(segment["end"]) > 34]
    assert len(confirmation) == 2
    (first_index, first), (second_index, second) = confirmation
    assert second_index == first_index + 1, "Confirmation segments must be adjacent, with no intervening still/title"
    assert [(s["start"], s["end"], s["view"]) for _, s in confirmation] == [
        (34, 41.5, "browser"), (41.5, 56.5, "confirmation"),
    ], "Confirmation must retain the complete 34–56.5s interval; only the crop changes at 41.5s"
    assert first["output_end"] == second["output_start"]
    assert seconds(second["output_end"]) - seconds(first["output_start"]) == seconds(22.5)

    evidence = metadata["evidence"]
    assert evidence == plan["evidence"] and metadata["editing_rules"] == plan["editing_rules"]
    assert evidence["action"] == "POST /quiz/1/submit" and evidence["rule_id"] == "quiz-submit"
    assert evidence["event_id"] == "evt_3ea776d201de4b59961e7123fa571fd3"
    assert evidence["assertion_id"] == "asr_20a3eda1-bc17-4d87-ba58-2e44c966eaf8"
    assert evidence["up"] is True and evidence["uv"] is True and evidence["age_ms"] == 6775
    requested = datetime.fromisoformat(evidence["presence_requested_at"].replace("Z", "+00:00"))
    verified = datetime.fromisoformat(evidence["verified_at"].replace("Z", "+00:00"))
    assert round((verified - requested).total_seconds() * 1000) == evidence["age_ms"]
    return {
        "source_hashes": source_hashes, "source_hashes_match_manifest": True,
        "manifest_timing": "pass",
        "confirmation_continuity": {
            "basis": "Edit manifest and output-segment durations; source-to-output visual comparison is separate.",
            "source_input": "on", "source_interval_seconds": [34, 56.5],
            "output_interval_seconds": [first["output_start"], second["output_end"]],
            "crop_change_source_seconds": 41.5, "playback_rate": 1,
            "adjacent_segments": True, "retiming": False,
        },
        "recorded_action_from_manifest": evidence,
    }


def metadata_tags(header):
    """Read entries below Metadata: headings without consuming another line."""
    tags, block_indent = [], None
    for line in header.splitlines():
        indent = len(line) - len(line.lstrip())
        if block_indent is not None and indent > block_indent:
            tag = re.fullmatch(r"[ \t]+([^:]+?)[ \t]*:[ \t]*(.*)", line)
            assert tag is not None, "Malformed FFmpeg metadata entry"
            tags.append((tag[1].strip(), tag[2]))
        else:
            block_indent = indent if line.strip() == "Metadata:" else None
    return tags


def decode_video(video_path):
    # showinfo logs each decoded frame's native timestamp/format. No -r, seek,
    # duration cap, or fps filter: all input frames must reach the null sink.
    command = [
        imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-nostdin", "-loglevel", "info",
        "-xerror", "-err_detect", "explode", "-threads", "4", "-i", str(video_path),
        "-map", "0:v:0", "-an", "-vf", "showinfo", "-fps_mode", "passthrough", "-f", "null", "-",
    ]
    result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, timeout=300)
    if result.returncode:
        raise RuntimeError("FFmpeg decode failed:\n" + "\n".join(result.stderr.splitlines()[-20:]))
    header, separator, _ = result.stderr.partition("Stream mapping:")
    assert separator, "FFmpeg input metadata missing"
    streams = re.findall(r"^\s*Stream #0:[^\n]+", header, re.MULTILINE)
    assert len(streams) == 1 and "Video: h264" in streams[0], "Expected one H.264 video stream and no audio/data streams"
    assert re.search(r"\byuv420p\b", streams[0]), streams[0]
    assert re.search(r"\b1920x1080\b", streams[0]), streams[0]
    fps = re.search(r"\b([\d.]+) fps\b", streams[0])
    assert fps and seconds(fps[1]) == FPS, streams[0]
    duration = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?),", header)
    assert duration and int(duration[1]) * 3600 + int(duration[2]) * 60 + seconds(duration[3]) == DURATION, "Container duration"

    # Allow only ordinary export/container tags, not original-device identifiers.
    tags = metadata_tags(header)
    allowed_tags = {"major_brand", "minor_version", "compatible_brands", "encoder", "language", "handler_name", "vendor_id"}
    for key, value in tags:
        assert key.strip() in allowed_tags, f"Unexpected exported metadata tag: {key.strip()}"
        assert not re.search(r"com\.apple|macbook|imac|iphone|ipad|hardware|serial|macos", value, re.IGNORECASE), "Source hardware metadata in export"

    time_base, frame_count = None, 0
    color_tags = set()
    for line in result.stderr.splitlines():
        if "showinfo" not in line:
            continue
        config = re.search(r"config in time_base:\s*(\d+/\d+),\s*frame_rate:\s*(\d+/\d+)", line)
        if config:
            time_base = Fraction(config[1])
            assert Fraction(config[2]) == FPS, "Decoded frame rate"
        frame = re.search(r"\bn:\s*\d+\s+pts:\s*(-?\d+)\s+pts_time:\S+.*?\bfmt:(\S+).*?\bs:(\d+)x(\d+)\b", line)
        if frame:
            assert time_base is not None, "Missing decode time base"
            assert int(frame[1]) * time_base == Fraction(frame_count, FPS), f"Non-continuous 30fps timestamp at frame {frame_count}"
            assert frame[2] == "yuv420p" and (int(frame[3]), int(frame[4])) == (1920, 1080), f"Decoded format changed at frame {frame_count}"
            frame_count += 1
        colors = re.search(r"color_range:(\S+) color_space:(\S+) color_primaries:(\S+) color_trc:(\S+)", line)
        if colors:
            color_tags.add(colors.groups())
    assert frame_count == FRAMES, f"Decoded {frame_count} frames; expected {FRAMES}"
    return {
        "decoder": "FFmpeg via imageio_ffmpeg; complete decode to null sink with showinfo",
        "codec": "h264", "pixel_format": "yuv420p", "size": [1920, 1080], "fps": FPS,
        "duration_seconds": float(DURATION), "audio": False, "frames_decoded": frame_count,
        "all_frame_timestamps": "pass (0 through 2264/30 seconds, no gaps or retiming of the output clock)",
        "color_tags": [dict(zip(("range", "space", "primaries", "transfer"), values)) for values in sorted(color_tags)],
        "export_metadata_keys": sorted({key.strip() for key, _ in tags}),
        "source_hardware_metadata": "absent from FFmpeg-reported container/stream metadata",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", type=Path, default=ROOT / "node_modules/.cache/demo-recording/user-takes")
    args = parser.parse_args()
    plan_path, metadata_path = HERE / "demo-edit.json", HERE / "demo-video.json"
    plan_bytes, metadata_bytes = plan_path.read_bytes(), metadata_path.read_bytes()
    plan, metadata = json.loads(plan_bytes), json.loads(metadata_bytes)
    manifest = validate_manifest(plan, metadata, args.sources)
    video_path = HERE / metadata["output"]
    digest = sha256(video_path)
    assert digest == metadata["sha256"], "Standalone MP4 SHA-256 does not match current demo-video.json"
    assert video_path.stat().st_size == metadata["bytes"], "Standalone MP4 byte count does not match metadata"
    decoded = decode_video(video_path)
    assert sha256(video_path) == digest, "MP4 changed during validation; rerun after encoding finishes"
    assert plan_path.read_bytes() == plan_bytes and metadata_path.read_bytes() == metadata_bytes, "Manifests changed during validation"
    report = {
        "status": "pass", "filename": video_path.name, "sha256": digest, "bytes": metadata["bytes"],
        "edit_manifest_sha256": hashlib.sha256(plan_bytes).hexdigest(),
        "video_metadata_sha256": hashlib.sha256(metadata_bytes).hexdigest(),
        **decoded, **manifest, "powerpoint_keynote_playback": "not_tested",
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
