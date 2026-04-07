import {NativeModules, Platform} from 'react-native';

export class ConversionCancelledError extends Error {
  constructor() {
    super('Konvertierung abgebrochen');
    this.name = 'ConversionCancelledError';
  }
}

export function isConversionCancelled(e: unknown): boolean {
  return e instanceof ConversionCancelledError;
}

async function nativeCountMp3Files(directoryPath: string): Promise<number> {
  if (Platform.OS !== 'macos') {
    throw new Error('MP3-Zählung ist derzeit nur unter macOS verfügbar.');
  }
  const mod = NativeModules.DependencyStatus as
    | {countMp3FilesInDirectory?: (p: string) => Promise<number>}
    | undefined;
  const fn = mod?.countMp3FilesInDirectory;
  if (typeof fn !== 'function') {
    throw new Error('countMp3FilesInDirectory (nativ) ist nicht verfügbar.');
  }
  const n = await fn(directoryPath);
  return typeof n === 'number' ? n : Number(n);
}

const WHISPER_COMPUTE_TYPE = 'int8' as const;

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
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  throw new Error(`Ungültiger Zahlenwert in „${field}“.`);
}

function parseChapterDetectionResult(raw: unknown): ChapterDetectionResult {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Ungültige Kapitel-Antwort.');
  }
  const marksRaw = (raw as {marks?: unknown}).marks;
  if (!Array.isArray(marksRaw)) {
    throw new Error('Ungültige Kapitel-Antwort (marks).');
  }
  const marks: ChapterMark[] = marksRaw.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Ungültiges Kapitel-Element (Index ${index}).`);
    }
    const o = item as Record<string, unknown>;
    const filePath = o.filePath;
    const label = o.label;
    if (typeof filePath !== 'string' || typeof label !== 'string') {
      throw new Error(`Ungültiges Kapitel-Element (Index ${index}, Pfade/Label).`);
    }
    return {
      filePath,
      startSec: asNumber(o.startSec, 'startSec'),
      number: asNumber(o.number, 'number'),
      label,
    };
  });
  return {marks};
}

async function nativeDetectChaptersWithWhisper(
  rootDirectory: string,
  modelSize: string,
  device: string,
  computeType: string,
): Promise<ChapterDetectionResult> {
  if (Platform.OS !== 'macos') {
    throw new Error(
      'Whisper-Kapitelerkennung ist derzeit nur unter macOS implementiert.',
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
  if (typeof fn !== 'function') {
    throw new Error('detectChaptersWithWhisper (nativ) ist nicht verfügbar.');
  }
  const raw = await fn(rootDirectory, modelSize, device, computeType);
  return parseChapterDetectionResult(raw);
}

async function nativeCreateMergedAudiobookWithChapters(
  rootDirectory: string,
  marks: ChapterMark[],
): Promise<string> {
  if (Platform.OS !== 'macos') {
    throw new Error(
      'Zusammenführung mit Kapiteln ist derzeit nur unter macOS implementiert.',
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
  if (typeof fn !== 'function') {
    throw new Error(
      'createMergedAudiobookWithChapters (nativ) ist nicht verfügbar.',
    );
  }
  const out = await fn(rootDirectory, marks);
  if (typeof out !== 'string' || !out.trim()) {
    throw new Error('Ungültiger Ausgabepfad von der nativen Zusammenführung.');
  }
  return out;
}

async function nativeCreateM4bAudiobook(
  mergedM4aPath: string,
  mp3RootDirectory: string,
): Promise<string> {
  if (Platform.OS !== 'macos') {
    throw new Error(
      'M4B-Erstellung ist derzeit nur unter macOS implementiert.',
    );
  }
  const mod = NativeModules.DependencyStatus as
    | {
        createM4bAudiobook?: (merged: string, root: string) => Promise<string>;
      }
    | undefined;
  const fn = mod?.createM4bAudiobook;
  if (typeof fn !== 'function') {
    throw new Error('createM4bAudiobook (nativ) ist nicht verfügbar.');
  }
  const out = await fn(mergedM4aPath, mp3RootDirectory);
  if (typeof out !== 'string' || !out.trim()) {
    throw new Error('Ungültiger Ausgabepfad für die M4B-Datei.');
  }
  return out;
}

/** 1. MP3-Dateien im Projektordner rekursiv zählen. */
export async function countMp3Files(rootDirectory: string): Promise<number> {
  return nativeCountMp3Files(rootDirectory);
}

export type LocateChaptersOptions = {
  rootDirectory: string;
  modelSize: string;
  device: string;
};

/**
 * 2. Pro MP3 nur die ersten ~45 s transkribieren (ffmpeg + faster-whisper),
 * Positionen von „Kapitel“ + Zahl (Wort-Timestamps, bezogen auf Track-Anfang); Ergebnis für Schritt 3.
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
 * 3. Alle MP3s (gleiche Sortierung wie Scan) zu einer M4A zusammenführen,
 * Kapitel aus Schritt 2 auf die Gesamt-Timeline legen (ffmpeg).
 * @returns Pfad zur erzeugten Datei (…/AudiobookConverter_merged.m4a).
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
 * 4. Aus der zusammengeführten M4A eine Hörbuch-.m4b im MP3-Projektordner erzeugen
 * (ffmpeg remux, genre Audiobook), die Zwischen-M4A wird entfernt.
 */
export async function createAudiobookFile(
  mergedM4aPath: string,
  mp3RootDirectory: string,
): Promise<string> {
  return nativeCreateM4bAudiobook(
    mergedM4aPath.trim(),
    mp3RootDirectory.trim(),
  );
}
