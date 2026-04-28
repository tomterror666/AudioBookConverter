#!/usr/bin/env python3
"""
**First** MP3 in folder sort order (see ``iter_mp3_files``) is the typical “Zeittafel / intro”
track: a **long** window (``--first-file-head-seconds``, default 60 s) is transcribed **from
file start** (no VAD) so late cues after music still appear in the transcript.

**All other** MP3s use **Silero VAD** to skip leading music, then ``--head-seconds`` (default
20 s) from first speech. VAD probability **threshold** (and optional silence/pad ms) follow the
chosen Whisper **model size** — ``vad_params_for_whisper_model`` — unless overridden with
``--vad-threshold`` / ``--vad-min-silence-ms`` / ``--vad-speech-pad-ms``. If **no** chapter is found in that transcript, a **fallback** pass
transcribes ``--fallback-from-start-seconds`` (default 45 s) **from file start** (still
no Whisper VAD). ffmpeg + faster-whisper for the chapter: spoken special labels
(Zeittafel, Prolog, Epilog, Prologue, Epilogue) or “Kapitel/Chapter” + number. German: *Z* as
[s] in ASR (z→s), plus *Levenshtein* for stems like *Zeitfafel*; *Kapitel* may be clipped
(*Kapitl*) or misheard. **Compound specials** (e.g. *Zeit* + *Tafel* as two ASR words) and
matches in the **full** transcribed window are detected. If **Prolog/Prologue/Epilog** is
detected in more than one MP3, the **last** file in folder order is kept; duplicate
**Zeittafel** keeps the **first**. The chapter is placed at the **start of that MP3**
(startSec 0) on the merged timeline. JSON to stdout, progress to stderr.

Optional ``--listen-log-dir``: for each MP3, writes a UTF-8 file listing **all words**
Whisper returned (timestamps + text per line when word-level timestamps exist), with a
section per decode pass (first-file window, VAD+head, or fallback).
"""
import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Optional, Tuple

MAX_PARALLEL_WHISPER_WORKERS = 4

HEAD_SECONDS_DEFAULT = 20.0
# When VAD + head-seconds finds no chapter: second pass from t=0 (no VAD), this many seconds.
FALLBACK_FROM_START_SECONDS_DEFAULT = 45.0
# First MP3 in scan order: transcribe this many seconds from t=0 (no VAD) for long intros / Zeittafel.
FIRST_FILE_HEAD_SECONDS_DEFAULT = 60.0
# Decode at most this many seconds from the file start to run VAD (search for first speech).
VAD_MAX_SEARCH_SEC = 600.0
# Silero VAD defaults (see vad_params_for_whisper_model); CLI can override.
VAD_MIN_SILENCE_DURATION_MS_DEFAULT = 400
VAD_SPEECH_PAD_MS_DEFAULT = 200
CHAPTER_LOG_FILENAME = "AudiobookConverter_kapitel.log"
# Optional --listen-log-dir: one UTF-8 text file per MP3 with all transcribed words (per pass).


def vad_params_for_whisper_model(model_size: str) -> tuple[float, int, int]:
    """
    Silero VAD runs **before** Whisper; it only sees audio. Presets still vary with the chosen
    Whisper *mode* so UX stays aligned (tiny/base: slightly earlier speech gate; large-*:
    slightly stricter to reduce music mistaken as speech). Primary tuning: probability
    **threshold** (~0.23–0.27); silence duration / pad stay 400 / 200 ms unless overridden on CLI.

    Calibrated using ``scripts/probe_vad_sensitivity.py`` on German audiobook clips (early chapter
    cues vs sustained narration).
    """
    m = model_size.strip().lower()
    sil_ms = VAD_MIN_SILENCE_DURATION_MS_DEFAULT
    pad_ms = VAD_SPEECH_PAD_MS_DEFAULT
    if m.startswith("tiny"):
        return (0.23, sil_ms, pad_ms)
    if m == "base":
        return (0.24, sil_ms, pad_ms)
    if m in ("small", "medium"):
        return (0.25, sil_ms, pad_ms)
    if m.startswith("distil"):
        return (0.26, sil_ms, pad_ms)
    if "large" in m:
        return (0.27, sil_ms, pad_ms)
    return (0.25, sil_ms, pad_ms)


