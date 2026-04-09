#!/usr/bin/env python3
"""
For each MP3, transcribe only the first --head-seconds (default 45) with ffmpeg + faster-whisper,
find German “Kapitel” + number (word timestamps). Times refer to the full track (offset 0).
JSON to stdout, progress to stderr.
"""
import argparse
from datetime import datetime, timezone
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional

HEAD_SECONDS_DEFAULT = 45
CHAPTER_LOG_FILENAME = "AudiobookConverter_kapitel.log"


def format_timecode(seconds: float) -> str:
    if seconds < 0:
        seconds = 0.0
    ms = int(round((seconds % 1) * 1000))
    s = int(seconds) % 60
    m = (int(seconds) // 60) % 60
    h = int(seconds) // 3600
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def write_chapter_log(
    root: Path,
    all_marks: list,
    *,
    model_size: str,
    device: str,
    head_seconds: float,
) -> None:
    log_path = root / CHAPTER_LOG_FILENAME
    lines = [
        "AudioBookConverter — detected chapters (Whisper)",
        f"Project folder: {root}",
        (
            "Generated (UTC): "
            f"{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} UTC"
        ),
        f"Model: {model_size}, device: {device}, scan: first {head_seconds:.0f} s per MP3",
        "",
        f"Chapter markers found: {len(all_marks)}",
        "",
    ]

    if not all_marks:
        lines.extend(["(no chapters found in scan)", ""])
    else:
        by_file: dict[str, list] = {}
        for m in all_marks:
            fp = m.get("filePath", "")
            by_file.setdefault(fp, []).append(m)
        for fp in sorted(by_file.keys()):
            rel = fp
            try:
                rel = str(Path(fp).resolve().relative_to(root.resolve()))
            except ValueError:
                rel = Path(fp).name
            lines.append(f"--- {rel} ---")
            for m in sorted(by_file[fp], key=lambda x: float(x["startSec"])):
                label = m.get("label", "")
                sec = float(m["startSec"])
                tc = format_timecode(sec)
                lines.append(f"  {label} @ {sec:.3f} s  ({tc})")
            lines.append("")

        lines.append("— Table (file | chapter | seconds | timecode) —")
        for m in sorted(
            all_marks,
            key=lambda x: (x.get("filePath", ""), float(x["startSec"])),
        ):
            fp = m.get("filePath", "")
            try:
                file_col = str(Path(fp).resolve().relative_to(root.resolve()))
            except ValueError:
                file_col = Path(fp).name
            label = m.get("label", "")
            sec = float(m["startSec"])
            lines.append(
                f"{file_col}\t{label}\t{sec:.3f}\t{format_timecode(sec)}"
            )
        lines.append("")

    log_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Chapter log: {log_path}", file=sys.stderr, flush=True)


def iter_mp3_files(root: Path):
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix.lower() == ".mp3":
            yield path


def normalize_word(w: str) -> str:
    return re.sub(r"[^\wäöüß]", "", w, flags=re.I).lower()


def is_kapitel(w: str) -> bool:
    return normalize_word(w) == "kapitel"


def first_int_in(w: str):
    m = re.search(r"\d+", w)
    if m:
        return int(m.group(0))
    return None


def words_from_segments(segments):
    words = []
    for seg in segments:
        ws = getattr(seg, "words", None)
        if ws:
            words.extend(ws)
    return words


def dedupe_consecutive_same_chapter(marks: list) -> list:
    """
    Sort by file + time; merge consecutive entries with the same file and chapter number
    (keep the first position).
    """
    if len(marks) < 2:
        return marks
    ordered = sorted(
        marks,
        key=lambda m: (m.get("filePath", ""), float(m.get("startSec", 0))),
    )
    out: list = []
    for m in ordered:
        if out:
            prev = out[-1]
            if prev.get("filePath") == m.get("filePath") and prev.get("number") == m.get(
                "number"
            ):
                continue
        out.append(m)
    return out


def find_kapitel_marks_for_file(words, file_path_resolved: str):
    marks = []
    for i in range(len(words) - 1):
        if not is_kapitel(words[i].word):
            continue
        num = first_int_in(words[i + 1].word)
        if num is None:
            continue
        marks.append(
            {
                "filePath": file_path_resolved,
                "startSec": float(words[i].start),
                "number": num,
                "label": f"Chapter {num}",
            }
        )
    return marks


def extract_head_wav(ffmpeg_bin: str, src: Path, duration_sec: float) -> Path:
    fd, out_name = tempfile.mkstemp(suffix=".wav", prefix="abc_whisper_head_")
    os.close(fd)
    out_path = Path(out_name)
    cmd = [
        ffmpeg_bin,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(src),
        "-t",
        str(duration_sec),
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        str(out_path),
    ]
    subprocess.run(cmd, check=True, stderr=subprocess.PIPE)
    return out_path


def transcribe_file(model, wav_path: Path, language: str):
    # Short clip: no VAD so “Kapitel” at the start is not trimmed away
    segments, _info = model.transcribe(
        str(wav_path),
        language=language,
        word_timestamps=True,
        vad_filter=False,
    )
    return list(segments)


def main():
    try:
        sys.stderr.reconfigure(line_buffering=True)
    except (AttributeError, OSError, ValueError):
        pass
    parser = argparse.ArgumentParser()
    parser.add_argument("--root-dir", required=True)
    parser.add_argument("--model-size", required=True)
    parser.add_argument("--device", required=True)
    parser.add_argument("--compute-type", required=True)
    parser.add_argument("--language", default="de")
    parser.add_argument("--ffmpeg", required=True, help="Path to ffmpeg")
    parser.add_argument(
        "--head-seconds",
        type=float,
        default=HEAD_SECONDS_DEFAULT,
        help=f"Transcribe only the first N seconds (default: {HEAD_SECONDS_DEFAULT})",
    )
    args = parser.parse_args()

    root = Path(args.root_dir).expanduser().resolve()
    if not root.is_dir():
        print(f"Not a directory: {root}", file=sys.stderr)
        sys.exit(1)

    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)

    try:
        model = WhisperModel(
            args.model_size,
            device=args.device,
            compute_type=args.compute_type,
        )
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)

    all_marks = []
    mp3_list = list(iter_mp3_files(root))
    head_sec = max(0.5, float(args.head_seconds))

    nfiles = len(mp3_list)
    if nfiles > 0:
        print(f"[0/{nfiles}]", file=sys.stderr, flush=True)
    for idx, mp3 in enumerate(mp3_list, start=1):
        wav: Optional[Path] = None
        try:
            wav = extract_head_wav(args.ffmpeg, mp3, head_sec)
            segments = transcribe_file(model, wav, args.language)
        except subprocess.CalledProcessError as exc:
            print(f"{mp3}: ffmpeg {exc.stderr!r}", file=sys.stderr)
            sys.exit(1)
        except Exception as exc:
            print(f"{mp3}: {exc}", file=sys.stderr)
            sys.exit(1)
        finally:
            if wav is not None and wav.exists():
                try:
                    wav.unlink()
                except OSError:
                    pass

        words = words_from_segments(segments)
        if words:
            path_resolved = str(mp3.resolve())
            all_marks.extend(find_kapitel_marks_for_file(words, path_resolved))
        # One line per finished file for UI progress ([done/total]).
        print(f"[{idx}/{nfiles}]", file=sys.stderr, flush=True)

    all_marks = dedupe_consecutive_same_chapter(all_marks)

    try:
        write_chapter_log(
            root,
            all_marks,
            model_size=args.model_size,
            device=args.device,
            head_seconds=head_sec,
        )
    except OSError as exc:
        print(f"Could not write chapter log: {exc}", file=sys.stderr)
        sys.exit(1)

    json.dump({"marks": all_marks}, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
