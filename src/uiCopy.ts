/**
 * User-visible strings. Default locale is `de` (app target audience).
 * Short technical labels (Folder, Mode, device names) stay English; prose is German where it helps.
 */
export type UiLocale = "de" | "en";

/** Default for `getUiCopy()` when called without a locale (e.g. tests). In the app, use `useUiCopy()`; UI follows the chapter language switch. */
export const UI_LOCALE: UiLocale = "de";

type StepKey = 1 | 2 | 3 | 4 | 5;

export type UiCopy = {
  conversionStepTitles: Record<StepKey, string>;
  labelChapterCue: string;
  startButton: string;
  mp3Modal: {
    headline: string;
    fileLine: (n: number) => string;
    cancel: string;
    continue: string;
  };
  step2ModalHeadline: string;
  step3ModalHeadline: string;
  step4ModalHeadline: string;
  m4bSuccessModalHeadline: string;
  selection: {
    chooseMode: { headline: string; content: string };
    chooseDevice: { headline: string; content: string };
    cancel: string;
    use: string;
  };
  modals: {
    close: string;
  };
  errors: {
    notSupported: { headline: string; body: string };
    couldNotChooseFolder: (detail: string) => string;
    errorHeadline: string;
    incomplete: { headline: string; body: (items: string) => string };
    cudaUnavailable: { headline: string; mac: string; other: string };
  };
  missingFieldToken: { folder: string; mode: string; device: string };
  coverAccessibilityFailed: string;
  pythonInfo: {
    header: string;
    pythonEnv: string;
    macosOnly: string;
    donePreview: string;
    install: string;
    update: string;
    feedbackInstall: string;
    feedbackUpdate: string;
    errorHeadline: string;
  };
  step2Summary: (args: {
    chapterCount: number;
    labelsPreview: string;
    moreCount: number;
  }) => string;
  step3Summary: (encodedPath: string) => string;
  step4Summary: (mergedPath: string) => string;
  m4bSuccess: (m4bPath: string) => string;
};

const de: UiCopy = {
  conversionStepTitles: {
    1: "MP3-Dateien zählen",
    2: "Kapitelpositionen ermitteln",
    3: "MP3s zu einer M4A zusammenführen",
    4: "Kapitel in M4A einbetten",
    5: "Hörbuch (M4B) erstellen",
  },
  labelChapterCue: "Sprache:",
  startButton: "Start",
  mp3Modal: {
    headline: "MP3-Dateien",
    fileLine: n =>
      n === 1
        ? "Im ausgewählten Ordner wurde 1 MP3-Datei gefunden (einschließlich Unterordner)."
        : `Im ausgewählten Ordner wurden ${n} MP3-Dateien gefunden (einschließlich Unterordner).`,
    cancel: "Abbrechen",
    continue: "Weiter",
  },
  step2ModalHeadline: "Kapitelpositionen",
  step3ModalHeadline: "Kodierung",
  step4ModalHeadline: "Kapitel einbetten",
  m4bSuccessModalHeadline: "Hörbuch (M4B) erstellt",
  selection: {
    chooseMode: {
      headline: "Modus wählen",
      content: "Bitte eine Modellgröße wählen.",
    },
    chooseDevice: {
      headline: "Gerät wählen",
      content: "Bitte ein Rechen-Backend wählen.",
    },
    cancel: "Abbrechen",
    use: "Übernehmen",
  },
  modals: {
    close: "Schließen",
  },
  errors: {
    notSupported: {
      headline: "Nicht unterstützt",
      body: "Die Ordnerauswahl wird nur unter macOS und Windows unterstützt.",
    },
    couldNotChooseFolder: detail => `Ordner konnte nicht gewählt werden: ${detail}`,
    errorHeadline: "Fehler",
    incomplete: {
      headline: "Unvollständig",
      body: items => `Bitte auch folgendes wählen:\n${items}`,
    },
    cudaUnavailable: {
      headline: "CUDA nicht verfügbar",
      mac: "Unter macOS wird NVIDIA CUDA nicht unterstützt. Bitte „cpu“ wählen.",
      other: "Auf dieser Plattform ist CUDA nicht verfügbar. Bitte „cpu“ wählen.",
    },
  },
  missingFieldToken: { folder: "Folder", mode: "Mode", device: "Device" },
  coverAccessibilityFailed: "Cover konnte nicht geladen werden",
  pythonInfo: {
    header: "Python-Info",
    pythonEnv: "Python-Umgebung:",
    macosOnly: "(nur macOS)",
    donePreview: "(fertig)",
    install: "Installieren",
    update: "Aktualisieren",
    feedbackInstall: "Installation",
    feedbackUpdate: "Aktualisierung",
    errorHeadline: "Fehler",
  },
  step2Summary: ({ chapterCount, labelsPreview, moreCount }) => {
    const morePart = moreCount > 0 ? `\n… und ${moreCount} weitere` : "";
    const verb = chapterCount === 1 ? "wurde" : "wurden";
    return `Es ${verb} ${chapterCount} Kapitel erkannt.${labelsPreview}${morePart}`;
  },
  step3Summary: encodedPath =>
    `Schritt 3 abgeschlossen.\n\nKodierte M4A (noch ohne Kapitel):\n${encodedPath}`,
  step4Summary: mergedPath =>
    `Schritt 4 abgeschlossen.\n\nZusammengeführte Datei mit Kapiteln:\n${mergedPath}`,
  m4bSuccess: m4bPath =>
    `Konvertierung abgeschlossen.\n\nHörbuch (M4B):\n${m4bPath}`,
};