def whisper_model_is_cached_locally(model_size: str) -> bool:
    """
    True if faster-whisper can resolve the CTranslate2 snapshot from the HF cache
    without downloading (same check as WhisperModel uses via huggingface_hub).
    """
    from faster_whisper.utils import download_model

    try:
        download_model(model_size, local_files_only=True)
        return True
    except ValueError:
        raise
    except Exception:
        return False


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
    first_file_head_seconds: float,
    head_after_speech_seconds: float,
    fallback_from_start_seconds: float,
    vad_threshold: float,
    vad_min_silence_ms: int,
    vad_speech_pad_ms: int,
    chapter_cue: str,
) -> None:
    log_path = root / CHAPTER_LOG_FILENAME
    de = chapter_cue == "de"
    if de:
        title = "AudioBookConverter — erkannte Kapitel (Whisper)"
        count_line = f"Gefundene Kapitelmarkierungen: {len(all_marks)}"
        empty_line = "(keine Kapitel im Scan)"
        table_hdr = "— Tabelle (Datei | Kapitel | Sekunden | Timecode) —"
    else:
        title = "AudioBookConverter — detected chapters (Whisper)"
        count_line = f"Chapter markers found: {len(all_marks)}"
        empty_line = "(no chapters found in scan)"
        table_hdr = "— Table (file | chapter | seconds | timecode) —"
    lines = [
        title,
        f"Project folder: {root}",
        (
            "Generated (UTC): "
            f"{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} UTC"
        ),
        (
            f"Model: {model_size}, device: {device}, chapter cue: {chapter_cue}, "
            f"Silero VAD: threshold={vad_threshold:g}, min_silence={vad_min_silence_ms} ms, "
            f"speech_pad={vad_speech_pad_ms} ms; "
            f"scan: first MP3 = {first_file_head_seconds:.0f} s from start (no VAD); "
            f"rest = VAD + {head_after_speech_seconds:.0f} s from first speech, "
            f"else {fallback_from_start_seconds:.0f} s from file start if no chapter "
            f"(VAD search ≤ {VAD_MAX_SEARCH_SEC:.0f} s)"
        ),
        "",
        count_line,
        "",
    ]

    if not all_marks:
        lines.extend([empty_line, ""])
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

        lines.append(table_hdr)
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
    if de:
        print(f"Kapitel-Log: {log_path}", file=sys.stderr, flush=True)
    else:
        print(f"Chapter log: {log_path}", file=sys.stderr, flush=True)


def iter_mp3_files(root: Path):
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix.lower() == ".mp3":
            yield path


def normalize_word_de(w: str) -> str:
    return re.sub(r"[^\wäöüß]", "", w, flags=re.I).lower()


def normalize_word_en(w: str) -> str:
    return re.sub(r"[^\w]", "", w, flags=re.I).lower()


def number_chapter_label(num: int, chapter_cue: str) -> str:
    """Spoken-cue-consistent label for regular numbered chapters in JSON, logs, and mux."""
    if chapter_cue == "en":
        return f"Chapter {num}"
    return f"Kapitel {num}"


def de_zs_asr_match_key(s: str) -> str:
    """
    /ts/ (letter Z) is often heard and transcribed as [s] (*Seittafel* for *Zeittafel*).
    Map only **z** → **s** so we align with that ASR; inner *s* in words stays unchanged.
    Fuzzy *Levenshtein* below catches leftover typos (e.g. *Zeitfafel*).
    """
    return s.replace("z", "s")


def _levenshtein(a: str, b: str) -> int:
    """Edit distance (insert/delete/subst); small strings only (chapter stems)."""
    if len(a) < len(b):
        a, b = b, a
    la, lb = len(a), len(b)
    if lb == 0:
        return la
    row = list(range(lb + 1))
    for i in range(1, la + 1):
        prev = row[0]
        row[0] = i
        for j in range(1, lb + 1):
            cur = min(
                row[j] + 1,
                row[j - 1] + 1,
                prev + (0 if a[i - 1] == b[j - 1] else 1),
            )
            prev, row[j] = row[j], cur
    return row[lb]


def _de_stem_fuzzy_eq(candidate: str, stem: str) -> bool:
    """
    After z/s and letter normalization, allow small ASR / dialect edits (dropped letters,
    f/t, etc.) on longer stems.
    """
    ca = de_zs_asr_match_key(candidate)
    st = de_zs_asr_match_key(stem)
    if ca == st:
        return True
    max_len = max(len(ca), len(st))
    if max_len < 4:
        return False
    max_dist = 1 if max_len <= 6 else 2
    return _levenshtein(ca, st) <= max_dist


