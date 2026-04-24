#!/usr/bin/env python3
"""
For each MP3, transcribe only the first --head-seconds (default 45) with ffmpeg + faster-whisper
to identify the chapter: spoken special labels (Zeittafel, Prolog, Epilog, Prologue, Epilogue) or
“Kapitel/Chapter” + number. German: *Z* as [s] in ASR (z→s), plus *Levenshtein* for stems like
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

MAX_PARALLEL_WHISPER_WORKERS = 4

HEAD_SECONDS_DEFAULT = 45
CHAPTER_LOG_FILENAME = "AudiobookConverter_kapitel.log"


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
    head_seconds: float,
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
            f"scan: first {head_seconds:.0f} s per MP3"
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
) -> list:
    wav: Optional[Path] = None
    try:
        wav = extract_head_wav(ffmpeg_bin, mp3, head_sec)
        segments = transcribe_file(model, wav, language)
    except subprocess.CalledProcessError as exc:
        print(f"{mp3}: ffmpeg {exc.stderr!r}", file=sys.stderr)
        raise
    except Exception as exc:
        print(f"{mp3}: {exc}", file=sys.stderr)
        raise
    finally:
        if wav is not None and wav.exists():
            try:
                wav.unlink()
            except OSError:
                pass

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


def _whisper_pool_job(payload: Tuple[str, float, str, str, str]) -> list:
    mp3_str, head_sec, ffmpeg_bin, language, chapter_cue = payload
    mp3 = Path(mp3_str)
    global _worker_model
    if _worker_model is None:
        raise RuntimeError("Whisper worker pool not initialized")
    return _marks_for_mp3(
        _worker_model, mp3, head_sec, ffmpeg_bin, language, chapter_cue
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
        help=f"Transcribe only the first N seconds (default: {HEAD_SECONDS_DEFAULT})",
    )
    parser.add_argument(
        "--chapter-cue",
        choices=("de", "en"),
        default="de",
        help='Spoken cue before chapter number: "de" = Kapitel, "en" = Chapter',
    )
    args = parser.parse_args()
    chapter_cue: str = args.chapter_cue

    root = Path(args.root_dir).expanduser().resolve()
    if not root.is_dir():
        print(f"Not a directory: {root}", file=sys.stderr)
        sys.exit(1)

    mp3_list = list(iter_mp3_files(root))
    head_sec = max(0.5, float(args.head_seconds))
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

        for idx, mp3 in enumerate(mp3_list, start=1):
            try:
                marks = _marks_for_mp3(
                    model,
                    mp3,
                    head_sec,
                    args.ffmpeg,
                    args.language,
                    chapter_cue,
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
            head_seconds=head_sec,
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
