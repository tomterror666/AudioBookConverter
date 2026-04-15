#!/usr/bin/env python3
"""
Merge sorted MP3s under --root-dir into one M4A with ffmpeg;
place chapter marks (filePath, startSec, label) on the full timeline.
"""
import argparse
import bisect
import concurrent.futures
import json
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

try:
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(line_buffering=True)
except Exception:
    pass

# Parallel ffprobe subprocesses; I/O-bound — cap avoids huge process fan-out.
_MAX_FFPROBE_WORKERS = 32


def emit_merge_progress(cur: int, tot: int) -> None:
    """stderr: [cur/tot] for native UI progress (merge, kind=merge)."""
    print(f"[{cur}/{tot}]", file=sys.stderr, flush=True)


def _out_time_npt_to_seconds(val: str) -> float | None:
    """HH:MM:SS.micro from ffmpeg progress line out_time=…"""
    val = val.strip()
    if not val:
        return None
    try:
        parts = val.split(":")
        if len(parts) == 3:
            h, m, s = parts
            return float(h) * 3600.0 + float(m) * 60.0 + float(s)
        if len(parts) == 2:
            m, s = parts
            return float(m) * 60.0 + float(s)
        return float(val)
    except ValueError:
        return None


def _progress_int_microseconds(value_raw: str) -> int | None:
    """Parse ffmpeg -progress numeric field (microseconds); FFmpeg 8+ may send N/A."""
    v = value_raw.strip()
    if not v or v.upper() == "N/A":
        return None
    try:
        return int(v)
    except ValueError:
        return None


def _latest_out_time_sec_from_progress_dump(content: str) -> float | None:
    """Read the latest output time from ffmpeg -progress (key=value)."""
    sec: float | None = None
    for line in content.splitlines():
        line = line.strip()
        if line.startswith("out_time_us="):
            us = _progress_int_microseconds(line.split("=", 1)[1])
            if us is not None:
                sec = us / 1_000_000.0
        elif line.startswith("out_time_ms="):
            # In official ffmpeg -progress, out_time_ms and out_time_us are both microseconds
            # (misleading name). Do NOT divide by 1000.
            v = _progress_int_microseconds(line.split("=", 1)[1])
            if v is not None:
                sec = v / 1_000_000.0
        elif line.startswith("out_time="):
            # Common on audio/older builds instead of out_time_us (otherwise no progress).
            parsed = _out_time_npt_to_seconds(line.split("=", 1)[1])
            if parsed is not None:
                sec = parsed
    return sec


def _stdout_progress_reader(stdout, q: queue.Queue) -> None:
    """Read ffmpeg -progress key=value blocks from stdout (pipe:1)."""
    buf: list[str] = []
    try:
        for line in stdout:
            try:
                line = line.rstrip("\r\n")
                if line.startswith("progress="):
                    block = "\n".join(buf)
                    buf.clear()
                    sec = _latest_out_time_sec_from_progress_dump(block)
                    if sec is not None:
                        q.put(sec)
                elif line.strip():
                    buf.append(line)
            except Exception:
                # Never kill this thread — broken lines should not freeze the UI bar.
                continue
    finally:
        q.put(None)