def _word_matches_kapitel_cue_de(w: str) -> bool:
    """
    *Kapitel* often elided in speech/ASR (e.g. *Kapitl*). z→s for dialect/ASR.
    Require at least 6 characters for fuzzy so *kapit* alone is not a match.
    """
    d = de_zs_asr_match_key(normalize_word_de(w))
    if d == "kapitel" or d == "kapitl":
        return True
    if not d.startswith("kapit") or len(d) < 6 or len(d) > 9:
        return False
    return _levenshtein(d, "kapitel") <= 2


def _word_matches_chapter_cue_en(w: str) -> bool:
    e = normalize_word_en(w)
    if e == "chapter":
        return True
    if not e.startswith("chap") or len(e) < 5 or len(e) > 9:
        return False
    return _levenshtein(e, "chapter") <= 2


def word_matches_chapter_cue(w: str, chapter_cue: str) -> bool:
    if chapter_cue == "en":
        return _word_matches_chapter_cue_en(w)
    return _word_matches_kapitel_cue_de(w)


# Spoken special segments (DE/EN); matching word wins over “Kapitel/Chapter N”. Labels are UI/title text.
SPECIAL_STEM_TO_LABEL: dict[str, str] = {
    "zeittafel": "Zeittafel",
    "prolog": "Prolog",
    "epilog": "Epilog",
    "prologue": "Prologue",
    "epilogue": "Epilog",
}
# Unique stable numbers for mux/dedup.
SPECIAL_LABEL_TO_NUMBER: dict[str, int] = {
    "Zeittafel": -1001,
    "Prolog": -1002,
    "Epilog": -1003,
    "Prologue": -1004,
}


def _special_chapter_label_from_word(w: str) -> str | None:
    d = de_zs_asr_match_key(normalize_word_de(w))
    e = de_zs_asr_match_key(normalize_word_en(w))
    for stem, label in SPECIAL_STEM_TO_LABEL.items():
        if _de_stem_fuzzy_eq(d, stem) or _de_stem_fuzzy_eq(e, stem):
            return label
    return None


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
    Sort by file + time; drop consecutive duplicates with the same file and chapter number
    (keep the first; startSec is only used for sort order, typically 0).
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


SPECIAL_LABEL_PRIORITY: tuple[str, ...] = (
    "Zeittafel",
    "Prolog",
    "Prologue",
    "Epilog",
)

NUM_ZEITTAFEL = -1001
NUM_PROLOG = -1002
NUM_EPILOG = -1003
NUM_PROLOGUE = -1004


def _letters_token(w: str) -> str:
    return re.sub(r"[^\wäöüß]", "", w, flags=re.I).lower()


def _letters_blob_cumulative_to_segment(
    segments: list,
) -> list[tuple[float, str]]:
    """(segment.start, cumulative letters-blob from file start to end of that segment)."""
    acc_text = ""
    out: list[tuple[float, str]] = []
    for seg in segments:
        acc_text += getattr(seg, "text", "") or ""
        out.append(
            (float(getattr(seg, "start", 0.0)), de_zs_asr_match_key(_letters_token(acc_text)))
        )
    return out


def _collect_special_candidates(
    wlist: list, segments: list
) -> list[tuple[float, str]]:
    """
    (speech_time, label) for any special: single token, two-token compound, or substring in head text.
    """
    cands: list[tuple[float, str]] = []
    for wo in wlist:
        lab = _special_chapter_label_from_word(wo.word)
        if lab is not None:
            cands.append((float(wo.start), lab))
    for i in range(len(wlist) - 1):
        cat = de_zs_asr_match_key(
            _letters_token(wlist[i].word) + _letters_token(wlist[i + 1].word)
        )
        for stem, lab in SPECIAL_STEM_TO_LABEL.items():
            if _de_stem_fuzzy_eq(cat, stem):
                t = min(float(wlist[i].start), float(wlist[i + 1].start))
                cands.append((t, lab))
                break
    for seg_start, blob in _letters_blob_cumulative_to_segment(segments):
        for stem, lab in SPECIAL_STEM_TO_LABEL.items():
            if _fuzzy_stem_appears_in_letters_blob(blob, stem):
                cands.append((seg_start, lab))
    return cands


