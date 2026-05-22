#!/usr/bin/env python3
"""
Chapter layout without per-file “Kapitel N” speech recognition.

1) Special-titles ASR (first 60 s): *Zeittafel* on the 1st MP3; if missing, the 2nd MP3 is
   scanned for *Zeittafel* only (new layout: 1st file is often title/author). When *Zeittafel*
   is found on the 2nd file, one *Zeittafel* chapter spans the 1st+2nd files (single mark at
   file 1 start) and *Prolog*/*Prologue* is sought on the **3rd** MP3. Legacy layout (word in
   file 1) keeps *Prolog* on the 2nd file. *Epilog* on the last MP3. Independent title-slot
   files are transcribed with limited parallelism (ffmpeg can overlap; Whisper uses one model
   lock). Up to 4 workers if ``os.cpu_count() > 8``, else 2.

2) **Chapter mode ``music`` (default):** Chapter-head ASR (first 5 s, every MP3): if the model
   finds **little or no** usable speech, the head is treated like a music/silence intro → this
   file can **start** a new numbered chapter. Clear narration in the first 5 s ⇒ **not** that
   cue. Stored specials (step 1) never act as such a boundary. If no file qualifies: one
   *Kapitel 1* span from after Prolog (if found) else after Zeittafel (if found) else 0,
   through before Epilog (if found) else last MP3.

3) **Chapter mode ``text``:** After specials as in (1), the first ~TEXT_CHAPTER_SCAN_SEC of
   each MP3 is transcribed and scanned for spoken *Kapitel N* / *Chapter N* (compact tokens);
   chapter times use Whisper segment starts. If no hits: same single-chapter fallback as (2).

JSON to stdout (marks + chapterCue), progress to stderr. ffmpeg + faster-whisper required.
Tune ``ABC_HEAD_SPEECH_MIN_WORDS`` (default 4) or ``ABC_HEAD_DEBUG=1`` (or ``ABC_MUSIC_DEBUG``)
for per-file dumps on stderr.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

CHAPTER_LOG_FILENAME = "AudiobookConverter_kapitel.log"
LISTEN_LOG_SUBDIR_NAME = "AudiobookConverter_listen_logs"

SPECIAL_LABEL_TO_NUMBER: dict[str, int] = {
    "Zeittafel": -1001,
    "Prolog": -1002,
    "Epilog": -1003,
    "Prologue": -1004,
}

SPECIAL_SCAN_SEC = 60.0
HEAD_CHAPTER_SCAN_SEC = 5.0
TEXT_CHAPTER_SCAN_SEC = 45.0
HEAD_SPEECH_MIN_WORDS_DEFAULT = 4
HEAD_BRACKET_NOISE_RE = re.compile(r"\[[^\]]*\]")

HEAD_SECONDS_DEFAULT = 45
HEAD_SECONDS_FIRST_DEFAULT = 60


def whisper_model_is_cached_locally(model_size: str) -> bool:
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
    head_seconds_first: float,
    head_seconds_rest: float,
    chapter_cue: str,
    chapter_mode: str = "music",
) -> None:
    log_path = root / CHAPTER_LOG_FILENAME
    de = chapter_cue == "de"
    mode = (chapter_mode or "music").lower()
    if de:
        if mode == "text":
            title = "AudioBookConverter — erkannte Kapitel (Texterkennung Kapitel N)"
            scan_note = (
                f"Scanner: Texterkennung („Kapitel“/Zahl) in den ersten "
                f"{TEXT_CHAPTER_SCAN_SEC:.0f} s je MP3; Kurz-ASR Titel wie zuvor. "
                f"Modell {model_size}, Gerät {device}, chapter cue: {chapter_cue}."
            )
        else:
            title = "AudioBookConverter — erkannte Kapitel (Kopf-ASR + Titelwörter)"
            scan_note = (
                f"Scanner: Kurz-ASR Titel ({head_seconds_first:.0f} s) + Kopf je MP3 "
                f"({HEAD_CHAPTER_SCAN_SEC:.0f} s Sprache ja/nein), Modell {model_size}, "
                f"Gerät {device}, chapter cue: {chapter_cue}. "
                f"(Legacy Kopf-Länge {head_seconds_rest:.0f} s — ungenutzt.)"
            )
        count_line = f"Gefundene Kapitelmarkierungen: {len(all_marks)}"
        empty_line = "(keine Kapitel im Scan)"
        table_hdr = "— Tabelle (Datei | Kapitel | Sekunden | Timecode) —"
    else:
        if mode == "text":
            title = "AudioBookConverter — detected chapters (spoken Chapter N)"
            scan_note = (
                f"Scanner: text match (“Chapter” + number) in first "
                f"{TEXT_CHAPTER_SCAN_SEC:.0f} s per MP3; title ASR as before. "
                f"Model {model_size}, device {device}, chapter cue: {chapter_cue}."
            )
        else:
            title = "AudioBookConverter — detected chapters (head ASR + title words)"
            scan_note = (
                f"Scanner: short ASR titles ({head_seconds_first:.0f} s) + per-MP3 head "
                f"({HEAD_CHAPTER_SCAN_SEC:.0f} s speech yes/no), model {model_size}, "
                f"device {device}, chapter cue: {chapter_cue}. "
                f"(Legacy head {head_seconds_rest:.0f} s — unused.)"
            )
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
        scan_note,
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
            for m in sorted(by_file[fp], key=lambda x: (x.get("number", 0), x.get("label", ""))):
                label = m.get("label", "")
                sec = float(m["startSec"])
                tc = format_timecode(sec)
                lines.append(f"  {label} @ {sec:.3f} s  ({tc})")
            lines.append("")

        lines.append(table_hdr)
        for m in sorted(
            all_marks,
            key=lambda x: (x.get("filePath", ""), float(x["startSec"]), x.get("number", 0)),
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


def de_zs_asr_match_key(s: str) -> str:
    return s.replace("z", "s")


def _letters_token(w: str) -> str:
    return re.sub(r"[^\wäöüß]", "", w, flags=re.I).lower()


def _levenshtein(a: str, b: str) -> int:
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
    ca = de_zs_asr_match_key(candidate)
    st = de_zs_asr_match_key(stem)
    if ca == st:
        return True
    max_len = max(len(ca), len(st))
    if max_len < 4:
        return False
    max_dist = 1 if max_len <= 6 else 2
    return _levenshtein(ca, st) <= max_dist


def _fuzzy_stem_appears_in_letters_blob(blob: str, stem: str) -> bool:
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


def transcript_letters_blob(segments: list) -> str:
    parts = []
    for seg in segments:
        parts.append(getattr(seg, "text", "") or "")
    raw = "".join(parts)
    return de_zs_asr_match_key(_letters_token(raw))


def head_transcript_word_stats(segments: list) -> tuple[int, int, str]:
    """(word_count, alnum_char_count, raw_joined_text)."""
    parts = [(getattr(seg, "text", "") or "").strip() for seg in segments]
    raw = " ".join(p for p in parts if p).strip()
    cleaned = HEAD_BRACKET_NOISE_RE.sub(" ", raw)
    words = re.findall(r"[\wäöüß]+", cleaned, flags=re.I)
    alnum = len(re.sub(r"[^\wäöüß]", "", cleaned, flags=re.I))
    return len(words), alnum, raw


def head_intro_like_non_speech(segments: list) -> bool:
    """
    True ⇒ first few seconds (~HEAD_CHAPTER_SCAN_SEC) look non-speech-ish (music, silence, or
    undecodable) → chapter-boundary cue.
    Mirrors the former “music at start” flag.
    """
    nw, alnum, _raw = head_transcript_word_stats(segments)
    min_w = HEAD_SPEECH_MIN_WORDS_DEFAULT
    env_mw = os.environ.get("ABC_HEAD_SPEECH_MIN_WORDS", "").strip()
    if env_mw:
        try:
            min_w = max(1, int(env_mw))
        except ValueError:
            min_w = HEAD_SPEECH_MIN_WORDS_DEFAULT
    if nw >= min_w:
        return False
    if nw >= 2 and alnum >= 26:
        return False

    nsp_vals: list[float] = []
    for s in segments:
        v = getattr(s, "no_speech_prob", None)
        if v is not None:
            nsp_vals.append(float(v))

    if nsp_vals:
        avg_nsp = sum(nsp_vals) / len(nsp_vals)
        if nw == 0 and avg_nsp > 0.42:
            return True
        if nw < min_w and avg_nsp > 0.62:
            return True

    return nw < min_w


def _head_debug_enabled() -> bool:
    e = os.environ.get("ABC_HEAD_DEBUG", "") or os.environ.get("ABC_MUSIC_DEBUG", "")
    return e.strip().lower() in ("1", "true", "yes")


def extract_temp_wav(ffmpeg_bin: str, src: Path, duration_sec: float) -> Path:
    fd, out_name = tempfile.mkstemp(suffix=".wav", prefix="abc_chapter_head_")
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


def transcribe_segments(
    model,
    wav_path: Path,
    language: str,
    *,
    fast_head: bool = False,
) -> list:
    kw: dict = {
        "language": language,
        "word_timestamps": False,
        "vad_filter": False,
    }
    if fast_head:
        kw["beam_size"] = 1
        kw["best_of"] = 1
        kw["temperature"] = 0.0
    segments, _info = model.transcribe(str(wav_path), **kw)
    return list(segments)


def scan_special_words_on_blob(blob: str, roles: set[str]) -> dict[str, bool]:
    """roles: subset of 'z', 'p', 'e' (Zeittafel, Prolog/Prologue, Epilog)."""
    out: dict[str, bool] = {}
    if "z" in roles:
        out["z"] = _fuzzy_stem_appears_in_letters_blob(blob, "zeittafel")
    if "p" in roles:
        out["p_prolog"] = _fuzzy_stem_appears_in_letters_blob(blob, "prolog")
        out["p_prologue"] = _fuzzy_stem_appears_in_letters_blob(blob, "prologue")
    if "e" in roles:
        ok = _fuzzy_stem_appears_in_letters_blob(blob, "epilog") or _fuzzy_stem_appears_in_letters_blob(
            blob, "epilogue"
        )
        out["e"] = ok
    return out


def number_chapter_label(num: int, chapter_cue: str) -> str:
    if chapter_cue == "en":
        return f"Chapter {num}"
    return f"Kapitel {num}"


@dataclass
class SpecialFindings:
    found_zeittafel: bool = False
    # Title/author on file 1, Zeittafel spoken on file 2 → one Zeittafel chapter spans files 1+2.
    zeittafel_covers_first_two_files: bool = False
    prolog_label: Optional[str] = None  # "Prolog" or "Prologue"
    prolog_file_index: Optional[int] = None
    found_epilog: bool = False


def _apply_prolog_from_blob(
    findings: SpecialFindings, blob: str, file_index: int
) -> None:
    flags = scan_special_words_on_blob(blob, {"p"})
    if flags.get("p_prolog"):
        findings.prolog_label = "Prolog"
        findings.prolog_file_index = file_index
    elif flags.get("p_prologue"):
        findings.prolog_label = "Prologue"
        findings.prolog_file_index = file_index


def _special_title_parallel_workers() -> int:
    """More than 8 logical CPUs → 4 concurrent special-slot tasks, else 2."""
    c = os.cpu_count()
    if c is None or c <= 8:
        return 2
    return 4


def _transcribe_one_special_slot(
    ffmpeg_bin: str,
    model,
    model_lock: threading.Lock,
    mp3: Path,
    language: str,
) -> tuple[str, str, str]:
    k = str(mp3.resolve())
    wav: Optional[Path] = None
    try:
        wav = extract_temp_wav(ffmpeg_bin, mp3, SPECIAL_SCAN_SEC)
        with model_lock:
            segments = transcribe_segments(model, wav, language)
        text = " ".join(
            (getattr(s, "text", "") or "").strip() for s in segments
        )
        blob = transcript_letters_blob(segments)
        return k, text, blob
    finally:
        if wav is not None and wav.exists():
            try:
                wav.unlink()
            except OSError:
                pass


def _run_special_title_transcriptions(
    mp3s: list[Path],
    ffmpeg_bin: str,
    model,
    language: str,
    max_workers: int,
) -> tuple[dict[str, str], dict[str, str]]:
    """Returns (transcripts by path key, letter blobs by path key)."""
    transcripts: dict[str, str] = {}
    blobs: dict[str, str] = {}
    if not mp3s:
        return transcripts, blobs
    workers = max(1, min(max_workers, len(mp3s)))
    model_lock = threading.Lock()
    if len(mp3s) == 1 or workers == 1:
        for p in mp3s:
            k, text, blob = _transcribe_one_special_slot(
                ffmpeg_bin, model, model_lock, p, language
            )
            transcripts[k] = text
            blobs[k] = blob
        return transcripts, blobs
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = [
            ex.submit(
                _transcribe_one_special_slot,
                ffmpeg_bin,
                model,
                model_lock,
                p,
                language,
            )
            for p in mp3s
        ]
        for fut in as_completed(futures):
            k, text, blob = fut.result()
            transcripts[k] = text
            blobs[k] = blob
    return transcripts, blobs


def collect_special_findings(
    mp3_list: list[Path],
    ffmpeg_bin: str,
    model,
    language: str,
) -> tuple[SpecialFindings, dict[str, str]]:
    """
    Returns findings and map resolved path string -> transcript (for optional listen logs).
    """
    n = len(mp3_list)
    findings = SpecialFindings()
    transcripts: dict[str, str] = {}
    blob_by_key: dict[str, str] = {}

    if n < 1:
        return findings, transcripts

    max_w = _special_title_parallel_workers()
    wave1_idx = {0}
    if n >= 2:
        wave1_idx.add(1)
        wave1_idx.add(n - 1)
    wave1_paths: list[Path] = []
    seen: set[str] = set()
    for i in sorted(wave1_idx):
        p = mp3_list[i]
        k = str(p.resolve())
        if k not in seen:
            seen.add(k)
            wave1_paths.append(p)

    t1, b1 = _run_special_title_transcriptions(
        wave1_paths, ffmpeg_bin, model, language, max_w
    )
    transcripts.update(t1)
    blob_by_key.update(b1)

    def blob_at(idx: int) -> str:
        return blob_by_key[str(mp3_list[idx].resolve())]

    blob0 = blob_at(0)
    z0 = scan_special_words_on_blob(blob0, {"z"}).get("z", False)
    blob1: Optional[str] = None
    if n >= 2:
        blob1 = blob_at(1)
        z1 = scan_special_words_on_blob(blob1, {"z"}).get("z", False)
    else:
        z1 = False

    if z0:
        findings.found_zeittafel = True
        findings.zeittafel_covers_first_two_files = False
    elif z1:
        findings.found_zeittafel = True
        findings.zeittafel_covers_first_two_files = True

    if n >= 2 and blob1 is not None:
        if findings.zeittafel_covers_first_two_files:
            if n >= 3:
                k2 = str(mp3_list[2].resolve())
                if k2 not in blob_by_key:
                    t2, b2 = _run_special_title_transcriptions(
                        [mp3_list[2]], ffmpeg_bin, model, language, max_w
                    )
                    transcripts.update(t2)
                    blob_by_key.update(b2)
                _apply_prolog_from_blob(findings, blob_by_key[k2], 2)
        else:
            _apply_prolog_from_blob(findings, blob1, 1)

    blob_last = blob_by_key[str(mp3_list[-1].resolve())]
    if scan_special_words_on_blob(blob_last, {"e"}).get("e"):
        findings.found_epilog = True

    return findings, transcripts


def stored_special_mask(
    n: int, findings: SpecialFindings
) -> list[bool]:
    """File index is a 'stored' special slot with positive word find (excluded from music chapters)."""
    m = [False] * n
    if n >= 1 and findings.found_zeittafel:
        m[0] = True
        if findings.zeittafel_covers_first_two_files and n >= 2:
            m[1] = True
    pi = findings.prolog_file_index
    if (
        pi is not None
        and findings.prolog_label is not None
        and 0 <= pi < n
    ):
        m[pi] = True
    if n >= 1 and findings.found_epilog:
        m[-1] = True
    return m


def fallback_body_span(
    n: int, findings: SpecialFindings
) -> Optional[tuple[int, int]]:
    if n < 1:
        return None
    if findings.prolog_file_index is not None:
        start = findings.prolog_file_index + 1
    elif findings.found_zeittafel:
        start = 2 if findings.zeittafel_covers_first_two_files else 1
    else:
        start = 0
    if findings.found_epilog:
        end = n - 2
    else:
        end = n - 1
    if start > end:
        return None
    return start, end


def _compact_for_chapter_stem(text: str, chapter_cue: str) -> str:
    raw = (text or "").lower()
    if chapter_cue == "de":
        raw = de_zs_asr_match_key(raw)
    return re.sub(r"[\s_\W]+", "", raw, flags=re.I)


def _spoken_chapter_numbers_from_segments(
    segments: list,
    chapter_cue: str,
) -> list[tuple[float, int]]:
    """(start_sec, chapter_number): first occurrence of each spoken number in this file."""
    if chapter_cue == "en":
        pat = re.compile(r"chapter(\d{1,3})")
    else:
        pat = re.compile(r"kapitel(\d{1,3})")
    hits: list[tuple[float, int]] = []
    seen_nums: set[int] = set()
    nseg = len(segments)
    for i in range(nseg):
        parts: list[str] = []
        for j in range(i, min(i + 4, nseg)):
            parts.append(getattr(segments[j], "text", "") or "")
        blob = _compact_for_chapter_stem(" ".join(parts), chapter_cue)
        m = pat.search(blob)
        if not m:
            continue
        num = int(m.group(1))
        if num in seen_nums:
            continue
        seen_nums.add(num)
        t0 = float(getattr(segments[i], "start", 0.0) or 0.0)
        hits.append((t0, num))
    return hits


def _special_chapter_marks_only(
    mp3_list: list[Path],
    findings: SpecialFindings,
) -> list[dict[str, Any]]:
    """Zeittafel / Prolog / Prologue / Epilog marks (same as start of ``build_marks``)."""
    n = len(mp3_list)
    resolved = [str(p.resolve()) for p in mp3_list]
    marks: list[dict[str, Any]] = []
    if n >= 1 and findings.found_zeittafel:
        marks.append(
            {
                "filePath": resolved[0],
                "startSec": 0.0,
                "number": SPECIAL_LABEL_TO_NUMBER["Zeittafel"],
                "label": "Zeittafel",
            }
        )
    pi = findings.prolog_file_index
    if (
        pi is not None
        and findings.prolog_label is not None
        and 0 <= pi < n
    ):
        lab = findings.prolog_label
        marks.append(
            {
                "filePath": resolved[pi],
                "startSec": 0.0,
                "number": SPECIAL_LABEL_TO_NUMBER[lab],
                "label": lab,
            }
        )
    if n >= 1 and findings.found_epilog:
        marks.append(
            {
                "filePath": resolved[-1],
                "startSec": 0.0,
                "number": SPECIAL_LABEL_TO_NUMBER["Epilog"],
                "label": "Epilog",
            }
        )
    return marks


def build_marks_text_chapters(
    mp3_list: list[Path],
    ffmpeg_bin: str,
    model,
    language: str,
    findings: SpecialFindings,
    chapter_cue: str,
    *,
    text_transcripts_for_log: Optional[list[str]] = None,
    intro_flags_for_log: Optional[list[bool]] = None,
    progress_step_holder: Optional[list[int]] = None,
    total_steps: int = 0,
) -> list[dict[str, Any]]:
    """
    Specials + spoken *Kapitel N* / *Chapter N* in first TEXT_CHAPTER_SCAN_SEC per file.
    Optionally fills parallel lists for listen logs (``text_transcripts_for_log`` full text,
    ``intro_flags_for_log`` False when any speech in head 5 s for compatibility).
    """
    n = len(mp3_list)
    resolved = [str(p.resolve()) for p in mp3_list]
    marks = _special_chapter_marks_only(mp3_list, findings)
    numbered: list[tuple[int, float, int]] = []
    logs: list[str] = [] if text_transcripts_for_log is not None else []
    intro_logs: list[bool] = [] if intro_flags_for_log is not None else []

    for fi, mp3 in enumerate(mp3_list):
        wav_long: Optional[Path] = None
        wav_head: Optional[Path] = None
        try:
            wav_long = extract_temp_wav(ffmpeg_bin, mp3, TEXT_CHAPTER_SCAN_SEC)
            segments = transcribe_segments(
                model, wav_long, language, fast_head=False
            )
            joined = " ".join(
                (getattr(s, "text", "") or "").strip() for s in segments
            ).strip()
            if text_transcripts_for_log is not None:
                logs.append(joined)
            if intro_flags_for_log is not None:
                wav_head = extract_temp_wav(ffmpeg_bin, mp3, HEAD_CHAPTER_SCAN_SEC)
                head_segs = transcribe_segments(
                    model, wav_head, language, fast_head=True
                )
                intro_logs.append(head_intro_like_non_speech(head_segs))
            for t0, num in _spoken_chapter_numbers_from_segments(
                segments, chapter_cue
            ):
                numbered.append((fi, t0, num))
            if progress_step_holder is not None and total_steps > 0:
                progress_step_holder[0] += 1
                print(
                    f"[{progress_step_holder[0]}/{total_steps}]",
                    file=sys.stderr,
                    flush=True,
                )
        finally:
            for w in (wav_long, wav_head):
                if w is not None and w.exists():
                    try:
                        w.unlink()
                    except OSError:
                        pass

    if text_transcripts_for_log is not None:
        text_transcripts_for_log[:] = logs
    if intro_flags_for_log is not None:
        intro_flags_for_log[:] = intro_logs

    for fi, t0, num in numbered:
        marks.append(
            {
                "filePath": resolved[fi],
                "startSec": max(0.0, t0),
                "number": num,
                "label": number_chapter_label(num, chapter_cue),
            }
        )

    pos_nums = [m for m in marks if int(m["number"]) > 0]
    if not pos_nums:
        span = fallback_body_span(n, findings)
        if span is not None:
            a99, _b99 = span
            marks.append(
                {
                    "filePath": resolved[a99],
                    "startSec": 0.0,
                    "number": 1,
                    "label": number_chapter_label(1, chapter_cue),
                }
            )

    def sort_key(m: dict[str, Any]) -> tuple[int, int, float, int]:
        fp = m["filePath"]
        idx = resolved.index(fp) if fp in resolved else 9999
        num = int(m["number"])
        tier = 0 if num < 0 else 1
        return (idx, tier, float(m["startSec"]), num)

    marks.sort(key=sort_key)
    return marks


def build_marks(
    mp3_list: list[Path],
    findings: SpecialFindings,
    intro_non_speech_head: list[bool],
    chapter_cue: str,
) -> list[dict[str, Any]]:
    n = len(mp3_list)
    resolved = [str(p.resolve()) for p in mp3_list]
    marks = _special_chapter_marks_only(mp3_list, findings)

    special_excl = stored_special_mask(n, findings)
    boundaries = [
        i
        for i in range(n)
        if intro_non_speech_head[i] and not special_excl[i]
    ]

    if boundaries:
        for k, start_idx in enumerate(boundaries, start=1):
            marks.append(
                {
                    "filePath": resolved[start_idx],
                    "startSec": 0.0,
                    "number": k,
                    "label": number_chapter_label(k, chapter_cue),
                }
            )
    else:
        span = fallback_body_span(n, findings)
        if span is not None:
            a, _b = span
            marks.append(
                {
                    "filePath": resolved[a],
                    "startSec": 0.0,
                    "number": 1,
                    "label": number_chapter_label(1, chapter_cue),
                }
            )

    def sort_key(m: dict[str, Any]) -> tuple[int, int, int]:
        fp = m["filePath"]
        idx = resolved.index(fp) if fp in resolved else 9999
        num = int(m["number"])
        tier = 0 if num < 0 else 1
        return (idx, tier, num)

    marks.sort(key=sort_key)
    return marks


def write_listen_sidecar(
    listen_log_dir: Path,
    root: Path,
    mp3: Path,
    *,
    intro_non_speech_head: bool,
    head_scan_transcript: str,
    title_slot_transcript: str,
    de: bool,
    chapter_scan_mode: str = "music",
) -> None:
    listen_log_dir.mkdir(parents=True, exist_ok=True)
    try:
        rel = mp3.resolve().relative_to(root.resolve())
    except ValueError:
        rel = Path(mp3.name)
    safe = str(rel).replace("/", "__").replace("\\", "__")
    out = listen_log_dir / f"{safe}.listen.txt"
    text_mode = (chapter_scan_mode or "music").lower() == "text"
    if de:
        title = (
            "AudioBookConverter — Kapitelscan (Texterkennung)"
            if text_mode
            else "AudioBookConverter — Kapitelscan (Kopf-ASR + ggf. Titel-ASR)"
        )
        head_label = (
            f"Transkript Texterkennung (erste {TEXT_CHAPTER_SCAN_SEC:.0f} s):"
            if text_mode
            else f"Transkript Kopf ({HEAD_CHAPTER_SCAN_SEC:.0f} s):"
        )
        lines = [
            title,
            f"Projektordner: {root}",
            f"MP3: {mp3}",
            (
                f"Kopf erste {HEAD_CHAPTER_SCAN_SEC:.0f} s: "
                f"{'wenig/keine Sprache (Kapitelkopf-Kandidat)' if intro_non_speech_head else 'Sprache erkannt'}"
            ),
            "",
            head_label,
            head_scan_transcript or "(leer)",
            "",
            "Transkript Titel-Slots (60 s falls diese Datei betroffen):",
            title_slot_transcript or "(nicht für Zeittafel/Prolog/Epilog geladen)",
            "",
        ]
    else:
        title = (
            "AudioBookConverter — chapter scan (text cues)"
            if text_mode
            else "AudioBookConverter — chapter scan (head ASR + title slots)"
        )
        head_label = (
            f"Text-detection transcript (first {TEXT_CHAPTER_SCAN_SEC:.0f} s):"
            if text_mode
            else f"Head transcript ({HEAD_CHAPTER_SCAN_SEC:.0f} s):"
        )
        lines = [
            title,
            f"Project folder: {root}",
            f"MP3: {mp3}",
            (
                f"First {HEAD_CHAPTER_SCAN_SEC:.0f} s head: "
                f"{'little/no speech (chapter-head candidate)' if intro_non_speech_head else 'speech present'}"
            ),
            "",
            head_label,
            head_scan_transcript or "(empty)",
            "",
            "Title-slot transcript (60 s if this file is in those slots):",
            title_slot_transcript or "(not used for Zeittafel/Prolog/Epilog ASR)",
            "",
        ]
    out.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
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
    parser.add_argument("--head-seconds", type=float, default=HEAD_SECONDS_DEFAULT)
    parser.add_argument("--head-seconds-first", type=float, default=HEAD_SECONDS_FIRST_DEFAULT)
    parser.add_argument("--chapter-cue", choices=("de", "en"), default="de")
    parser.add_argument(
        "--chapter-mode",
        choices=("music", "text"),
        default="music",
        help=(
            "music: chapter boundaries from short head ASR (music/speech); "
            "text: spoken Kapitel/Chapter + number in first slice per MP3."
        ),
    )
    parser.add_argument(
        "--listen-log-dir",
        default="",
        metavar="DIR",
        help=(
            "If set, write one .listen.txt per MP3 "
            f"({HEAD_CHAPTER_SCAN_SEC:.0f} s head transcript + title-slot transcript when applicable). "
            f"Suggested: …/{LISTEN_LOG_SUBDIR_NAME}."
        ),
    )
    args = parser.parse_args()
    chapter_cue: str = args.chapter_cue
    chapter_mode: str = str(args.chapter_mode or "music").lower()
    head_sec_first = max(0.5, float(args.head_seconds_first))
    head_sec_rest = max(0.5, float(args.head_seconds))

    root = Path(args.root_dir).expanduser().resolve()
    if not root.is_dir():
        print(f"Not a directory: {root}", file=sys.stderr)
        sys.exit(1)

    listen_log_dir: Optional[Path] = None
    if (args.listen_log_dir or "").strip():
        listen_log_dir = Path(args.listen_log_dir).expanduser().resolve()

    mp3_list = list(iter_mp3_files(root))
    nfiles = len(mp3_list)

    if nfiles == 0:
        write_chapter_log(
            root,
            [],
            model_size=args.model_size,
            device=args.device,
            head_seconds_first=head_sec_first,
            head_seconds_rest=head_sec_rest,
            chapter_cue=chapter_cue,
            chapter_mode=chapter_mode,
        )
        json.dump(
            {
                "marks": [],
                "chapterCue": chapter_cue,
                "chapterRecognition": chapter_mode,
            },
            sys.stdout,
            ensure_ascii=False,
        )
        sys.stdout.write("\n")
        return

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

    title_paths: set[Path] = {mp3_list[0].resolve()}
    if nfiles >= 2:
        title_paths.add(mp3_list[1].resolve())
        title_paths.add(mp3_list[-1].resolve())
    else:
        title_paths.add(mp3_list[-1].resolve())
    if nfiles >= 4:
        title_paths.add(mp3_list[2].resolve())
    n_title_slots = len(title_paths)
    total_steps = n_title_slots + nfiles
    step = 0

    print(f"[0/{total_steps}]", file=sys.stderr, flush=True)
    findings, transcripts = collect_special_findings(
        mp3_list, args.ffmpeg, model, args.language
    )
    step = n_title_slots
    print(f"[{step}/{total_steps}]", file=sys.stderr, flush=True)

    intro_flags: list[bool] = []
    head_transcripts: list[str] = []
    if chapter_mode == "text":
        step_holder = [n_title_slots]
        all_marks = build_marks_text_chapters(
            mp3_list,
            args.ffmpeg,
            model,
            args.language,
            findings,
            chapter_cue,
            text_transcripts_for_log=head_transcripts,
            intro_flags_for_log=intro_flags,
            progress_step_holder=step_holder,
            total_steps=total_steps,
        )
    else:
        for mp3 in mp3_list:
            wav: Optional[Path] = None
            try:
                wav = extract_temp_wav(args.ffmpeg, mp3, HEAD_CHAPTER_SCAN_SEC)
                segments = transcribe_segments(
                    model, wav, args.language, fast_head=True
                )
                text = " ".join(
                    (getattr(s, "text", "") or "").strip() for s in segments
                ).strip()
                head_transcripts.append(text)
                intro = head_intro_like_non_speech(segments)
                intro_flags.append(intro)
                if _head_debug_enabled():
                    nw, alnum, _ = head_transcript_word_stats(segments)
                    nsp = [float(getattr(s, "no_speech_prob")) for s in segments if getattr(s, "no_speech_prob", None) is not None]
                    nsp_s = f" avg_no_speech_prob={sum(nsp)/len(nsp):.2f}" if nsp else ""
                    print(
                        f"[head-debug] {mp3.name}: words={nw} alnum={alnum} "
                        f"intro_non_speech={intro}{nsp_s}",
                        file=sys.stderr,
                        flush=True,
                    )
            finally:
                if wav is not None and wav.exists():
                    try:
                        wav.unlink()
                    except OSError:
                        pass
            step += 1
            print(f"[{step}/{total_steps}]", file=sys.stderr, flush=True)

        all_marks = build_marks(mp3_list, findings, intro_flags, chapter_cue)

    if listen_log_dir is not None:
        for idx, mp3 in enumerate(mp3_list):
            write_listen_sidecar(
                listen_log_dir,
                root,
                mp3,
                intro_non_speech_head=intro_flags[idx],
                head_scan_transcript=head_transcripts[idx],
                title_slot_transcript=transcripts.get(str(mp3.resolve()), ""),
                de=chapter_cue == "de",
                chapter_scan_mode=chapter_mode,
            )
        if chapter_cue == "de":
            print(
                f"Hör-Protokoll (Scan-Notizen pro MP3): {listen_log_dir}",
                file=sys.stderr,
                flush=True,
            )
        else:
            print(
                f"Listen notes (one file per MP3): {listen_log_dir}",
                file=sys.stderr,
                flush=True,
            )

    try:
        write_chapter_log(
            root,
            all_marks,
            model_size=args.model_size,
            device=args.device,
            head_seconds_first=head_sec_first,
            head_seconds_rest=head_sec_rest,
            chapter_cue=chapter_cue,
            chapter_mode=chapter_mode,
        )
    except OSError as exc:
        print(f"Could not write chapter log: {exc}", file=sys.stderr)
        sys.exit(1)

    json.dump(
        {
            "marks": all_marks,
            "chapterCue": chapter_cue,
            "chapterRecognition": chapter_mode,
        },
        sys.stdout,
        ensure_ascii=False,
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
