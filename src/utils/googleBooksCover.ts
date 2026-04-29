/**
 * Google Books API — preview from folder name + “Perry Rhodan”; same data is passed into M4B creation.
 * @see https://developers.google.com/books/docs/v1/using
 */

import { GOOGLE_BOOKS_API_KEY } from "../config/googleBooksApiKey";

export const GOOGLE_BOOKS_VOLUMES_URL =
  "https://www.googleapis.com/books/v1/volumes";

export { GOOGLE_BOOKS_API_KEY };

/** Last path segment: normalize underscores to spaces; full name including hyphens. */
export function normalizeFolderBasename(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return "";
  }
  const segments = trimmed.split(/[/\\]/).filter(Boolean);
  const base = segments.length > 0 ? segments[segments.length - 1]! : "";
  return base
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Text after the first `-` in the folder basename (trimmed). If there is no `-`,
 * the full basename is used. Example: `Silber Edition 33 - OLD MAN` → `OLD MAN`.
 */
export function folderLastNameAfterHyphen(basename: string): string {
  const name = basename.trim();
  if (!name) {
    return "";
  }
  const i = name.indexOf("-");
  if (i === -1) {
    return name;
  }
  return name.slice(i + 1).replace(/\s+/g, " ").trim();
}

/** Query string: `Perry Rhodan: ` + last-name part of the folder (after first `-`), for Google Books search. */
export function perryRhodanSearchQueryFromPath(path: string): string {
  const name = normalizeFolderBasename(path);
  if (!name) {
    return "";
  }
  const last = folderLastNameAfterHyphen(name);
  if (!last) {
    return "";
  }
  return `Perry Rhodan: ${last}`;
}

/** Folder basename split for ranking API hits against title/subtitle. */
export type GoogleBooksFolderMatchContext = {
  basename: string;
  lastName: string;
  /** Text before the first `-` in the basename; empty if none. */
  prefixBeforeHyphen: string;
};

export function folderMatchContextFromPath(
  path: string,
): GoogleBooksFolderMatchContext | null {
  const basename = normalizeFolderBasename(path);
  if (!basename) {
    return null;
  }
  const lastName = folderLastNameAfterHyphen(basename);
  const i = basename.indexOf("-");
  const prefixBeforeHyphen =
    i === -1 ? "" : basename.slice(0, i).replace(/\s+/g, " ").trim();
  return { basename, lastName, prefixBeforeHyphen };
}

const JUNK_TITLE_HINTS = [
  "verzeichnis",
  "lieferbarer",
  "bibliographie",
  "gesamtverzeichnis",
];

function tokenizeForMatch(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9äöüß]+/i)
    .filter(t => t.length >= 2 || /^\d+$/.test(t));
}

/**
 * Higher = better match to folder `lastName` / prefix; junk catalog hits score very low.
 */
export function scoreGoogleBooksVolumeForFolder(
  vol: GoogleBooksVolumeSummary,
  ctx: GoogleBooksFolderMatchContext,
): number {
  const hay = `${vol.title ?? ""} ${vol.subtitle ?? ""}`.toLowerCase();
  for (const hint of JUNK_TITLE_HINTS) {
    if (hay.includes(hint)) {
      return -10000;
    }
  }
  let score = 0;
  const lastLower = ctx.lastName.toLowerCase();
  if (lastLower.length > 0) {
    if (hay.includes(lastLower)) {
      score += 500;
    }
    for (const t of tokenizeForMatch(ctx.lastName)) {
      if (t.length >= 2 && hay.includes(t)) {
        score += 80;
      }
    }
  }
  if (ctx.prefixBeforeHyphen.length > 0) {
    for (const t of tokenizeForMatch(ctx.prefixBeforeHyphen)) {
      if (t.length >= 2 && hay.includes(t)) {
        score += 45;
      }
    }
  }
  if (hay.includes("perry") && hay.includes("rhodan")) {
    score += 15;
  }
  return score;
}

export function upgradeCoverUrlToHttps(url: string): string {
  if (url.startsWith("http://")) {
    return `https://${url.slice("http://".length)}`;
  }
  return url;
}

type VolumeInfo = {
  title?: string;
  subtitle?: string;
  authors?: string[];
  publisher?: string;
  publishedDate?: string;
  imageLinks?: {
    thumbnail?: string;
    smallThumbnail?: string;
  };
};

type VolumeItem = {
  id?: string;
  volumeInfo?: VolumeInfo;
};

type VolumesListResponse = {
  items?: VolumeItem[];
};

export type GoogleBooksCoverResult = {
  coverUrl: string;
  title: string | null;
  /** Comma-separated authors (Google Books `authors`). */
  authors: string | null;
};

/** One volume from a search — use for listing / ranking before picking a cover. */
export type GoogleBooksVolumeSummary = {
  id: string | null;
  title: string | null;
  subtitle: string | null;
  authors: string | null;
  publisher: string | null;
  publishedDate: string | null;
  coverUrl: string | null;
};