def run_ffmpeg_with_progress(
    argv: list[str],
    prog_file: Path,
    duration_sec: float,
    *,
    cur_start: int,
    cur_width: int,
    n_total: int,
    chapter_starts_sec: list[float] | None = None,
    chapter_total: int = 0,
    chapter_is_mp3_fallback: bool = False,
) -> None:
    """
    ffmpeg with -nostats -progress pipe:1 — progress as a stream on stdout (more reliable than
    polling a truncated file where empty reads can stall the bar).
    prog_file is unused (kept for caller API compatibility).
    """
    _ = prog_file
    ffmpeg_bin = argv[0]
    rest = argv[1:]
    full_cmd = [ffmpeg_bin, "-nostats", "-progress", "pipe:1"] + rest
    q: queue.Queue[float | None] = queue.Queue()
    proc = subprocess.Popen(
        full_cmd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    assert proc.stdout is not None
    reader = threading.Thread(
        target=_stdout_progress_reader,
        args=(proc.stdout, q),
        daemon=True,
    )
    reader.start()

    err_parts: list[str] = []

    def drain_stderr() -> None:
        if proc.stderr is not None:
            err_parts.append(proc.stderr.read())

    err_thread = threading.Thread(target=drain_stderr, daemon=True)
    err_thread.start()

    denom = max(float(duration_sec), 0.001)
    end_cur = cur_start + cur_width
    last_emitted = cur_start - 1
    # Output time from ffmpeg (concat/AAC may stall or jump).
    last_real_sec = 0.0
    t_wall0 = time.monotonic()
    # Wall-time budget for synthetic progress when ffmpeg -progress is sparse (e.g. aac_at / ffmpeg 8).
    # Real merges often run ~50–300× realtime on Apple Silicon; /18 assumed ~18× and left the bar stuck for minutes.
    budget_wall = max(30.0, min(900.0, float(denom) / 120.0))
    mode_py = "mp3" if chapter_is_mp3_fallback else "marks"
    last_ch_idx = [0]

    def maybe_emit_chapter(t_sec: float) -> None:
        if chapter_total <= 0 or chapter_starts_sec is None:
            return
        idx = bisect.bisect_right(chapter_starts_sec, t_sec)
        idx = max(1, min(idx, chapter_total))
        if idx != last_ch_idx[0]:
            last_ch_idx[0] = idx
            print(f"[ch:{idx}:{chapter_total}:{mode_py}]", file=sys.stderr, flush=True)

    maybe_emit_chapter(0.0)

    def apply_merged_progress() -> None:
        nonlocal last_emitted
        wall = time.monotonic() - t_wall0
        syn_frac = min(0.97, wall / budget_wall)
        syn_sec = syn_frac * denom * 0.999
        merged_sec = max(last_real_sec, syn_sec)
        merged_sec = min(merged_sec, denom * 0.999)
        frac = merged_sec / denom
        cur = cur_start + int(frac * float(cur_width))
        cur = min(cur, end_cur - 1)
        if cur > last_emitted:
            last_emitted = cur
            emit_merge_progress(cur, n_total)
        maybe_emit_chapter(merged_sec)

    try:
        while True:
            try:
                item = q.get(timeout=0.35)
            except queue.Empty:
                apply_merged_progress()
                if proc.poll() is not None:
                    break
                continue
            if item is None:
                # Progress stdout closed; encoder may still run. Keep using timeout branch below
                # (synthetic progress + proc.poll) — do not spin a tight loop on the pipe.
                continue
            last_real_sec = max(last_real_sec, float(item))
            apply_merged_progress()
        while True:
            try:
                item = q.get_nowait()
            except queue.Empty:
                break
            if item is not None:
                last_real_sec = max(last_real_sec, float(item))
                apply_merged_progress()
    finally:
        proc.wait()
        err_thread.join(timeout=30.0)

    err = "".join(err_parts)
    if proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, full_cmd, stderr=err)

    emit_merge_progress(end_cur, n_total)
    if chapter_total > 0:
        print(f"[ch:{chapter_total}:{chapter_total}:{mode_py}]", file=sys.stderr, flush=True)


def iter_mp3_files(root: Path):
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix.lower() == ".mp3":
            yield path