const en: UiCopy = {
  conversionStepTitles: {
    1: "Count MP3 files",
    2: "Detect chapter positions",
    3: "Merge MP3s to single M4A",
    4: "Embed chapters in M4A",
    5: "Create audiobook (M4B)",
  },
  labelChapterCue: "Language:",
  startButton: "Start",
  mp3Modal: {
    headline: "MP3 files",
    fileLine: n =>
      `Found ${n} MP3 file${n === 1 ? "" : "s"} in the selected folder (including subfolders).`,
    cancel: "Cancel",
    continue: "Continue",
  },
  step2ModalHeadline: "Chapter positions",
  step3ModalHeadline: "Encode",
  step4ModalHeadline: "Embed chapters",
  m4bSuccessModalHeadline: "Audiobook (M4B) created",
  selection: {
    chooseMode: {
      headline: "Choose mode",
      content: "Please choose a model size",
    },
    chooseDevice: {
      headline: "Choose device",
      content: "Please choose a compute device",
    },
    cancel: "Cancel",
    use: "Use",
  },
  modals: {
    close: "Close",
  },
  errors: {
    notSupported: {
      headline: "Not supported",
      body: "The folder picker is only supported on macOS and Windows.",
    },
    couldNotChooseFolder: detail => "Could not choose folder: " + detail,
    errorHeadline: "Error",
    incomplete: {
      headline: "Incomplete",
      body: items => `Please also choose:\n${items}`,
    },
    cudaUnavailable: {
      headline: "CUDA unavailable",
      mac: "macOS does not support NVIDIA CUDA. Please choose “cpu”.",
      other: "CUDA is not supported on this platform. Please choose “cpu”.",
    },
  },
  missingFieldToken: { folder: "Folder", mode: "Mode", device: "Device" },
  coverAccessibilityFailed: "Cover lookup failed",
  pythonInfo: {
    header: "Python Info",
    pythonEnv: "Python environment:",
    macosOnly: "(macOS only)",
    donePreview: "(done)",
    install: "Install",
    update: "Update",
    feedbackInstall: "Install",
    feedbackUpdate: "Update",
    errorHeadline: "Error",
  },
  step2Summary: ({ chapterCount, labelsPreview, moreCount }) => {
    const morePart = moreCount > 0 ? `\n… and ${moreCount} more` : "";
    return `Detected ${chapterCount} chapter${chapterCount === 1 ? "" : "s"}.${labelsPreview}${morePart}`;
  },
  step3Summary: encodedPath =>
    `Step 3 complete.\n\nEncoded M4A (no chapters yet):\n${encodedPath}`,
  step4Summary: mergedPath =>
    `Step 4 complete.\n\nMerged file with chapters:\n${mergedPath}`,
  m4bSuccess: m4bPath =>
    `Conversion complete.\n\nAudiobook (M4B):\n${m4bPath}`,
};

export function getUiCopy(locale: UiLocale = UI_LOCALE): UiCopy {
  return locale === "en" ? en : de;
}
