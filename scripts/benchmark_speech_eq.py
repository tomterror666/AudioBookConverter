#!/usr/bin/env python3
"""
Offline FFmpeg speech-EQ benchmark (historical).

The app now uses music + short title ASR in ``whisper_chapter_scan.py`` for chapters.
This benchmark is disabled; use a real book folder with the main app or run:

  python3 whisper_chapter_scan.py --root-dir ... --model-size tiny --device cpu ...

with the same venv as the macOS app (~/.audioBookConverter).
"""
from __future__ import annotations

import sys


def main() -> int:
    print(
        "benchmark_speech_eq.py: no longer used (music-based chapter scanner).",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
