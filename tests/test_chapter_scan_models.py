"""
Integration tests: run scripts/whisper_chapter_scan.py on tests/chapter_scan_fixtures/samples
and assert each MP3’s detected chapter label matches the expected label derived from the file
name (see `expected_label_from_fixture_name`).

Models are taken from CHAPTER_SCAN_TEST_MODELS (comma-separated) or the default list.
Models not present in the local HF cache are skipped (no network download in tests).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "whisper_chapter_scan.py"
SAMPLES_DIR = REPO_ROOT / "tests" / "chapter_scan_fixtures" / "samples"
# Word-level transcripts from chapter scan tests (gitignored).
LISTEN_LOG_DIR = REPO_ROOT / "tests" / "chapter_scan_logs" / "listen"

# Default: common CTranslate2 snapshot names used with faster-whisper (see project script / HF).
# Note: "tiny" and "base" are omitted — on real German clips they often miss most chapters
# (see _MODELS_BELOW_REGRESSION_BAR). Default starts at "small".
_DEFAULT_MODELS = (
    "small",
    "medium",
    "large-v1",
    "large-v2",
    "large-v3",
)

# Smaller Whisper checkpoints: not reliable enough for German chapter-title ASR on these fixtures.
_MODELS_BELOW_REGRESSION_BAR = frozenset({"tiny", "tiny.en", "base"})


def _models_from_env() -> list[str]:
    raw = os.environ.get("CHAPTER_SCAN_TEST_MODELS", "").strip()
    if raw:
        return [m.strip() for m in raw.split(",") if m.strip()]
    return list(_DEFAULT_MODELS)


def _import_scan_module():
    sys.path.insert(0, str(REPO_ROOT / "scripts"))
    import whisper_chapter_scan as wcs  # noqa: PLC0415

    return wcs


def _ffmpeg() -> str | None:
    return shutil.which("ffmpeg")


def _list_sample_mp3s() -> list[Path]:
    if not SAMPLES_DIR.is_dir():
        return []
    return sorted(
        p for p in SAMPLES_DIR.iterdir() if p.is_file() and p.suffix.lower() == ".mp3"
    )


def _skip_chapter_scan_suite_reason() -> str | None:
    """
    If not None, the whole class is skipped (no hard failures in CI or fresh clones).
    Order: fixtures first, then tooling this Python.
    """
    if not SAMPLES_DIR.is_dir():
        return f"Create {SAMPLES_DIR} (see tests/chapter_scan_fixtures/README.md)"
    if not _list_sample_mp3s():
        return (
            "Add .mp3 fixtures to tests/chapter_scan_fixtures/samples/ "
            "(files are gitignored; copy tracks locally). See tests/chapter_scan_fixtures/README.md"
        )
    if not _ffmpeg():
        return "Install ffmpeg and ensure it is on your PATH (required by whisper_chapter_scan.py)"
    try:
        subprocess.run(
            [sys.executable, "-c", "import faster_whisper; import onnxruntime"],
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (subprocess.CalledProcessError, OSError, subprocess.TimeoutExpired) as e:
        err = ""
        if isinstance(e, subprocess.CalledProcessError) and e.stderr:
            err = f" ({e.stderr.strip()[:200]})"
        return (
            f"This Python ({sys.executable}) cannot import faster_whisper and onnxruntime.{err} "
            "Use the in-app venv: ~/.audioBookConverter (npm run test:chapter-scan uses it when present), "
            "or: pip install faster-whisper onnxruntime"
        )
    return None


_SKIP = _skip_chapter_scan_suite_reason()


def expected_label_from_fixture_name(path: Path) -> str:
    """
    Convention: ``NNN_Slug.mp3`` where NNN sorts tracks (000 first = long head pass for
    Zeittafel-style intros). Slug examples: ``Zeittafel``, ``Prolog``, ``Kapitel_1``.
    """
    stem = path.stem
    m = re.fullmatch(r"(\d+)_(.+)", stem)
    slug = m.group(2) if m else stem
    km = re.fullmatch(r"Kapitel_(\d+)", slug, re.I)
    if km:
        return f"Kapitel {int(km.group(1))}"
    specials = {
        "zeittafel": "Zeittafel",
        "prolog": "Prolog",
        "epilog": "Epilog",
        "prologue": "Prologue",
    }
    if slug.lower() in specials:
        return specials[slug.lower()]
    return slug.replace("_", " ")


def _expected_label_by_path(paths: list[Path]) -> dict[str, str]:
    return {str(p.resolve()): expected_label_from_fixture_name(p) for p in paths}


def _run_scan(model_size: str, root: Path) -> dict:
    ff = _ffmpeg()
    if not ff:
        raise unittest.SkipTest("ffmpeg not on PATH")
    LISTEN_LOG_DIR.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        str(SCRIPT),
        "--root-dir",
        str(root),
        "--listen-log-dir",
        str(LISTEN_LOG_DIR),
        "--model-size",
        model_size,
        "--device",
        "cpu",
        "--compute-type",
        "int8",
        "--ffmpeg",
        ff,
        "--language",
        "de",
        "--chapter-cue",
        "de",
    ]
    proc = subprocess.run(
        cmd,
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=3600,
        check=False,
    )
    if proc.returncode != 0:
        err = (proc.stderr or "") + (proc.stdout or "")
        raise AssertionError(
            f"whisper_chapter_scan.py failed (model={model_size}): {err[:4000]}"
        )
    return json.loads(proc.stdout)


@unittest.skipIf(_SKIP, _SKIP or "")
class ChapterScanModelTests(unittest.TestCase):
    """Run the real chapter scan per cached Whisper model."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.mp3s = _list_sample_mp3s()
        cls.expected_by_path = _expected_label_by_path(cls.mp3s)
        wcs = _import_scan_module()
        cls._wcs = wcs

    def test_each_cached_model_matches_stem_labels(self) -> None:
        for model in _models_from_env():
            with self.subTest(model=model):
                try:
                    if not self._wcs.whisper_model_is_cached_locally(model):
                        self.skipTest(
                            f"model not in local HF cache (no download in tests): {model!r}. "
                            "Run the app or whisper once to cache it, or set "
                            "CHAPTER_SCAN_TEST_MODELS=small,medium"
                        )
                except ValueError as e:
                    self.skipTest(str(e))
                if model in _MODELS_BELOW_REGRESSION_BAR:
                    self.skipTest(
                        f"Whisper model {model!r} is below the accuracy bar for this regression "
                        "suite on German audiobook clips (e.g. misses most Zeittafel/Kapitel cues). "
                        "Use small or larger — e.g. CHAPTER_SCAN_TEST_MODELS=small"
                    )
                data = _run_scan(model, SAMPLES_DIR)
                self.assertEqual(data.get("chapterCue"), "de")
                marks = data.get("marks", [])
                self.assertEqual(
                    len(marks),
                    len(self.mp3s),
                    f"mark count for {model}: got {len(marks)}, want {len(self.mp3s)}",
                )
                by_file: dict[str, str] = {}
                for m in marks:
                    fp = m.get("filePath", "")
                    by_file[fp] = m.get("label", "")

                for p in self.mp3s:
                    key = str(p.resolve())
                    exp = self.expected_by_path[key]
                    self.assertIn(
                        key,
                        by_file,
                        f"{model}: missing mark for {p.name}. Got files: {list(by_file)}",
                    )
                    self.assertEqual(
                        by_file[key],
                        exp,
                        f"{model}: {p.name} expected {exp!r}, got {by_file[key]!r}",
                    )


if __name__ == "__main__":
    unittest.main()