def probe_duration(ffmpeg: str, audio_path: Path) -> float:
    ffprobe = str(Path(ffmpeg).parent / "ffprobe")
    r = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(audio_path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(r.stdout.strip())


def probe_mp3_durations_parallel(ffmpeg: str, mp3s: list[Path], n_total: int) -> list[float]:
    """Run ffprobe on all paths in parallel; preserve file order; emit merge progress as each finishes."""
    n = len(mp3s)
    if n == 0:
        return []
    lock = threading.Lock()
    done_count = 0

    def probe_one(path: Path) -> float:
        nonlocal done_count
        d = probe_duration(ffmpeg, path)
        with lock:
            done_count += 1
            emit_merge_progress(done_count, n_total)
        return d

    workers = min(n, _MAX_FFPROBE_WORKERS)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        return list(executor.map(probe_one, mp3s))


def write_concat_list(mp3s, list_path: Path):
    with open(list_path, "w", encoding="utf-8") as f:
        for p in mp3s:
            ap = p.resolve()
            s = str(ap).replace("'", "'\\''")
            f.write(f"file '{s}'\n")


def escape_meta(s: str) -> str:
    return s.replace("\\", "\\\\").replace("=", "\\=").replace(";", "\\;").replace("#", "\\#")


def build_chapter_metadata(chapters_ms, total_duration_ms: int) -> str:
    lines = [";FFMETADATA1", ""]
    n = len(chapters_ms)
    for i, (start_ms, title) in enumerate(chapters_ms):
        if i + 1 < n:
            end_ms = chapters_ms[i + 1][0]
        else:
            end_ms = total_duration_ms
        if end_ms <= start_ms:
            end_ms = min(start_ms + 1000, total_duration_ms)
        lines.append("[CHAPTER]")
        lines.append("TIMEBASE=1/1000")
        lines.append(f"START={int(start_ms)}")
        lines.append(f"END={int(end_ms)}")
        lines.append(f"title={escape_meta(title)}")
        lines.append("")
    return "\n".join(lines)


def _load_marks_list(marks_json_path: Path) -> list:
    with open(marks_json_path, encoding="utf-8") as f:
        payload = json.load(f)
    marks = payload.get("marks") or []
    if not isinstance(marks, list):
        print("marks must be a list", file=sys.stderr)
        sys.exit(1)
    return marks


def _chapter_plan_from_marks(
    marks: list,
    path_to_index: dict[str, int],
    offsets_sec: list[float],
    nfiles: int,
) -> tuple[list[tuple[int, str]], list[float], int, bool]:
    global_chapters: list[tuple[int, str]] = []
    for m in marks:
        fp = m.get("filePath")
        if not fp:
            continue
        key = str(Path(fp).resolve())
        idx = path_to_index.get(key)
        if idx is None:
            print(f"Unknown file in marks: {fp}", file=sys.stderr)
            sys.exit(1)
        try:
            start_sec = float(m["startSec"])
        except (KeyError, TypeError, ValueError):
            print(f"Invalid startSec in mark: {m}", file=sys.stderr)
            sys.exit(1)
        label = str(m.get("label") or f"Chapter {m.get('number', '')}")
        global_start_ms = int(round((offsets_sec[idx] + start_sec) * 1000))
        global_chapters.append((global_start_ms, label))

    global_chapters.sort(key=lambda x: (x[0], x[1]))
    if global_chapters:
        chapter_starts_sec = sorted(ms / 1000.0 for ms, _ in global_chapters)
        chapter_meta_total = len(chapter_starts_sec)
        return global_chapters, chapter_starts_sec, chapter_meta_total, False
    chapter_starts_sec = list(offsets_sec)
    return global_chapters, chapter_starts_sec, nfiles, True


def _concat_mp3s_to_m4a(
    ffmpeg: str,
    mp3s: list[Path],
    pre_meta: Path,
    total_sec: float,
    *,
    nfiles: int,
    w_concat: int,
    n_total: int,
    chapter_starts_sec: list[float],
    chapter_meta_total: int,
    chapter_is_mp3_fallback: bool,
    td_p: Path,
) -> None:
    clist = td_p / "concat.txt"
    write_concat_list(mp3s, clist)
    cmd_concat = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(clist),
        "-c:a",
        "aac_at",
        "-b:a",
        "48k",
        "-movflags",
        "+faststart",
        str(pre_meta),
    ]
    prog_concat = td_p / "ff_progress_concat.txt"
    try:
        run_ffmpeg_with_progress(
            cmd_concat,
            prog_concat,
            total_sec,
            cur_start=nfiles,
            cur_width=w_concat,
            n_total=n_total,
            chapter_starts_sec=chapter_starts_sec,
            chapter_total=chapter_meta_total,
            chapter_is_mp3_fallback=chapter_is_mp3_fallback,
        )
    except subprocess.CalledProcessError as exc:
        print(exc.stderr or "ffmpeg concat", file=sys.stderr)
        sys.exit(1)


