# Chapter scan — regression audio

Place MP3 files in **`samples/`**. Use this naming pattern so **folder order** matches the book and the first track can use the long head pass (important for **Zeittafel**):

`NNN_Slug.mp3` — `NNN` is a zero-padded sort prefix (`000`, `001`, …). `Slug` is one of:

- `Zeittafel`, `Prolog`, `Epilog` (specials)
- `Kapitel_1`, `Kapitel_2`, … (underscore + number; maps to **Kapitel 1**, **Kapitel 2**, …)

Examples: `000_Zeittafel.mp3`, `001_Prolog.mp3`, `002_Kapitel_1.mp3`.

The unittest maps these names to expected labels (see `expected_label_from_fixture_name` in `tests/test_chapter_scan_models.py`). **Do not** rely on plain `Zeittafel.mp3` without a prefix unless you control sort order another way—the first file in sort order gets the 60 s from-start pass.

## Running tests

From the repository root:

```bash
npm run test:chapter-scan
```

This runs `scripts/run_chapter_scan_tests.sh`, which uses **`$HOME/.audioBookConverter/bin/python3`** when that binary exists (recommended: same environment as the macOS app), otherwise `python3` on your `PATH`.

If you run unittest yourself, use the same interpreter:

```bash
~/.audioBookConverter/bin/python3 -m unittest tests.test_chapter_scan_models -v
```

The test class is **skipped** (exit code 0, shown as `s` in verbose mode) when any of these are missing: sample `.mp3` files in `samples/`, `ffmpeg` on `PATH`, or `faster-whisper` + `onnxruntime` in that Python. You will not get a red failure in those cases—only a skip with a short reason.

By default, **every** Whisper size in the built-in list (see `_DEFAULT_MODELS` in `tests/test_chapter_scan_models.py`) is executed **if that model is already in the local Hugging Face cache**; models that are not cached are **skipped** (no download during tests). The **`tiny`**, **`tiny.en`**, and **`base`** checkpoints are **not** in the default list and are **skipped** if you request them — on these German audiobook clips they still miss many chapter cues (e.g. `tiny` ~4/6 marks, `base` ~2/6 in our checks). Use **`small`** or larger for meaningful regression. To only run certain sizes:

```bash
CHAPTER_SCAN_TEST_MODELS=small,base npm run test:chapter-scan
```

Audio files under `samples/` are **gitignored** to keep the repo small; copy your fixtures here locally or use `git add -f` for tiny committed clips.

When you run **`npm run test:chapter-scan`** (or unittest directly), the script is invoked with **`--listen-log-dir`** pointing at **`tests/chapter_scan_logs/listen/`** (that tree is gitignored). Each fixture MP3 gets a `*_listen.txt` file with **all words** Whisper produced (timestamps when available), grouped by decode pass—useful for debugging recognition without changing production scans unless you pass `--listen-log-dir` yourself.
