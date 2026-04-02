# Cursor, KI-Kontext und Rechner-Wechsel

Diese Datei ergänzt das Repo für **neue Maschinen** und **neue Chat-Sessions**: Was im Projekt liegt, was lokal bei dir liegt, und was du manuell mitnehmen musst.

## Im Repository (mit Git überall gleich)

| Pfad | Zweck |
|------|--------|
| `.cursor/rules/*.mdc` | **Cursor Project Rules** – gelten für dieses Repo, wenn du es in Cursor öffnest. |
| `docs/cursor-and-handoff.md` | Diese Übersicht. |
| `AGENTS.md` | Kurzverweis für Agenten/Assistenten. |
| `scripts/whisper_chapter_scan.py` | Schritt 2: Whisper, 45 s Kopf, Log `AudiobookConverter_kapitel.log`. |
| `scripts/merge_mp3_chapters.py` | Schritt 3: MP3-Merge, Kapitel-Metadaten, AAC 48k. |
| `src/conversionPipeline.ts` | Pipeline-Schritte 1–4 und native Aufrufe. |
| `macos/.../DependencyStatus.mm` | Native Bridge (ffmpeg-Pfade, venv-Python, RCT-Methoden). |

## Nur auf deinem Account / Rechner (nicht im Repo)

| Was | Wo typisch | Mitnahme |
|-----|------------|----------|
| **Cursor User Rules** | Cursor Settings → Rules | Export / manuell kopieren. |
| **Cursor Skills** | `~/.cursor/skills-cursor/` (o. ä.) | Ordner auf neuen Rechner kopieren oder Skills neu anlegen. |
| **Chat-Verlauf** | Cursor Cloud / lokal | **Geht nicht als „Repo“-Export** – wichtige Entscheidungen in Commits, Issues oder hier in `docs/` festhalten. |
| **Python venv** | `<Repo>/.audioBookConverter` | **Nicht committen**; auf neuem Rechner venv neu anlegen und Pakete wie in der App (`faster-whisper`, etc.) installieren. |

## Plattformen

- **macOS:** Vollständiger Pfad: native Methoden + Skripte wie oben.
- **Windows / Linux:** Gleiche **Skripte** sind nutzbar, wenn `ffmpeg`/`ffprobe` und Python-Umgebung passen; **React-Native-Bridge-Methoden** aus `DependencyStatus.mm` müssen für die jeweilige Plattform portiert oder durch z. B. CLI/Spawn aus JS ersetzt werden. `conversionPipeline.ts` prüft derzeit `Platform.OS === 'macos'` für die nativen Schritte.

## Kurz-Checkliste neuer Rechner

1. Repo klonen, `npm install`.
2. **ffmpeg** installieren und im PATH (GUI-Apps unter macOS: oft Homebrew-Pfade, siehe `FfmpegExecutablePath` in `DependencyStatus.mm`).
3. **Python 3** + venv **`.audioBookConverter`** im Repo anlegen; `faster-whisper` wie im Abhängigkeits-Panel.
4. RN-Ziel plattformabhängig bauen (z. B. macOS-Schema unter Xcode).
5. Cursor öffnen – **Project Rules** aus `.cursor/rules/` werden geladen.

## Ausgaben im gewählten MP3-/Projektordner (zur Erwartung)

- `AudiobookConverter_kapitel.log` – erkannte Kapitel.
- `AudiobookConverter_merged.m4a` – Zwischenprodukt nach Schritt 3.
- `AudiobookConverter.m4b` – finales Hörbuch nach Schritt 4 (M4A wird entfernt).

Wenn sich die Pipeline ändert, diese Datei und die **`.mdc`-Regeln** bitte mitaktualisieren, damit die nächste KI-Session den gleichen Stand hat.