def run_encode_phase(root: Path, ffmpeg: str, out_path: Path) -> None:
    """Probe + concat MP3s → AAC M4A (no chapter metadata)."""
    mp3s = list(iter_mp3_files(root))
    if not mp3s:
        print("No MP3 files found.", file=sys.stderr)
        sys.exit(1)
    nfiles = len(mp3s)
    w_concat = max(400, nfiles * 15)
    n_total = nfiles + w_concat
    emit_merge_progress(0, n_total)
    durations = probe_mp3_durations_parallel(ffmpeg, mp3s, n_total)
    offsets_sec: list[float] = []
    acc = 0.0
    for d in durations:
        offsets_sec.append(acc)
        acc += d
    total_sec = acc
    chapter_starts_sec = list(offsets_sec)
    chapter_meta_total = nfiles
    chapter_is_mp3_fallback = True
    with tempfile.TemporaryDirectory() as td:
        td_p = Path(td)
        pre_meta = td_p / "pre.m4a"
        _concat_mp3s_to_m4a(
            ffmpeg,
            mp3s,
            pre_meta,
            total_sec,
            nfiles=nfiles,
            w_concat=w_concat,
            n_total=n_total,
            chapter_starts_sec=chapter_starts_sec,
            chapter_meta_total=chapter_meta_total,
            chapter_is_mp3_fallback=chapter_is_mp3_fallback,
            td_p=td_p,
        )
        try:
            shutil.copy2(pre_meta, out_path)
        except OSError as exc:
            print(str(exc), file=sys.stderr)
            sys.exit(1)
    emit_merge_progress(n_total, n_total)
    print(json.dumps({"outputPath": str(out_path)}))


def run_mux_phase(
    root: Path,
    ffmpeg: str,
    marks_json_path: Path,
    encoded_path: Path,
    out_path: Path,
    *,
    delete_encoded: bool,
) -> None:
    """Chapter metadata + copy mux from encoded M4A → merged M4A."""
    if not encoded_path.is_file():
        print(f"Encoded audio not found: {encoded_path}", file=sys.stderr)
        sys.exit(1)
    marks = _load_marks_list(marks_json_path)
    mp3s = list(iter_mp3_files(root))
    if not mp3s:
        print("No MP3 files found.", file=sys.stderr)
        sys.exit(1)
    nfiles = len(mp3s)
    w_mux = max(50, nfiles * 3)
    n_total = nfiles + w_mux
    emit_merge_progress(0, n_total)
    path_to_index = {str(p.resolve()): i for i, p in enumerate(mp3s)}
    durations = probe_mp3_durations_parallel(ffmpeg, mp3s, n_total)
    offsets_sec: list[float] = []
    acc = 0.0
    for d in durations:
        offsets_sec.append(acc)
        acc += d
    total_sec = acc
    total_ms = max(1, int(round(total_sec * 1000)))
    global_chapters, chapter_starts_sec, chapter_meta_total, chapter_is_mp3_fallback = (
        _chapter_plan_from_marks(marks, path_to_index, offsets_sec, nfiles)
    )

    if not global_chapters:
        try:
            shutil.copy2(encoded_path, out_path)
        except OSError as exc:
            print(str(exc), file=sys.stderr)
            sys.exit(1)
        emit_merge_progress(n_total, n_total)
        print(json.dumps({"outputPath": str(out_path)}))
        if delete_encoded:
            try:
                encoded_path.unlink()
            except OSError:
                pass
        return

    with tempfile.TemporaryDirectory() as td:
        td_p = Path(td)
        meta = td_p / "chapters.ffmeta"
        meta.write_text(
            build_chapter_metadata(global_chapters, total_ms),
            encoding="utf-8",
        )
        cmd_ch = [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(encoded_path),
            "-i",
            str(meta),
            "-map_metadata",
            "1",
            "-map_chapters",
            "1",
            "-codec",
            "copy",
            str(out_path),
        ]
        prog_mux = td_p / "ff_progress_mux.txt"
        try:
            run_ffmpeg_with_progress(
                cmd_ch,
                prog_mux,
                total_sec,
                cur_start=nfiles,
                cur_width=w_mux,
                n_total=n_total,
                chapter_starts_sec=chapter_starts_sec,
                chapter_total=chapter_meta_total,
                chapter_is_mp3_fallback=chapter_is_mp3_fallback,
            )
        except subprocess.CalledProcessError as exc:
            print(exc.stderr or "ffmpeg chapters", file=sys.stderr)
            sys.exit(1)

    print(json.dumps({"outputPath": str(out_path)}))
    if delete_encoded:
        try:
            encoded_path.unlink()
        except OSError:
            pass


