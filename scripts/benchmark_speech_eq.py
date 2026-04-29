#!/usr/bin/env python3
"""
Offline benchmark: vary FFmpeg speech EQ on real MP3s, run faster-whisper + chapter detection.

Example corpus: ~/myProjects/Books/Silber Edition 27 - Andromeda (tiny CPU): preset ``hp120_g28``
(highpass 120 Hz, EQ unchanged) scored 4/4 vs ``current`` (100 Hz) 3/4 on Zeittafel/Prolog/Kapitel 1/3.

Requires app venv Python with faster-whisper:

  ~/.audioBookConverter/bin/python3 scripts/benchmark_speech_eq.py
"""
from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import tempfile
from pathlib import Path

BOOK = Path.home() / "myProjects/Books/Silber Edition 27 - Andromeda"
SCRIPT_DIR = Path(__file__).resolve().parent
WCS_PATH = SCRIPT_DIR / "whisper_chapter_scan.py"

# Presets to compare (name -> ffmpeg -af string or None = no filters).
VARIANTS: dict[str, str | None] = {
    "current": "highpass=f=100,equalizer=f=2800:width_type=h:width=2200:g=2.5",
    "hp120_g28": "highpass=f=120,equalizer=f=2800:width_type=h:width=2200:g=2.5",
    "hp140_g28": "highpass=f=140,equalizer=f=2800:width_type=h:width=2200:g=2.5",
    "eq3000": "highpass=f=100,equalizer=f=3000:width_type=h:width=2400:g=2.5",
    "gain32": "highpass=f=100,equalizer=f=2800:width_type=h:width=2200:g=3.2",
    "gain18": "highpass=f=100,equalizer=f=2800:width_type=h:width=2200:g=1.8",
    "combo": "highpass=f=120,equalizer=f=3000:width_type=h:width=2400:g=3.0",
    "none": None,
}

CASES: list[tuple[str, float, str]] = [
    # file (under BOOK), head seconds, expected chapter label
    ("001_PRSE27_Andromeda.mp3", 60.0, "Zeittafel"),
    ("002_PRSE27_Andromeda.mp3", 45.0, "Prolog"),
    ("003_PRSE27_Andromeda.mp3", 45.0, "Kapitel 1"),
    ("009_PRSE27_Andromeda.mp3", 45.0, "Kapitel 3"),
]


def load_wcs():
    spec = importlib.util.spec_from_file_location("whisper_chapter_scan", WCS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {WCS_PATH}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def extract_wav(
    ffmpeg_bin: str,
    src: Path,
    duration_sec: float,
    af: str | None,
) -> Path:
    fd, out_name = tempfile.mkstemp(suffix=".wav", prefix="bench_eq_")
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
    ]
    if af:
        cmd.extend(["-af", af])
    cmd.extend(
        ["-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", str(out_path)]
    )
    subprocess.run(cmd, check=True, stderr=subprocess.PIPE)
    return out_path


def main() -> int:
    if not BOOK.is_dir():
        print(f"Book folder not found: {BOOK}", file=sys.stderr)
        return 1
    wcs = load_wcs()
    ffmpeg_bin = "ffmpeg"
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        print(e, file=sys.stderr)
        return 1

    model = WhisperModel(
        "tiny",
        device="cpu",
        compute_type="int8_float32",
    )

    ordered_mp3 = sorted(BOOK.rglob("*.mp3"))
    mp3_index_by_name = {p.name: i for i, p in enumerate(ordered_mp3)}
    n_mp3 = len(ordered_mp3)

    results: dict[str, list[bool]] = {k: [] for k in VARIANTS}

    for vname, af in VARIANTS.items():
        for fname, head_sec, expected in CASES:
            mp3 = BOOK / fname
            if not mp3.is_file():
                print(f"missing {mp3}", file=sys.stderr)
                results[vname].append(False)
                continue
            wav: Path | None = None
            try:
                wav = extract_wav(ffmpeg_bin, mp3, head_sec, af)
                segments = wcs.transcribe_file(model, wav, "de")
                words = wcs.words_from_segments(segments)
                marks = wcs.find_chapter_marks_for_file(
                    words,
                    segments,
                    str(mp3.resolve()),
                    "de",
                    mp3_index=mp3_index_by_name.get(mp3.name, 0),
                    mp3_count=n_mp3,
                )
                labels = {m.get("label") for m in marks}
                ok = expected in labels
                results[vname].append(ok)
            except Exception as exc:
                print(f"{vname} {fname}: {exc}", file=sys.stderr)
                results[vname].append(False)
            finally:
                if wav is not None and wav.exists():
                    try:
                        wav.unlink()
                    except OSError:
                        pass

    print("Benchmark: tiny CPU int8_float32, chapter cue de")
    print(f"Book: {BOOK}\n")
    header = f"{'preset':<14}" + "".join(f"{c[0][:12]:>14}" for c in CASES)
    print(header)
    print("-" * len(header))
    for vname in VARIANTS:
        row = f"{vname:<14}"
        for ok in results[vname]:
            row += f"{'OK' if ok else 'MISS':>14}"
        score = sum(results[vname])
        row += f"   total {score}/{len(CASES)}"
        print(row)

    best = max(VARIANTS.keys(), key=lambda k: sum(results[k]))
    print(f"\nBest preset by exact label match: {best} ({sum(results[best])}/{len(CASES)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
