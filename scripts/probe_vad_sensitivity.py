#!/usr/bin/env python3
"""
Probe Silero VAD (music vs speech) sensitivity for chapter scanning.

For each VadOptions grid point: decode head audio → first speech t₀ → transcribe head_sec
after t₀; if no chapter, transcribe fallback_sec from file start (matches whisper_chapter_scan
logic for non-first files).

Example:
  python3 scripts/probe_vad_sensitivity.py \\
    --mp3 tests/chapter_scan_fixtures/samples/004_Kapitel_3.mp3 \\
    --ffmpeg "$(command -v ffmpeg)" --model medium --device cpu --compute-type int8
"""
from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

# Repo scripts on path
_REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_REPO / "scripts"))

import whisper_chapter_scan as wcs  # noqa: E402


def _vad_first_speech_sec(audio, opts) -> float:
    from faster_whisper.vad import get_speech_timestamps

    chunks = get_speech_timestamps(audio, opts, sampling_rate=16000)
    if not chunks:
        return 0.0
    return max(0.0, int(chunks[0]["start"]) / 16000.0)


def _run_non_first_pipeline(
    model,
    mp3: Path,
    ffmpeg: str,
    opts,
    *,
    head_sec: float,
    fallback_sec: float,
    language: str,
    chapter_cue: str,
) -> tuple[float, str, str, str]:
    """
    Returns (t0, pass_label, detected_label, notes).
    pass_label: 'vad+head' | 'fallback'
    """
    from faster_whisper.audio import decode_audio

    search_wav = wcs.extract_head_wav(ffmpeg, mp3, wcs.VAD_MAX_SEARCH_SEC)
    try:
        audio = decode_audio(str(search_wav), sampling_rate=16000)
    finally:
        if search_wav.exists():
            search_wav.unlink()

    t0 = _vad_first_speech_sec(audio, opts)

    trans_wav = wcs.extract_wav_segment(ffmpeg, mp3, t0, head_sec)
    try:
        segments = wcs.transcribe_file(model, trans_wav, language)
        words = wcs.words_from_segments(segments)
        marks = wcs.find_chapter_marks_for_file(
            words, segments, str(mp3.resolve()), chapter_cue
        )
        if marks:
            lab = marks[0].get("label", "")
            return (t0, "vad+head", lab, "")
    finally:
        if trans_wav.exists():
            trans_wav.unlink()

    trans_wav = wcs.extract_wav_segment(ffmpeg, mp3, 0, fallback_sec)
    try:
        segments = wcs.transcribe_file(model, trans_wav, language)
        words = wcs.words_from_segments(segments)
        marks = wcs.find_chapter_marks_for_file(
            words, segments, str(mp3.resolve()), chapter_cue
        )
        lab = marks[0].get("label", "") if marks else "(none)"
        return (t0, "fallback", lab, "chapter only after fallback window")
    finally:
        if trans_wav.exists():
            trans_wav.unlink()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mp3", type=Path, required=True)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--model-size", default="medium")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--language", default="de")
    parser.add_argument("--chapter-cue", choices=("de", "en"), default="de")
    parser.add_argument("--head-seconds", type=float, default=wcs.HEAD_SECONDS_DEFAULT)
    parser.add_argument(
        "--fallback-seconds",
        type=float,
        default=wcs.FALLBACK_FROM_START_SECONDS_DEFAULT,
    )
    parser.add_argument(
        "--vad-only",
        action="store_true",
        help="Only print first-speech t₀ (no Whisper); fast grid.",
    )
    parser.add_argument(
        "--whisper-grid",
        choices=("all", "threshold", "silence", "pad"),
        default="threshold",
        help=(
            "Which Vad sweeps to run with Whisper (ignored with --vad-only). "
            "Default threshold only — fastest meaningful sweep for music vs speech."
        ),
    )
    args = parser.parse_args()

    mp3 = args.mp3.expanduser().resolve()
    if not mp3.is_file():
        print(f"Not a file: {mp3}", file=sys.stderr)
        sys.exit(1)

    from faster_whisper import WhisperModel
    from faster_whisper.audio import decode_audio
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    search_wav = wcs.extract_head_wav(args.ffmpeg, mp3, wcs.VAD_MAX_SEARCH_SEC)
    audio = decode_audio(str(search_wav), sampling_rate=16000)
    search_wav.unlink(missing_ok=True)

    # Match whisper_chapter_scan preset for a given model, e.g. medium → threshold 0.25
    thr, sil_ms, pad_ms = wcs.vad_params_for_whisper_model(args.model_size)
    baseline = VadOptions(
        threshold=thr,
        min_silence_duration_ms=sil_ms,
        speech_pad_ms=pad_ms,
    )

    # Grids
    thresholds = [0.25, 0.35, 0.45, 0.5, 0.55, 0.65, 0.75]
    silence_ms = [150, 300, 400, 600, 1200, 2000]
    pads_ms = [100, 200, 400, 600]

    print(f"MP3: {mp3}")
    print(f"Model: {args.model_size} (skipped if --vad-only)")
    print(
        f"Baseline VadOptions (whisper_chapter_scan preset for model {args.model_size!r}): "
        f"threshold={thr}, min_silence={sil_ms} ms, speech_pad={pad_ms} ms"
    )
    print()

    if args.vad_only:
        print("=== VAD-only: threshold sweep (min_silence=400 speech_pad=200) ===")
        print("thr\tt0_sec\tchunks")
        for thr in thresholds:
            o = VadOptions(
                threshold=thr,
                min_silence_duration_ms=400,
                speech_pad_ms=200,
            )
            ch = get_speech_timestamps(audio, o, sampling_rate=16000)
            t0 = _vad_first_speech_sec(audio, o)
            print(f"{thr}\t{t0:.3f}\t{len(ch)}")
        print()
        print("=== VAD-only: min_silence_duration_ms sweep (threshold=0.5 speech_pad=200) ===")
        print("sil_ms\tt0_sec\tchunks")
        for ms in silence_ms:
            o = VadOptions(
                threshold=0.5,
                min_silence_duration_ms=ms,
                speech_pad_ms=200,
            )
            ch = get_speech_timestamps(audio, o, sampling_rate=16000)
            t0 = _vad_first_speech_sec(audio, o)
            print(f"{ms}\t{t0:.3f}\t{len(ch)}")
        print()
        print("=== VAD-only: speech_pad_ms sweep (threshold=0.5 min_silence=400) ===")
        print("pad_ms\tt0_sec\tchunks")
        for pm in pads_ms:
            o = VadOptions(threshold=0.5, min_silence_duration_ms=400, speech_pad_ms=pm)
            ch = get_speech_timestamps(audio, o, sampling_rate=16000)
            t0 = _vad_first_speech_sec(audio, o)
            print(f"{pm}\t{t0:.3f}\t{len(ch)}")
        print()
        bl_t0 = _vad_first_speech_sec(audio, baseline)
        print(f"Baseline opts t0: {bl_t0:.3f} s")
        return

    print("Loading Whisper model…", file=sys.stderr)
    model = WhisperModel(
        args.model_size,
        device=args.device,
        compute_type=args.compute_type,
    )

    def row(tag: str, opts: VadOptions) -> None:
        t0, via, lab, note = _run_non_first_pipeline(
            model,
            mp3,
            args.ffmpeg,
            opts,
            head_sec=args.head_seconds,
            fallback_sec=args.fallback_seconds,
            language=args.language,
            chapter_cue=args.chapter_cue,
        )
        extra = f" ({note})" if note else ""
        print(f"{tag}\tt0={t0:.3f}s\t{via}\tlabel={lab}{extra}")

    wg = args.whisper_grid

    if wg in ("all", "threshold"):
        print("=== Whisper sweep: threshold (min_silence=400 speech_pad=200) ===")
        for thr in thresholds:
            o = VadOptions(threshold=thr, min_silence_duration_ms=400, speech_pad_ms=200)
            row(f"thr={thr}", o)

    if wg in ("all", "silence"):
        print()
        print("=== Whisper sweep: min_silence_duration_ms (thr=0.5 speech_pad=200) ===")
        for ms in silence_ms:
            o = VadOptions(threshold=0.5, min_silence_duration_ms=ms, speech_pad_ms=200)
            row(f"silence_ms={ms}", o)

    if wg in ("all", "pad"):
        print()
        print("=== Whisper sweep: speech_pad_ms (thr=0.5 min_silence=400) ===")
        for pm in pads_ms:
            o = VadOptions(threshold=0.5, min_silence_duration_ms=400, speech_pad_ms=pm)
            row(f"speech_pad_ms={pm}", o)

    if not args.vad_only:
        print()
        print("=== Production defaults (match whisper_chapter_scan.py) ===")
        row("baseline", baseline)


if __name__ == "__main__":
    main()