def _fuzzy_stem_appears_in_letters_blob(blob: str, stem: str) -> bool:
    """Exact or fuzzy (edit distance) occurrence of *stem* in a long letters-only blob."""
    sk = de_zs_asr_match_key(stem)
    if not sk or not blob:
        return False
    if sk in blob:
        return True
    n, m = len(blob), len(sk)
    if m < 4 or n < m - 2:
        return False
    max_dist = 2 if m >= 8 else 1
    for wlen in range(max(3, m - 2), min(n, m + 3) + 1):
        for i in range(0, n - wlen + 1):
            sub = blob[i : i + wlen]
            if _levenshtein(sub, sk) <= max_dist:
                return True
    return False


def _pick_special_label(cands: list[tuple[float, str]]) -> Optional[str]:
    if not cands:
        return None
    t_min = min(t for t, _ in cands)
    at_min = [lab for t, lab in cands if abs(t - t_min) < 0.15]
    for pref in SPECIAL_LABEL_PRIORITY:
        if pref in at_min:
            return pref
    return at_min[0]


def find_chapter_marks_for_file(
    words, segments, file_path_resolved: str, chapter_cue: str
) -> list:
    """
    At most one chapter per MP3. Specials: from words, 2-word compounds, and full head text
    (ASR often splits e.g. Zeittafel). Earliest time wins; ties break by SPECIAL_LABEL_PRIORITY.
    Otherwise earliest Kapitel/Chapter + number. startSec is always 0 (file start in mux).
    """
    wlist = list(words)
    seglist = list(segments) if segments else []
    spec_cands = _collect_special_candidates(wlist, seglist)
    if spec_cands:
        chosen = _pick_special_label(spec_cands)
        if chosen is not None:
            num = SPECIAL_LABEL_TO_NUMBER.get(chosen, -1)
            return [
                {
                    "filePath": file_path_resolved,
                    "startSec": 0.0,
                    "number": num,
                    "label": chosen,
                }
            ]

    if len(wlist) < 2:
        return []
    best_k: Optional[tuple[float, dict]] = None
    for i in range(len(wlist) - 1):
        if not word_matches_chapter_cue(wlist[i].word, chapter_cue):
            continue
        num = first_int_in(wlist[i + 1].word)
        if num is None:
            continue
        t = float(wlist[i].start)
        mark = {
            "filePath": file_path_resolved,
            "startSec": 0.0,
            "number": num,
            "label": number_chapter_label(num, chapter_cue),
        }
        if best_k is None or t < best_k[0]:
            best_k = (t, mark)
    if best_k is not None:
        return [best_k[1]]
    return []


def dedupe_global_specials(
    marks: list[dict[str, Any]], ordered_resolved_paths: list[str]
) -> list[dict[str, Any]]:
    """
    One Zeittafel: keep the earliest MP3 in folder order. Prolog, Prologue, Epilog: if several
    files match, keep only the *last* in folder order (reduces a spurious prologue in an intro file).
    """
    if not marks or not ordered_resolved_paths:
        return marks
    rank: dict[str, int] = {p: i for i, p in enumerate(ordered_resolved_paths)}

    def key_fp(m: dict[str, Any]) -> str:
        return str(Path(m.get("filePath", "")).resolve())

    by_num: dict[int, list[dict[str, Any]]] = {}
    for m in marks:
        n = m.get("number")
        if n in (NUM_ZEITTAFEL, NUM_PROLOG, NUM_EPILOG, NUM_PROLOGUE):
            by_num.setdefault(int(n), []).append(m)

    remove_fp: set[str] = set()
    for n, group in by_num.items():
        if len(group) < 2:
            continue
        ordered = sorted(group, key=lambda m: rank.get(key_fp(m), 10**9))
        if n == NUM_ZEITTAFEL:
            for m in ordered[1:]:
                remove_fp.add(key_fp(m))
        elif n == NUM_EPILOG:
            for m in ordered[:-1]:
                remove_fp.add(key_fp(m))
    prolog_fam = by_num.get(NUM_PROLOG, []) + by_num.get(NUM_PROLOGUE, [])
    if len(prolog_fam) > 1:
        ordered = sorted(prolog_fam, key=lambda m: rank.get(key_fp(m), 10**9))
        for m in ordered[:-1]:
            remove_fp.add(key_fp(m))

    if not remove_fp:
        return marks
    return [m for m in marks if key_fp(m) not in remove_fp]


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