def run_full_phase(
    root: Path,
    ffmpeg: str,
    marks: list,
    out_path: Path,
) -> None:
    """Single-shot: encode + optional chapter mux (legacy / CLI)."""
    mp3s = list(iter_mp3_files(root))
    if not mp3s:
        print("No MP3 files found.", file=sys.stderr)
        sys.exit(1)
    nfiles = len(mp3s)
    w_concat = max(400, nfiles * 15)
    w_mux = 50
    n_total = nfiles + w_concat + w_mux
    emit_merge_progress(0, n_total)
    path_to_index = {str(p.resolve()): i for i, p in enumerate(mp3s)}
    durations = probe_mp3_durations_parallel(ffmpeg, mp3s, n_total)
    offsets_sec: list[float] = []
    acc = 0.0
    for d in durations:
        offsets_sec.append(acc)
        acc += d
    total_sec = acc
    total_ms = max(1, int(round(total_sec * 1000)))
    global_chapters, chapter_starts_sec, chapter_meta_total, chapter_is_mp3_fallback = (
        _chapter_plan_from_marks(marks, path_to_index, offsets_sec, nfiles)
    )

    with tempfile.TemporaryDirectory() as td:
        td_p = Path(td)
        pre_meta = td_p / "pre.m4a"
        _concat_mp3s_to_m4a(
            ffmpeg,
            mp3s,
            pre_meta,
            total_sec,
            nfiles=nfiles,
            w_concat=w_concat,
            n_total=n_total,
            chapter_starts_sec=chapter_starts_sec,
            chapter_meta_total=chapter_meta_total,
            chapter_is_mp3_fallback=chapter_is_mp3_fallback,
            td_p=td_p,
        )

        if not global_chapters:
            try:
                shutil.copy2(pre_meta, out_path)
            except OSError as exc:
                print(str(exc), file=sys.stderr)
                sys.exit(1)
            emit_merge_progress(n_total, n_total)
            print(json.dumps({"outputPath": str(out_path)}))
            return

        meta = td_p / "chapters.ffmeta"
        meta.write_text(
            build_chapter_metadata(global_chapters, total_ms),
            encoding="utf-8",
        )
        cmd_ch = [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(pre_meta),
            "-i",
            str(meta),
            "-map_metadata",
            "1",
            "-map_chapters",
            "1",
            "-codec",
            "copy",
            str(out_path),
        ]
        prog_mux = td_p / "ff_progress_mux.txt"
        try:
            run_ffmpeg_with_progress(
                cmd_ch,
                prog_mux,
                total_sec,
                cur_start=nfiles + w_concat,
                cur_width=w_mux,
                n_total=n_total,
                chapter_starts_sec=chapter_starts_sec,
                chapter_total=chapter_meta_total,
                chapter_is_mp3_fallback=chapter_is_mp3_fallback,
            )
        except subprocess.CalledProcessError as exc:
            print(exc.stderr or "ffmpeg chapters", file=sys.stderr)
            sys.exit(1)

    print(json.dumps({"outputPath": str(out_path)}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--phase",
        choices=["encode", "mux", "full"],
        required=True,
        help="encode: MP3→M4A only; mux: chapters onto existing M4A; full: one-shot (legacy)",
    )
    parser.add_argument("--root-dir", required=True)
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--marks-json", help="required for mux and full")
    parser.add_argument(
        "--encoded-audio",
        help="input M4A from encode phase; required for mux",
    )
    parser.add_argument(
        "--delete-encoded-after-mux",
        action="store_true",
        help="remove --encoded-audio after successful mux",
    )
    args = parser.parse_args()

    root = Path(args.root_dir).expanduser().resolve()
    if not root.is_dir():
        print(f"Not a directory: {root}", file=sys.stderr)
        sys.exit(1)

    ffmpeg = args.ffmpeg
    out_path = Path(args.output).expanduser().resolve()

    if args.phase == "encode":
        run_encode_phase(root, ffmpeg, out_path)
        return

    if args.phase == "mux":
        if not args.marks_json or not args.encoded_audio:
            print("mux phase requires --marks-json and --encoded-audio", file=sys.stderr)
            sys.exit(2)
        run_mux_phase(
            root,
            ffmpeg,
            Path(args.marks_json),
            Path(args.encoded_audio).expanduser().resolve(),
            out_path,
            delete_encoded=bool(args.delete_encoded_after_mux),
        )
        return

    # full
    if not args.marks_json:
        print("full phase requires --marks-json", file=sys.stderr)
        sys.exit(2)
    marks = _load_marks_list(Path(args.marks_json))
    run_full_phase(root, ffmpeg, marks, out_path)


if __name__ == "__main__":
    main()
