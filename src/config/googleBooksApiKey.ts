import { GOOGLE_BOOKS_API_KEY as GOOGLE_BOOKS_API_KEY_ENV } from "@env";

/**
 * Google Books API key (optional; higher quota when set). Loaded from `.env` via
 * `GOOGLE_BOOKS_API_KEY` (see `.env.example`). Copy `.env.example` to `.env` locally.
 */
export const GOOGLE_BOOKS_API_KEY: string = (
  typeof GOOGLE_BOOKS_API_KEY_ENV === "string" ? GOOGLE_BOOKS_API_KEY_ENV : ""
).trim();
