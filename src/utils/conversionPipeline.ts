import { NativeModules, Platform } from "react-native";

export class ConversionCancelledError extends Error {
  constructor() {
    super("Conversion cancelled");
    this.name = "ConversionCancelledError";
  }
}

export function isConversionCancelled(e: unknown): boolean {
  return e instanceof ConversionCancelledError;
}

async function nativeCountMp3Files(directoryPath: string): Promise<number> {
  if (Platform.OS !== "macos") {
    throw new Error("MP3 counting is only available on macOS.");
  }
  const mod = NativeModules.DependencyStatus as
    | { countMp3FilesInDirectory?: (p: string) => Promise<number> }
    | undefined;
  const fn = mod?.countMp3FilesInDirectory;
  if (typeof fn !== "function") {
    throw new Error("countMp3FilesInDirectory (native) is not available.");
  }
  const n = await fn(directoryPath);
  return typeof n === "number" ? n : Number(n);
}

const WHISPER_COMPUTE_TYPE = "int8_float32" as const;

/** Whisper transcript keyword: German "Kapitel" vs English "Chapter". */
export type ChapterCue = "de" | "en";

export type ChapterMark = {
  filePath: string;
  startSec: number;
  number: number;
  label: string;
};

/** Written next to MP3s after a successful Whisper run; reused to skip re-scanning. */
export const CHAPTER_MARKS_CACHE_BASENAME = "AudiobookConverter_chapters.json";

export type ChapterDetectionResult = {
  marks: ChapterMark[];
  /** Cue used for labels / mux (`de` = Kapitel, `en` = Chapter). Omitted → `de`. */
  chapterCue?: ChapterCue;
  /** True when marks were loaded from `CHAPTER_MARKS_CACHE_BASENAME` (Whisper not run). */
  usedChapterCache?: boolean;
};

function asNumber(v: unknown, field: string): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  throw new Error(`Invalid numeric value in "${field}".`);
}

