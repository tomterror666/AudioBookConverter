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

const WHISPER_COMPUTE_TYPE = "int8" as const;

export type ChapterMark = {
  filePath: string;
  startSec: number;
  number: number;
  label: string;
};

export type ChapterDetectionResult = {
  marks: ChapterMark[];
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
  return { marks };
}

async function nativeDetectChaptersWithWhisper(
  rootDirectory: string,
  modelSize: string,
  device: string,
  computeType: string,
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
        ) => Promise<unknown>;
      }
    | undefined;
  const fn = mod?.detectChaptersWithWhisper;
  if (typeof fn !== "function") {
    throw new Error("detectChaptersWithWhisper (native) is not available.");
  }
  const raw = await fn(rootDirectory, modelSize, device, computeType);
  return parseChapterDetectionResult(raw);
}

async function nativeCreateMergedAudiobookWithChapters(
  rootDirectory: string,
  marks: ChapterMark[],
): Promise<string> {
  if (Platform.OS !== "macos") {
    throw new Error(
      "Merge with chapters is only implemented on macOS.",
    );
  }
  const mod = NativeModules.DependencyStatus as
    | {
        createMergedAudiobookWithChapters?: (
          root: string,
          m: ChapterMark[],
        ) => Promise<string>;
      }
    | undefined;
  const fn = mod?.createMergedAudiobookWithChapters;
  if (typeof fn !== "function") {
    throw new Error(
      "createMergedAudiobookWithChapters (native) is not available.",
    );
  }
  const out = await fn(rootDirectory, marks);
  if (typeof out !== "string" || !out.trim()) {
    throw new Error("Invalid output path from native merge.");
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
};

/**
 * 2. Transcribe only the first ~45 s per MP3 (ffmpeg + faster-whisper);
 * positions of “chapter” + number (word timestamps from track start); used in step 3.
 */
export async function locateChapters(
  options: LocateChaptersOptions,
): Promise<ChapterDetectionResult> {
  const root = options.rootDirectory.trim();
  const modelSize = options.modelSize.trim().toLowerCase();
  const device = options.device.trim().toLowerCase();
  return nativeDetectChaptersWithWhisper(
    root,
    modelSize,
    device,
    WHISPER_COMPUTE_TYPE,
  );
}

/**
 * 3. Merge all MP3s (same order as scan) into one M4A and lay step‑2 chapters on the full timeline (ffmpeg).
 * @returns Path to the output file (…/AudiobookConverter_merged.m4a).
 */
export async function createMp4WithChapterMarkers(
  rootDirectory: string,
  chapters: ChapterDetectionResult,
): Promise<string> {
  return nativeCreateMergedAudiobookWithChapters(
    rootDirectory.trim(),
    chapters.marks,
  );
}

/**
 * 4. From the merged M4A, build an audiobook .m4b in the MP3 project folder
 * (ffmpeg remux, Audiobook genre, optional title/author/cover from metadata); the intermediate M4A is removed.
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