function clampMaxResults(n: number | undefined): number {
  return Math.min(Math.max(n ?? 10, 1), 40);
}

function buildVolumesSearchUrl(query: string, maxResults: number): string {
  let url = `${GOOGLE_BOOKS_VOLUMES_URL}?q=${encodeURIComponent(query)}&maxResults=${String(maxResults)}`;
  const key = GOOGLE_BOOKS_API_KEY.trim();
  if (key.length > 0) {
    url += `&key=${encodeURIComponent(key)}`;
  }
  return url;
}

function pickCoverUrlFromVolume(item: VolumeItem): string | null {
  const links = item.volumeInfo?.imageLinks;
  const raw = links?.thumbnail ?? links?.smallThumbnail;
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  return upgradeCoverUrlToHttps(raw.trim());
}

function formatAuthors(authorsRaw: unknown): string | null {
  if (!Array.isArray(authorsRaw) || authorsRaw.length === 0) {
    return null;
  }
  const parts = authorsRaw
    .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
    .map(a => a.trim());
  return parts.length > 0 ? parts.join(", ") : null;
}

function volumeSummaryFromItem(item: VolumeItem): GoogleBooksVolumeSummary {
  const vi = item.volumeInfo;
  const titleRaw = vi?.title;
  const title =
    typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim() : null;
  const subtitleRaw = vi?.subtitle;
  const subtitle =
    typeof subtitleRaw === "string" && subtitleRaw.trim()
      ? subtitleRaw.trim()
      : null;
  const publisherRaw = vi?.publisher;
  const publisher =
    typeof publisherRaw === "string" && publisherRaw.trim()
      ? publisherRaw.trim()
      : null;
  const publishedDateRaw = vi?.publishedDate;
  const publishedDate =
    typeof publishedDateRaw === "string" && publishedDateRaw.trim()
      ? publishedDateRaw.trim()
      : null;
  return {
    id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : null,
    title,
    subtitle,
    authors: formatAuthors(vi?.authors),
    publisher,
    publishedDate,
    coverUrl: pickCoverUrlFromVolume(item),
  };
}

/**
 * Fetches up to `maxResults` volumes (1–40) for a full-text query. Includes entries without covers.
 */
export async function fetchGoogleBooksVolumeList(
  query: string,
  options?: { signal?: AbortSignal; maxResults?: number },
): Promise<GoogleBooksVolumeSummary[]> {
  const q = query.trim();
  if (!q) {
    return [];
  }
  const maxResults = clampMaxResults(options?.maxResults);
  const url = buildVolumesSearchUrl(q, maxResults);
  const res = await fetch(url, {
    signal: options?.signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Google Books HTTP ${String(res.status)}`);
  }
  const data = (await res.json()) as VolumesListResponse;
  const items = data.items;
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }
  return items.map(volumeSummaryFromItem);
}

/**
 * Fetches up to `maxResults` volumes, ranks them against the folder path, returns the best
 * hit that has a cover image (for folder thumbnail + M4B metadata).
 */
export async function fetchGoogleBooksCoverForFolderPath(
  path: string,
  options?: { signal?: AbortSignal; maxResults?: number },
): Promise<GoogleBooksCoverResult | null> {
  const ctx = folderMatchContextFromPath(path);
  if (!ctx) {
    return null;
  }
  const q = perryRhodanSearchQueryFromPath(path);
  if (!q.trim()) {
    return null;
  }
  const maxResults = Math.min(Math.max(options?.maxResults ?? 10, 1), 40);
  const list = await fetchGoogleBooksVolumeList(q, {
    signal: options?.signal,
    maxResults,
  });
  if (list.length === 0) {
    return null;
  }
  const scored = list.map((vol, index) => ({
    vol,
    score: scoreGoogleBooksVolumeForFolder(vol, ctx),
    index,
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.index - b.index;
  });
  for (const { vol, score } of scored) {
    if (score < -5000) {
      continue;
    }
    if (vol.coverUrl) {
      return {
        coverUrl: vol.coverUrl,
        title: vol.title,
        authors: vol.authors,
      };
    }
  }
  for (const { vol } of scored) {
    if (vol.coverUrl) {
      return {
        coverUrl: vol.coverUrl,
        title: vol.title,
        authors: vol.authors,
      };
    }
  }
  return null;
}

/** First volume in the result list that has a thumbnail (API order; no folder scoring). */
export async function fetchGoogleBooksFirstCover(
  query: string,
  options?: { signal?: AbortSignal; maxResults?: number },
): Promise<GoogleBooksCoverResult | null> {
  const q = query.trim();
  if (!q) {
    return null;
  }
  const maxResults = clampMaxResults(options?.maxResults);
  const list = await fetchGoogleBooksVolumeList(q, {
    signal: options?.signal,
    maxResults,
  });
  for (const row of list) {
    if (row.coverUrl) {
      return {
        coverUrl: row.coverUrl,
        title: row.title,
        authors: row.authors,
      };
    }
  }
  return null;
}
