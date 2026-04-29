#!/usr/bin/env python3
"""
For each MP3, transcribe the first --head-seconds-first seconds (default 60) for the **first**
MP3 in folder order only; all others use --head-seconds (default 45). ffmpeg extracts mono 16 kHz
WAV with mild EQ/high-pass by default (``--no-speech-eq`` to disable), optional
``--save-filtered-wav-to DIR`` to keep those WAVs for listening, then faster-whisper
to identify the chapter: spoken special labels (Zeittafel, Prolog, Epilog, Prologue, Epilogue) or
“Kapitel/Chapter” + number (Arabic, Roman, or spoken „drei“ / „three“ for 1–9). German: *Z* as [s] in ASR (z→s), plus *Levenshtein* for stems like
*Zeitfafel*; *Kapitel* may be clipped (*Kapitl*) or misheard. **Compound specials** (e.g. *Zeit* + *Tafel* as two ASR words) and matches in the
**full head transcript** are detected. If **Prolog/Prologue/Epilog** is detected in more than one
MP3, the **last** file in folder order is kept; duplicate **Zeittafel** keeps the **first**.
The chapter is placed at the **start of that MP3** (startSec 0) on
the merged timeline; the transcript only selects the title, not the time within the file.
JSON to stdout, progress to stderr.
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

MAX_PARALLEL_WHISPER_WORKERS = 8

HEAD_SECONDS_DEFAULT = 45
HEAD_SECONDS_FIRST_DEFAULT = 60
CHAPTER_LOG_FILENAME = "AudiobookConverter_kapitel.log"
LISTEN_LOG_SUBDIR_NAME = "AudiobookConverter_listen_logs"
FILTERED_PREVIEW_SUBDIR_NAME = "AudiobookConverter_filtered_preview"

# ffmpeg -af: trim low-frequency mud, gentle presence lift before Whisper (speech vs quiet bed).
# Tuned vs ~/myProjects/Books/Silber Edition 27 - Andromeda (scripts/benchmark_speech_eq.py):
# highpass 120 Hz vs 100 Hz improved tiny-model chapter hits on that set (Kapitel 3 clip).
FFMPEG_SPEECH_EQ_AF = "highpass=f=120,equalizer=f=300:width_type=h:width=100:g=-0.5"


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
    head_seconds_first: float,
    head_seconds_rest: float,
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
            (
                f"Modell: {model_size}, Gerät: {device}, chapter cue: {chapter_cue}, "
                f"Scan: erste MP3 {head_seconds_first:.0f} s, weitere "
                f"{head_seconds_rest:.0f} s"
            )
            if de
            else (
                f"Model: {model_size}, device: {device}, chapter cue: {chapter_cue}, "
                f"scan: first MP3 {head_seconds_first:.0f} s, others "
                f"{head_seconds_rest:.0f} s"
            )
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


def listen_log_path_for_mp3(listen_log_dir: Path, mp3: Path, root: Path) -> Path:
    """Stable filename under listen_log_dir from project-relative MP3 path."""
    try:
        rel = mp3.resolve().relative_to(root.resolve())
    except ValueError:
        rel = Path(mp3.name)
    safe = str(rel).replace("/", "__").replace("\\", "__")
    return listen_log_dir / f"{safe}.listen.txt"


def write_listen_log_for_mp3(
    listen_log_dir: Path,
    root: Path,
    mp3: Path,
    segments: list,
    *,
    language: str,
    head_sec: float,
    chapter_cue: str,
    de: bool,
) -> None:
    """One text file per scanned MP3: recognized words with timestamps (first head_sec only)."""
    listen_log_dir.mkdir(parents=True, exist_ok=True)
    out_path = listen_log_path_for_mp3(listen_log_dir, mp3, root)
    title = (
        "AudioBookConverter — Erkanntes Transkript (Whisper, Kopf)"
        if de
        else "AudioBookConverter — recognized transcript (Whisper head)"
    )
    words_hdr = "Wörter (Zeit | Text):" if de else "Words (time | text):"
    seg_hdr = "Segmente:" if de else "Segments:"
    lines = [
        title,
        f"Projektordner: {root}" if de else f"Project folder: {root}",
        f"MP3: {mp3}",
        (
            "Erzeugt (UTC): "
            f"{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} UTC"
        ),
        f"Sprache: {language}, chapter cue: {chapter_cue}, Kopf: erste {head_sec:.0f} s"
        if de
        else f"Language: {language}, chapter cue: {chapter_cue}, head: first {head_sec:.0f} s",
        "",
        words_hdr,
    ]
    any_words = False
    for seg in segments:
        ws = getattr(seg, "words", None) or []
        for w in ws:
            any_words = True
            wt = getattr(w, "word", "") or ""
            start = float(getattr(w, "start", 0.0))
            end = float(getattr(w, "end", start))
            lines.append(f"{start:.3f}–{end:.3f}\t{wt}".rstrip())
    if not any_words:
        fallback = (
            "(Keine Wort-Zeitstempel — Fallback auf Segmenttext.)"
            if de
            else "(No word timestamps — falling back to segment text.)"
        )
        lines.append(fallback)
        lines.append("")
        lines.append(seg_hdr)
        for seg in segments:
            t0 = float(getattr(seg, "start", 0.0))
            t1 = float(getattr(seg, "end", t0))
            txt = (getattr(seg, "text", "") or "").strip()
            lines.append(f"{t0:.3f}–{t1:.3f}\t{txt}".rstrip())
    lines.append("")
    out_path.write_text("\n".join(lines), encoding="utf-8")


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


# Classical roman numerals (Großbuchstaben I–M); passt zu Hörbuch-Kapiteln I … ~CM.
_ROMAN_VALUES = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
_ROMAN_VALID_RE = re.compile(
    r"^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$"
)


def _roman_token_to_int(token: str) -> Optional[int]:
    """
    If *token* is a roman numeral (z. B. III, XIV), return its integer value; else None.

    Only alphabetic letters are considered. If any letter is not I/V/X/L/C/D/M, we reject:
    otherwise German *drei* would strip to *DI* and wrongly parse as 501 (500+1).
    """
    letters = "".join(c for c in token.upper() if c.isalpha())
    if not letters:
        return None
    if any(c not in _ROMAN_VALUES for c in letters):
        return None
    raw = letters
    if not _ROMAN_VALID_RE.match(raw):
        return None
    vals = _ROMAN_VALUES
    i = 0
    total = 0
    while i < len(raw):
        if i + 1 < len(raw) and vals[raw[i]] < vals[raw[i + 1]]:
            total += vals[raw[i + 1]] - vals[raw[i]]
            i += 2
        else:
            total += vals[raw[i]]
            i += 1
    if total < 1 or total > 3999:
        return None
    return total


# Spoken chapter numbers 1–9 (next token after Kapitel/Chapter); keys = normalize_word_de / normalize_word_en.
_DE_SPOKEN_NUMBER_INT: dict[str, int] = {
    "eins": 1,
    "zwei": 2,
    "zwo": 2,
    "drei": 3,
    "vier": 4,
    "fünf": 5,
    "funf": 5,
    "fuenf": 5,
    "sechs": 6,
    "sieben": 7,
    "acht": 8,
    "neun": 9,
}
_EN_SPOKEN_NUMBER_INT: dict[str, int] = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
}


def _spoken_number_word_1_to_9(word: str, chapter_cue: str) -> Optional[int]:
    """Match spoken digit words for chapters 1–9 (DE/EN). Uses normalized tokens only (no fuzzy vs e.g. nein/neun)."""
    if chapter_cue == "en":
        key = normalize_word_en(word.strip())
        return _EN_SPOKEN_NUMBER_INT.get(key)
    key = normalize_word_de(word.strip())
    return _DE_SPOKEN_NUMBER_INT.get(key)


def chapter_number_after_cue(word: str, chapter_cue: str) -> Optional[int]:
    """
    Arabic digits, Roman numerals, or spoken German/English words for 1–9 (e.g. drei, three).
    """
    w = word.strip()
    n = first_int_in(w)
    if n is not None:
        return n
    r = _roman_token_to_int(w)
    if r is not None:
        return r
    return _spoken_number_word_1_to_9(w, chapter_cue)


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
    (speech_time, label) for any special: single token, two-token compound, or fuzzy stem in a
    cumulative letters blob built from segment text.
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


def _special_label_allowed_at_index(
    label: str, mp3_index: int, mp3_count: int
) -> bool:
    """
    mp3_index is 0-based in sorted MP3 order. Zeittafel → first file; Prolog/Prologue → second;
    Epilog → last. (If mp3_count == 1, only Zeittafel + Epilog slots apply to that file.)
    """
    if mp3_count < 1:
        return False
    last_i = mp3_count - 1
    if label == "Zeittafel":
        return mp3_index == 0
    if label in ("Prolog", "Prologue"):
        return mp3_count >= 2 and mp3_index == 1
    if label == "Epilog":
        return mp3_index == last_i
    return False


def _filter_special_cands_for_mp3_index(
    cands: list[tuple[float, str]], mp3_index: int, mp3_count: int
) -> list[tuple[float, str]]:
    return [
        (t, lab)
        for t, lab in cands
        if _special_label_allowed_at_index(lab, mp3_index, mp3_count)
    ]


def find_chapter_marks_for_file(
    words,
    segments,
    file_path_resolved: str,
    chapter_cue: str,
    *,
    mp3_index: int = 0,
    mp3_count: int = 1,
) -> list:
    """
    Zeittafel / Prolog / Epilog are only accepted on the 1st, 2nd, and last MP3 respectively
    (see ``_special_label_allowed_at_index``). Those slots still run normal Kapitel/Chapter + number
    detection; both may be returned for the same file (startSec 0 for each from the head scan).
    """
    wlist = list(words)
    seglist = list(segments) if segments else []
    out: list = []

    spec_cands = _collect_special_candidates(wlist, seglist)
    slot_cands = _filter_special_cands_for_mp3_index(
        spec_cands, mp3_index, mp3_count
    )
    if slot_cands:
        chosen = _pick_special_label(slot_cands)
        if chosen is not None:
            num = SPECIAL_LABEL_TO_NUMBER.get(chosen, -1)
            out.append(
                {
                    "filePath": file_path_resolved,
                    "startSec": 0.0,
                    "number": num,
                    "label": chosen,
                }
            )

    best_k: Optional[tuple[float, dict]] = None
    if len(wlist) >= 2:
        for i in range(len(wlist) - 1):
            if not word_matches_chapter_cue(wlist[i].word, chapter_cue):
                continue
            num = chapter_number_after_cue(wlist[i + 1].word, chapter_cue)
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
            out.append(best_k[1])

    return out


def dedupe_global_specials(
    marks: list[dict[str, Any]], ordered_resolved_paths: list[str]
) -> list[dict[str, Any]]:
    """
    Keep Zeittafel / Prolog / Prologue / Epilog only on the fixed slot (1st / 2nd / last MP3).
    Drops stray specials from mis-ASR or pool reordering.
    """
    if not marks or not ordered_resolved_paths:
        return marks
    nfiles = len(ordered_resolved_paths)
    norm = [str(Path(p).resolve()) for p in ordered_resolved_paths]
    slot_for_num: dict[int, str] = {}
    if nfiles >= 1:
        slot_for_num[NUM_ZEITTAFEL] = norm[0]
    if nfiles >= 2:
        slot_for_num[NUM_PROLOG] = norm[1]
        slot_for_num[NUM_PROLOGUE] = norm[1]
    if nfiles >= 1:
        slot_for_num[NUM_EPILOG] = norm[-1]

    def key_fp(m: dict[str, Any]) -> str:
        return str(Path(m.get("filePath", "")).resolve())

    out: list[dict[str, Any]] = []
    for m in marks:
        try:
            num = int(m.get("number"))
        except (TypeError, ValueError):
            out.append(m)
            continue
        expected = slot_for_num.get(num)
        if expected is None or num not in (
            NUM_ZEITTAFEL,
            NUM_PROLOG,
            NUM_EPILOG,
            NUM_PROLOGUE,
        ):
            out.append(m)
            continue
        if key_fp(m) == expected:
            out.append(m)
    return out


def extract_head_wav(
    ffmpeg_bin: str,
    src: Path,
    duration_sec: float,
    *,
    speech_eq: bool = True,
    out_path: Optional[Path] = None,
) -> Path:
    """
    Decode first *duration_sec* to mono 16-bit 16 kHz WAV (optional speech EQ).
    If *out_path* is set, write there (parent dirs created); else a temp file.
    """
    if out_path is None:
        fd, out_name = tempfile.mkstemp(suffix=".wav", prefix="abc_whisper_head_")
        os.close(fd)
        dest = Path(out_name)
    else:
        dest = out_path
        dest.parent.mkdir(parents=True, exist_ok=True)
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
    if speech_eq:
        cmd.extend(["-af", FFMPEG_SPEECH_EQ_AF])
    cmd.extend(
        [
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            str(dest),
        ]
    )
    subprocess.run(cmd, check=True, stderr=subprocess.PIPE)
    return dest


def transcribe_file(model, wav_path: Path, language: str):
    # Short clip: no VAD so “Kapitel” at the start is not trimmed away
    segments, _info = model.transcribe(
        str(wav_path),
        language=language,
        word_timestamps=True,
        vad_filter=False,
    )
    return list(segments)


def _marks_for_mp3(
    model,
    mp3: Path,
    head_sec: float,
    ffmpeg_bin: str,
    language: str,
    chapter_cue: str,
    *,
    mp3_index: int = 0,
    mp3_count: int = 1,
    root: Optional[Path] = None,
    listen_log_dir: Optional[Path] = None,
    speech_eq: bool = True,
    save_filtered_wav_dir: Optional[Path] = None,
) -> list:
    wav: Optional[Path] = None
    keep_wav_on_disk = False
    segments: list = []
    try:
        persist: Optional[Path] = None
        if save_filtered_wav_dir is not None:
            persist = save_filtered_wav_dir / f"{mp3.stem}_speech_eq.wav"
            keep_wav_on_disk = True
        wav = extract_head_wav(
            ffmpeg_bin,
            mp3,
            head_sec,
            speech_eq=speech_eq,
            out_path=persist,
        )
        segments = transcribe_file(model, wav, language)
    except subprocess.CalledProcessError as exc:
        print(f"{mp3}: ffmpeg {exc.stderr!r}", file=sys.stderr)
        raise
    except Exception as exc:
        print(f"{mp3}: {exc}", file=sys.stderr)
        raise
    finally:
        if wav is not None and wav.exists() and not keep_wav_on_disk:
            try:
                wav.unlink()
            except OSError:
                pass

    if listen_log_dir is not None and root is not None:
        try:
            write_listen_log_for_mp3(
                listen_log_dir,
                root,
                mp3,
                segments,
                language=language,
                head_sec=head_sec,
                chapter_cue=chapter_cue,
                de=chapter_cue == "de",
            )
        except OSError as exc:
            print(f"{mp3}: listen log {exc}", file=sys.stderr)
            raise

    words = words_from_segments(segments)
    return find_chapter_marks_for_file(
        words,
        segments,
        str(mp3.resolve()),
        chapter_cue,
        mp3_index=mp3_index,
        mp3_count=mp3_count,
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
    payload: Tuple[str, float, str, str, str, str, str, bool, str, int, int],
) -> list:
    (
        mp3_str,
        head_sec,
        ffmpeg_bin,
        language,
        chapter_cue,
        root_str,
        listen_log_dir_str,
        speech_eq,
        save_filtered_wav_dir_str,
        mp3_index,
        mp3_count,
    ) = payload
    mp3 = Path(mp3_str)
    root = Path(root_str).expanduser().resolve()
    listen_dir: Optional[Path] = (
        Path(listen_log_dir_str).expanduser().resolve()
        if listen_log_dir_str
        else None
    )
    save_filt: Optional[Path] = (
        Path(save_filtered_wav_dir_str).expanduser().resolve()
        if save_filtered_wav_dir_str
        else None
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
        mp3_index=mp3_index,
        mp3_count=mp3_count,
        root=root,
        listen_log_dir=listen_dir,
        speech_eq=speech_eq,
        save_filtered_wav_dir=save_filt,
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
            "Seconds of audio to transcribe per MP3 after the first "
            f"(default: {HEAD_SECONDS_DEFAULT})"
        ),
    )
    parser.add_argument(
        "--head-seconds-first",
        type=float,
        default=HEAD_SECONDS_FIRST_DEFAULT,
        help=(
            "Seconds for the first MP3 in folder order only "
            f"(default: {HEAD_SECONDS_FIRST_DEFAULT})"
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
        default="",
        metavar="DIR",
        help=(
            "If set, write one .listen.txt per MP3 with recognized words "
            f"(under this folder; suggested: …/{LISTEN_LOG_SUBDIR_NAME})."
        ),
    )
    parser.add_argument(
        "--no-speech-eq",
        action="store_true",
        help=(
            "Disable mild FFmpeg high-pass + presence EQ before Whisper "
            "(compare raw head extract)."
        ),
    )
    parser.add_argument(
        "--save-filtered-wav-to",
        default="",
        metavar="DIR",
        help=(
            "If set, write each FFmpeg-processed head clip as WAV here "
            f"(same audio Whisper receives; e.g. …/{FILTERED_PREVIEW_SUBDIR_NAME}) "
            "so you can listen in any player."
        ),
    )
    args = parser.parse_args()
    chapter_cue: str = args.chapter_cue
    speech_eq = not args.no_speech_eq

    root = Path(args.root_dir).expanduser().resolve()
    if not root.is_dir():
        print(f"Not a directory: {root}", file=sys.stderr)
        sys.exit(1)

    listen_log_dir_str = (args.listen_log_dir or "").strip()
    listen_log_dir: Optional[Path] = None
    if listen_log_dir_str:
        listen_log_dir = Path(listen_log_dir_str).expanduser().resolve()

    save_filtered_str = (args.save_filtered_wav_to or "").strip()
    save_filtered_wav_dir: Optional[Path] = None
    if save_filtered_str:
        save_filtered_wav_dir = Path(save_filtered_str).expanduser().resolve()

    mp3_list = list(iter_mp3_files(root))
    head_sec_rest = max(0.5, float(args.head_seconds))
    head_sec_first = max(0.5, float(args.head_seconds_first))
    nfiles = len(mp3_list)
    all_marks: list = []

    workers = min(MAX_PARALLEL_WHISPER_WORKERS, nfiles) if nfiles else 0

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

        for fi, mp3 in enumerate(mp3_list):
            head_this = head_sec_first if fi == 0 else head_sec_rest
            try:
                marks = _marks_for_mp3(
                    model,
                    mp3,
                    head_this,
                    args.ffmpeg,
                    args.language,
                    chapter_cue,
                    mp3_index=fi,
                    mp3_count=nfiles,
                    root=root,
                    listen_log_dir=listen_log_dir,
                    speech_eq=speech_eq,
                    save_filtered_wav_dir=save_filtered_wav_dir,
                )
            except (subprocess.CalledProcessError, Exception):
                sys.exit(1)
            all_marks.extend(marks)
            print(f"[{fi + 1}/{nfiles}]", file=sys.stderr, flush=True)
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
                            (head_sec_first if fi == 0 else head_sec_rest),
                            args.ffmpeg,
                            args.language,
                            chapter_cue,
                            str(root),
                            listen_log_dir_str,
                            speech_eq,
                            save_filtered_str,
                            fi,
                            nfiles,
                        ),
                    )
                    for fi, p in enumerate(mp3_list)
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
            head_seconds_first=head_sec_first,
            head_seconds_rest=head_sec_rest,
            chapter_cue=chapter_cue,
        )
    except OSError as exc:
        print(f"Could not write chapter log: {exc}", file=sys.stderr)
        sys.exit(1)

    if listen_log_dir is not None:
        if chapter_cue == "de":
            print(f"Hör-Protokoll (Transkript pro MP3): {listen_log_dir}", file=sys.stderr, flush=True)
        else:
            print(f"Listen transcript logs (one file per MP3): {listen_log_dir}", file=sys.stderr, flush=True)

    if save_filtered_wav_dir is not None:
        if chapter_cue == "de":
            print(
                f"Vorschau-Audio (FFmpeg → WAV pro MP3): {save_filtered_wav_dir}",
                file=sys.stderr,
                flush=True,
            )
        else:
            print(
                f"Filtered preview WAVs (per MP3): {save_filtered_wav_dir}",
                file=sys.stderr,
                flush=True,
            )

    json.dump(
        {"marks": all_marks, "chapterCue": chapter_cue},
        sys.stdout,
        ensure_ascii=False,
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
