/**
 * Google Books API — preview from folder name + “Perry Rhodan”; same data is passed into M4B creation.
 * @see https://developers.google.com/books/docs/v1/using
 */

export const GOOGLE_BOOKS_VOLUMES_URL =
  "https://www.googleapis.com/books/v1/volumes";

/**
 * Optional Google Cloud API key for Books API (higher quota). Unauthenticated
 * requests work with strict rate limits.
 */
export const GOOGLE_BOOKS_API_KEY = "";

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

/** Query string: `Perry Rhodan` + full normalized folder name. */
export function perryRhodanSearchQueryFromPath(path: string): string {
  const name = normalizeFolderBasename(path);
  if (!name) {
    return "";
  }
  return `Perry Rhodan ${name}`;
}

export function upgradeCoverUrlToHttps(url: string): string {
  if (url.startsWith("http://")) {
    return `https://${url.slice("http://".length)}`;
  }
  return url;
}

type VolumeInfo = {
  title?: string;
  authors?: string[];
  imageLinks?: {
    thumbnail?: string;
    smallThumbnail?: string;
  };
};

type VolumeItem = {
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

function pickCoverUrlFromVolume(item: VolumeItem): string | null {
  const links = item.volumeInfo?.imageLinks;
  const raw = links?.thumbnail ?? links?.smallThumbnail;
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  return upgradeCoverUrlToHttps(raw.trim());
}

/** First volume in the result list that has a thumbnail. */
export async function fetchGoogleBooksFirstCover(
  query: string,
  options?: { signal?: AbortSignal; maxResults?: number },
): Promise<GoogleBooksCoverResult | null> {
  const q = query.trim();
  if (!q) {
    return null;
  }
  const maxResults = Math.min(Math.max(options?.maxResults ?? 10, 1), 40);
  let url = `${GOOGLE_BOOKS_VOLUMES_URL}?q=${encodeURIComponent(q)}&maxResults=${String(maxResults)}`;
  const key = GOOGLE_BOOKS_API_KEY.trim();
  if (key.length > 0) {
    url += `&key=${encodeURIComponent(key)}`;
  }
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
    return null;
  }
  for (const item of items) {
    const coverUrl = pickCoverUrlFromVolume(item);
    if (coverUrl) {
      const titleRaw = item.volumeInfo?.title;
      const title =
        typeof titleRaw === "string" && titleRaw.trim()
          ? titleRaw.trim()
          : null;
      const authorsRaw = item.volumeInfo?.authors;
      let authors: string | null = null;
      if (Array.isArray(authorsRaw) && authorsRaw.length > 0) {
        const parts = authorsRaw
          .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
          .map(a => a.trim());
        if (parts.length > 0) {
          authors = parts.join(", ");
        }
      }
      return { coverUrl, title, authors };
    }
  }
  return null;
}