function parseChapterDetectionResult(raw: unknown): ChapterDetectionResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid chapter response.");
  }
  const marksRaw = (raw as { marks?: unknown }).marks;
  if (!Array.isArray(marksRaw)) {
    throw new Error("Invalid chapter response (marks).");
  }
  const marks: ChapterMark[] = marksRaw.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Invalid chapter item (index ${index}).`);
    }
    const o = item as Record<string, unknown>;
    const filePath = o.filePath;
    const label = o.label;
    if (typeof filePath !== "string" || typeof label !== "string") {
      throw new Error(
        `Invalid chapter item (index ${index}, paths/label).`,
      );
    }
    return {
      filePath,
      startSec: asNumber(o.startSec, "startSec"),
      number: asNumber(o.number, "number"),
      label,
    };
  });
  const r = raw as { chapterCue?: unknown };
  let chapterCue: ChapterCue = "de";
  if (r.chapterCue === "en" || r.chapterCue === "de") {
    chapterCue = r.chapterCue;
  }
  return { marks, chapterCue };
}

async function nativeReadChapterMarksCacheIfPresent(
  rootDirectory: string,
  chapterCue: ChapterCue,
): Promise<unknown | null> {
  if (Platform.OS !== "macos") {
    return null;
  }
  const mod = NativeModules.DependencyStatus as
    | {
        readChapterMarksCacheIfPresent?: (
          root: string,
          cue: string,
        ) => Promise<unknown>;
      }
    | undefined;
  const fn = mod?.readChapterMarksCacheIfPresent;
  if (typeof fn !== "function") {
    return null;
  }
  const raw = await fn(rootDirectory, chapterCue);
  if (raw == null) {
    return null;
  }
  return raw;
}

async function nativeDetectChaptersWithWhisper(
  rootDirectory: string,
  modelSize: string,
  device: string,
  computeType: string,
  chapterCue: ChapterCue,
): Promise<ChapterDetectionResult> {
  if (Platform.OS !== "macos") {
    throw new Error(
      "Whisper chapter detection is only implemented on macOS.",
    );
  }
  const mod = NativeModules.DependencyStatus as
    | {
        detectChaptersWithWhisper?: (
          root: string,
          ms: string,
          dev: string,
          ct: string,
          cue: string,
        ) => Promise<unknown>;
      }
    | undefined;
  const fn = mod?.detectChaptersWithWhisper;
  if (typeof fn !== "function") {
    throw new Error("detectChaptersWithWhisper (native) is not available.");
  }
  const raw = await fn(
    rootDirectory,
    modelSize,
    device,
    computeType,
    chapterCue,
  );
  const parsed = parseChapterDetectionResult(raw);
  return { ...parsed, usedChapterCache: false };
}

async function nativeCreateEncodedAudiobookTrack(
  rootDirectory: string,
): Promise<string> {
  if (Platform.OS !== "macos") {
    throw new Error(
      "MP3 → M4A encode is only implemented on macOS.",
    );
  }
  const mod = NativeModules.DependencyStatus as
    | {
        createEncodedAudiobookTrack?: (root: string) => Promise<string>;
      }
    | undefined;
  const fn = mod?.createEncodedAudiobookTrack;
  if (typeof fn !== "function") {
    throw new Error(
      "createEncodedAudiobookTrack (native) is not available.",
    );
  }
  const out = await fn(rootDirectory);
  if (typeof out !== "string" || !out.trim()) {
    throw new Error("Invalid output path from native encode step.");
  }
  return out;
}

async function nativeMuxChaptersIntoMergedM4a(
  rootDirectory: string,
  marks: ChapterMark[],
  chapterCue: ChapterCue,
): Promise<string> {
  if (Platform.OS !== "macos") {
    throw new Error(
      "Chapter mux is only implemented on macOS.",
    );
  }
  const mod = NativeModules.DependencyStatus as
    | {
        muxChaptersIntoMergedM4a?: (
          root: string,
          m: ChapterMark[],
          cue: string,
        ) => Promise<string>;
      }
    | undefined;
  const fn = mod?.muxChaptersIntoMergedM4a;
  if (typeof fn !== "function") {
    throw new Error(
      "muxChaptersIntoMergedM4a (native) is not available.",
    );
  }
  const out = await fn(rootDirectory, marks, chapterCue);
  if (typeof out !== "string" || !out.trim()) {
    throw new Error("Invalid output path from native chapter mux.");
  }
  return out;
}

/** Optional metadata from Google Books preview for M4B creation (ffmpeg). */
export type AudiobookM4bMetadata = {
  title?: string;
  author?: string;
  coverUrl?: string;
};

async function nativeCreateM4bAudiobook(
  mergedM4aPath: string,
  mp3RootDirectory: string,
  metadata?: AudiobookM4bMetadata | null,
): Promise<string> {
  if (Platform.OS !== "macos") {
    throw new Error(
      "M4B creation is only implemented on macOS.",
    );
  }
  const mod = NativeModules.DependencyStatus as
    | {
        createM4bAudiobook?: (
          merged: string,
          root: string,
          metadata?: AudiobookM4bMetadata | null,
        ) => Promise<string>;
      }
    | undefined;
  const fn = mod?.createM4bAudiobook;
  if (typeof fn !== "function") {
    throw new Error("createM4bAudiobook (native) is not available.");
  }
  const out = await fn(mergedM4aPath, mp3RootDirectory, metadata ?? null);
  if (typeof out !== "string" || !out.trim()) {
    throw new Error("Invalid output path for the M4B file.");
  }
  return out;
}

/** 1. Recursively count MP3 files in the project folder. */
export async function countMp3Files(rootDirectory: string): Promise<number> {
  return nativeCountMp3Files(rootDirectory);
}

export type LocateChaptersOptions = {
  rootDirectory: string;
  modelSize: string;
  device: string;
  /** Match spoken "Kapitel" (de) vs "Chapter" (en). Default `de`. */
  chapterCue?: ChapterCue;
};

/**
 * 2. Chapter marks: load `AudiobookConverter_chapters.json` in the project folder when valid
 * (same shape as Whisper output, all file paths still on disk); otherwise transcribe the first
 * ~45 s per MP3 (ffmpeg + faster-whisper). Marks feed step 4 (mux).
 */
export async function locateChapters(
  options: LocateChaptersOptions,
): Promise<ChapterDetectionResult> {
  if (Platform.OS !== "macos") {
    throw new Error(
      "Whisper chapter detection is only implemented on macOS.",
    );
  }
  const root = options.rootDirectory.trim();
  const modelSize = options.modelSize.trim().toLowerCase();
  const device = options.device.trim().toLowerCase();
  const chapterCue: ChapterCue = options.chapterCue ?? "de";

  const cachedRaw = await nativeReadChapterMarksCacheIfPresent(
    root,
    chapterCue,
  );
  if (cachedRaw != null) {
    try {
      const parsed = parseChapterDetectionResult(cachedRaw);
      return { ...parsed, usedChapterCache: true };
    } catch {
      // Corrupt cache — run Whisper
    }
  }

  return nativeDetectChaptersWithWhisper(
    root,
    modelSize,
    device,
    WHISPER_COMPUTE_TYPE,
    chapterCue,
  );
}

/** Intermediate AAC file in the project folder (before chapter mux). */
export const ENCODED_M4A_BASENAME = "AudiobookConverter_encoded.m4a";

/**
 * 3. Merge all MP3s into one M4A (AAC encode only; no chapter metadata).
 * @returns Path to `ENCODED_M4A_BASENAME` in the project folder.
 */
export async function createEncodedAudiobookTrack(
  rootDirectory: string,
): Promise<string> {
  return nativeCreateEncodedAudiobookTrack(rootDirectory.trim());
}

/**
 * 4. Lay step‑2 chapter marks on the encoded M4A timeline (ffmpeg stream copy).
 * Removes the encoded intermediate when successful.
 * @returns Path to `AudiobookConverter_merged.m4a`.
 */
export async function muxChaptersIntoMergedM4a(
  rootDirectory: string,
  chapters: ChapterDetectionResult,
): Promise<string> {
  return nativeMuxChaptersIntoMergedM4a(
    rootDirectory.trim(),
    chapters.marks,
    chapters.chapterCue ?? "de",
  );
}

/**
 * 5. From the merged M4A, build an audiobook `.m4b` in the MP3 project folder
 * named after that folder’s basename (sanitized; macOS native); ffmpeg remux, Audiobook genre,
 * optional title/author/cover from metadata; the intermediate M4A is removed.
 */
export async function createAudiobookFile(
  mergedM4aPath: string,
  mp3RootDirectory: string,
  metadata?: AudiobookM4bMetadata | null,
): Promise<string> {
  return nativeCreateM4bAudiobook(
    mergedM4aPath.trim(),
    mp3RootDirectory.trim(),
    metadata,
  );
}