def extract_wav_segment(ffmpeg_bin: str, src: Path, t_start: float, duration_sec: float) -> Path:
    """pcm_s16le 16k mono, from t_start (seconds) for duration_sec. Used after VAD finds speech start."""
    fd, out_name = tempfile.mkstemp(suffix=".wav", prefix="abc_whisper_seg_")
    os.close(fd)
    out_path = Path(out_name)
    cmd = [
        ffmpeg_bin,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{t_start:.3f}",
        "-i",
        str(src),
        "-t",
        f"{max(0.5, float(duration_sec)):.3f}",
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


def first_speech_start_sec_in_wav(
    wav_path: Path,
    *,
    threshold: float,
    min_silence_duration_ms: int,
    speech_pad_ms: int,
) -> float:
    """
    Use faster-whisper’s Silero VAD on decoded audio. Returns offset in seconds from the
    start of *wav_path* (0 if no speech / import failure).
    """
    try:
        from faster_whisper.audio import decode_audio
        from faster_whisper.vad import VadOptions, get_speech_timestamps
    except ImportError:
        return 0.0
    try:
        audio = decode_audio(str(wav_path), sampling_rate=16000)
    except Exception:
        return 0.0
    if audio is None or len(audio) < 1:
        return 0.0
    opts = VadOptions(
        threshold=float(threshold),
        min_silence_duration_ms=int(min_silence_duration_ms),
        speech_pad_ms=int(speech_pad_ms),
    )
    try:
        chunks = get_speech_timestamps(
            audio,
            opts,
            sampling_rate=16000,
        )
    except Exception:
        return 0.0
    if not chunks:
        return 0.0
    start_s = int(chunks[0]["start"])
    return max(0.0, start_s / 16000.0)


def transcribe_file(model, wav_path: Path, language: str):
    # Pre-VAD clip; do not re-VAD in Whisper (full cue may span the short window)
    segments, _info = model.transcribe(
        str(wav_path),
        language=language,
        word_timestamps=True,
        vad_filter=False,
    )
    return list(segments)


def _listen_log_output_path(listen_dir: Path, mp3: Path, root: Path) -> Path:
    listen_dir.mkdir(parents=True, exist_ok=True)
    try:
        rel = mp3.resolve().relative_to(root.resolve())
    except ValueError:
        rel = Path(mp3.name)
    safe = "__".join(rel.parts).replace(" ", "_")
    return listen_dir / f"{safe}_listen.txt"


def _segments_to_listen_block(section_title: str, segments: list) -> str:
    lines: list[str] = [f"=== {section_title} ===", ""]
    for seg in segments:
        ws = getattr(seg, "words", None)
        if ws:
            for w in ws:
                wt = getattr(w, "word", "") or ""
                st = getattr(w, "start", None)
                en = getattr(w, "end", None)
                if st is not None and en is not None:
                    lines.append(f"{float(st):.3f}\t{float(en):.3f}\t{wt}")
                elif wt:
                    lines.append(wt)
        else:
            tx = (getattr(seg, "text", None) or "").strip()
            ss = float(getattr(seg, "start", 0.0))
            ee = float(getattr(seg, "end", 0.0))
            if tx:
                lines.append(f"{ss:.3f}\t{ee:.3f}\t{tx}")
    lines.append("")
    return "\n".join(lines)


def write_listen_log_for_mp3(
    listen_dir: Optional[Path],
    mp3: Path,
    root: Path,
    sections: list[tuple[str, list]],
) -> None:
    """Write one UTF-8 file under listen_dir with header + one block per Whisper pass."""
    if not listen_dir or not sections:
        return
    header = (
        "AudioBookConverter — Whisper word log\n"
        f"MP3: {mp3.resolve()}\n"
        f"Scan root: {root.resolve()}\n\n"
    )
    body = "\n".join(_segments_to_listen_block(title, segs) for title, segs in sections)
    path = _listen_log_output_path(listen_dir, mp3, root)
    path.write_text(header + body, encoding="utf-8")


def _marks_for_mp3(
    model,
    mp3: Path,
    head_sec: float,
    ffmpeg_bin: str,
    language: str,
    chapter_cue: str,
    *,
    root_dir: Path,
    listen_log_dir: Optional[Path],
    vad_threshold: float,
    vad_min_silence_ms: int,
    vad_speech_pad_ms: int,
    first_in_folder_order: bool,
    first_file_head_sec: float,
    fallback_from_start_sec: float,
) -> list:
    search_wav: Optional[Path] = None
    trans_wav: Optional[Path] = None
    segments = None
    listen_sections: list[tuple[str, list]] = []
    try:
        if first_in_folder_order:
            trans_wav = extract_wav_segment(
                ffmpeg_bin, mp3, 0, max(0.5, float(first_file_head_sec))
            )
            segments = transcribe_file(model, trans_wav, language)
            listen_sections.append(
                (
                    f"first MP3 in folder order: {first_file_head_sec:g} s from file start (no VAD)",
                    segments,
                )
            )
        else:
            search_wav = extract_head_wav(ffmpeg_bin, mp3, VAD_MAX_SEARCH_SEC)
            t0 = first_speech_start_sec_in_wav(
                search_wav,
                threshold=vad_threshold,
                min_silence_duration_ms=vad_min_silence_ms,
                speech_pad_ms=vad_speech_pad_ms,
            )
            trans_wav = extract_wav_segment(ffmpeg_bin, mp3, t0, head_sec)
            segments = transcribe_file(model, trans_wav, language)
            listen_sections.append(
                (
                    f"VAD then {head_sec:g} s from first speech (first speech at t≈{t0:.3f} s in search window)",
                    segments,
                )
            )
            words = words_from_segments(segments)
            marks = find_chapter_marks_for_file(
                words, segments, str(mp3.resolve()), chapter_cue
            )
            if marks:
                write_listen_log_for_mp3(listen_log_dir, mp3, root_dir, listen_sections)
                return marks
            if trans_wav is not None and trans_wav.exists():
                try:
                    trans_wav.unlink()
                except OSError:
                    pass
            trans_wav = extract_wav_segment(
                ffmpeg_bin,
                mp3,
                0,
                max(0.5, float(fallback_from_start_sec)),
            )
            segments = transcribe_file(model, trans_wav, language)
            listen_sections.append(
                (
                    f"fallback: {fallback_from_start_sec:g} s from file start (no VAD)",
                    segments,
                )
            )
    except subprocess.CalledProcessError as exc:
        print(f"{mp3}: ffmpeg {exc.stderr!r}", file=sys.stderr)
        raise
    except Exception as exc:
        print(f"{mp3}: {exc}", file=sys.stderr)
        raise
    finally:
        for w in (search_wav, trans_wav):
            if w is not None and w.exists():
                try:
                    w.unlink()
                except OSError:
                    pass

    assert segments is not None
    write_listen_log_for_mp3(listen_log_dir, mp3, root_dir, listen_sections)
    words = words_from_segments(segments)
    return find_chapter_marks_for_file(
        words, segments, str(mp3.resolve()), chapter_cue
    )


_worker_model = None


def _init_whisper_pool(model_size: str, device: str, compute_type: str) -> None:
    global _worker_model
    from faster_whisper import WhisperModel

    _worker_model = WhisperModel(
        model_size,
        device=device,
        compute_type=compute_type,
    )


def _whisper_pool_job(
    payload: Tuple[
        str,
        float,
        str,
        str,
        str,
        str,
        str,
        float,
        int,
        int,
        bool,
        float,
        float,
    ],
) -> list:
    (
        mp3_str,
        head_sec,
        ffmpeg_bin,
        language,
        chapter_cue,
        root_dir_str,
        listen_log_dir_str,
        vad_threshold,
        vad_min_silence_ms,
        vad_speech_pad_ms,
        first_in_folder_order,
        first_file_head_sec,
        fallback_from_start_sec,
    ) = payload
    mp3 = Path(mp3_str)
    root_dir = Path(root_dir_str)
    listen_log_dir: Optional[Path] = (
        Path(listen_log_dir_str) if listen_log_dir_str else None
    )
    global _worker_model
    if _worker_model is None:
        raise RuntimeError("Whisper worker pool not initialized")
    return _marks_for_mp3(
        _worker_model,
        mp3,
        head_sec,
        ffmpeg_bin,
        language,
        chapter_cue,
        root_dir=root_dir,
        listen_log_dir=listen_log_dir,
        vad_threshold=vad_threshold,
        vad_min_silence_ms=vad_min_silence_ms,
        vad_speech_pad_ms=vad_speech_pad_ms,
        first_in_folder_order=first_in_folder_order,
        first_file_head_sec=first_file_head_sec,
        fallback_from_start_sec=fallback_from_start_sec,
    )


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
        help=(
            "For every MP3 except the first: after VAD, transcribe this many seconds from "
            "the first speech (default: "
            f"{HEAD_SECONDS_DEFAULT})"
        ),
    )
    parser.add_argument(
        "--first-file-head-seconds",
        type=float,
        default=FIRST_FILE_HEAD_SECONDS_DEFAULT,
        help=(
            "For the first MP3 in folder order only: no VAD; transcribe this many seconds "
            f"from the file start (default: {FIRST_FILE_HEAD_SECONDS_DEFAULT})"
        ),
    )
    parser.add_argument(
        "--fallback-from-start-seconds",
        type=float,
        default=FALLBACK_FROM_START_SECONDS_DEFAULT,
        help=(
            "For every MP3 except the first: if VAD + --head-seconds yields no chapter, "
            "transcribe this many seconds from the file start (default: "
            f"{FALLBACK_FROM_START_SECONDS_DEFAULT})"
        ),
    )
    parser.add_argument(
        "--chapter-cue",
        choices=("de", "en"),
        default="de",
        help='Spoken cue before chapter number: "de" = Kapitel, "en" = Chapter',
    )
    parser.add_argument(
        "--listen-log-dir",
        default=None,
        metavar="DIR",
        help=(
            "If set, write one UTF-8 file per MP3 under DIR: all transcribed words "
            "(start/end seconds and text per line when available), one section per Whisper pass "
            "(first-file head, VAD+head, or fallback from start)."
        ),
    )
    parser.add_argument(
        "--vad-threshold",
        type=float,
        default=None,
        metavar="T",
        help=(
            "Silero VAD probability threshold (0–1). Lower → earlier first speech. "
            "Default: preset from --model-size (see vad_params_for_whisper_model)."
        ),
    )
    parser.add_argument(
        "--vad-min-silence-ms",
        type=int,
        default=None,
        metavar="MS",
        help=(
            "Silero min silence duration (ms). Default: "
            f"{VAD_MIN_SILENCE_DURATION_MS_DEFAULT}"
        ),
    )
    parser.add_argument(
        "--vad-speech-pad-ms",
        type=int,
        default=None,
        metavar="MS",
        help=f"Silero speech padding (ms). Default: {VAD_SPEECH_PAD_MS_DEFAULT}",
    )
    args = parser.parse_args()
    chapter_cue: str = args.chapter_cue

    root = Path(args.root_dir).expanduser().resolve()
    if not root.is_dir():
        print(f"Not a directory: {root}", file=sys.stderr)
        sys.exit(1)

    listen_log_dir: Optional[Path] = None
    if args.listen_log_dir:
        listen_log_dir = Path(args.listen_log_dir).expanduser().resolve()

    pt_presets = vad_params_for_whisper_model(args.model_size)
    vad_thr = (
        float(args.vad_threshold)
        if args.vad_threshold is not None
        else float(pt_presets[0])
    )
    vad_min_sil_ms = (
        int(args.vad_min_silence_ms)
        if args.vad_min_silence_ms is not None
        else int(pt_presets[1])
    )
    vad_pad_ms = (
        int(args.vad_speech_pad_ms)
        if args.vad_speech_pad_ms is not None
        else int(pt_presets[2])
    )
    print(
        f"Silero VAD: threshold={vad_thr:g}, min_silence={vad_min_sil_ms} ms, "
        f"speech_pad={vad_pad_ms} ms (preset for model {args.model_size!r})",
        file=sys.stderr,
        flush=True,
    )

    mp3_list = list(iter_mp3_files(root))
    head_sec = max(0.5, float(args.head_seconds))
    first_file_head = max(0.5, float(args.first_file_head_seconds))
    fallback_from_start = max(0.5, float(args.fallback_from_start_seconds))
    nfiles = len(mp3_list)
    first_path = mp3_list[0].resolve() if nfiles else None
    all_marks: list = []

    workers = min(MAX_PARALLEL_WHISPER_WORKERS, nfiles) if nfiles else 0

    if listen_log_dir:
        print(f"Listen word logs → {listen_log_dir}", file=sys.stderr, flush=True)

    if nfiles == 0:
        pass
    elif workers <= 1:
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            print(str(exc), file=sys.stderr)
            sys.exit(1)
        try:
            cached = whisper_model_is_cached_locally(args.model_size)
        except ValueError as exc:
            print(str(exc), file=sys.stderr)
            sys.exit(1)
        if not cached:
            print("[model:download]", file=sys.stderr, flush=True)
        try:
            model = WhisperModel(
                args.model_size,
                device=args.device,
                compute_type=args.compute_type,
            )
        except Exception as exc:
            print(str(exc), file=sys.stderr)
            sys.exit(1)
        if not cached:
            print("[model:ready]", file=sys.stderr, flush=True)
        if nfiles > 0:
            print(f"[0/{nfiles}]", file=sys.stderr, flush=True)

        for idx, mp3 in enumerate(mp3_list, start=1):
            try:
                marks = _marks_for_mp3(
                    model,
                    mp3,
                    head_sec,
                    args.ffmpeg,
                    args.language,
                    chapter_cue,
                    root_dir=root,
                    listen_log_dir=listen_log_dir,
                    vad_threshold=vad_thr,
                    vad_min_silence_ms=vad_min_sil_ms,
                    vad_speech_pad_ms=vad_pad_ms,
                    first_in_folder_order=first_path is not None
                    and mp3.resolve() == first_path,
                    first_file_head_sec=first_file_head,
                    fallback_from_start_sec=fallback_from_start,
                )
            except (subprocess.CalledProcessError, Exception):
                sys.exit(1)
            all_marks.extend(marks)
            print(f"[{idx}/{nfiles}]", file=sys.stderr, flush=True)
    else:
        try:
            from faster_whisper.utils import download_model
        except ImportError as exc:
            print(str(exc), file=sys.stderr)
            sys.exit(1)
        try:
            cached = whisper_model_is_cached_locally(args.model_size)
        except ValueError as exc:
            print(str(exc), file=sys.stderr)
            sys.exit(1)
        if not cached:
            print("[model:download]", file=sys.stderr, flush=True)
            try:
                download_model(args.model_size, local_files_only=False)
            except Exception as exc:
                print(str(exc), file=sys.stderr)
                sys.exit(1)
            print("[model:ready]", file=sys.stderr, flush=True)
        if nfiles > 0:
            print(f"[0/{nfiles}]", file=sys.stderr, flush=True)
        try:
            with ProcessPoolExecutor(
                max_workers=workers,
                initializer=_init_whisper_pool,
                initargs=(
                    args.model_size,
                    args.device,
                    args.compute_type,
                ),
            ) as executor:
                futures = [
                    executor.submit(
                        _whisper_pool_job,
                        (
                            str(p),
                            head_sec,
                            args.ffmpeg,
                            args.language,
                            chapter_cue,
                            str(root),
                            str(listen_log_dir) if listen_log_dir else "",
                            vad_thr,
                            vad_min_sil_ms,
                            vad_pad_ms,
                            first_path is not None and p.resolve() == first_path,
                            first_file_head,
                            fallback_from_start,
                        ),
                    )
                    for p in mp3_list
                ]
                done = 0
                for fut in as_completed(futures):
                    try:
                        marks = fut.result()
                    except Exception:
                        executor.shutdown(wait=False, cancel_futures=True)
                        sys.exit(1)
                    all_marks.extend(marks)
                    done += 1
                    print(f"[{done}/{nfiles}]", file=sys.stderr, flush=True)
        except Exception as exc:
            print(str(exc), file=sys.stderr)
            sys.exit(1)

    all_marks = dedupe_consecutive_same_chapter(all_marks)
    ordered = [str(p.resolve()) for p in mp3_list]
    all_marks = dedupe_global_specials(all_marks, ordered)

    try:
        write_chapter_log(
            root,
            all_marks,
            model_size=args.model_size,
            device=args.device,
            first_file_head_seconds=first_file_head,
            head_after_speech_seconds=head_sec,
            fallback_from_start_seconds=fallback_from_start,
            vad_threshold=vad_thr,
            vad_min_silence_ms=vad_min_sil_ms,
            vad_speech_pad_ms=vad_pad_ms,
            chapter_cue=chapter_cue,
        )
    except OSError as exc:
        print(f"Could not write chapter log: {exc}", file=sys.stderr)
        sys.exit(1)

    json.dump(
        {"marks": all_marks, "chapterCue": chapter_cue},
        sys.stdout,
        ensure_ascii=False,
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
