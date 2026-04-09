import {
  describe,
  expect,
  it,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import {
  fetchGoogleBooksFirstCover,
  normalizeFolderBasename,
  perryRhodanSearchQueryFromPath,
  upgradeCoverUrlToHttps,
} from "./googleBooksCover";

describe("googleBooksCover", () => {
  it("normalizeFolderBasename keeps full folder name including hyphen part", () => {
    expect(normalizeFolderBasename("/audiobooks/Brand - Ein Heimatloser")).toBe(
      "Brand - Ein Heimatloser",
    );
    expect(normalizeFolderBasename("/Users/me/My_Awesome__Book")).toBe(
      "My Awesome Book",
    );
  });

  it("perryRhodanSearchQueryFromPath prefixes Perry Rhodan and full name", () => {
    expect(perryRhodanSearchQueryFromPath("/b/Brand - Der Titan")).toBe(
      "Perry Rhodan Brand - Der Titan",
    );
  });

  it("upgradeCoverUrlToHttps rewrites http thumbnails", () => {
    expect(upgradeCoverUrlToHttps("http://books.google.com/cover")).toBe(
      "https://books.google.com/cover",
    );
    expect(upgradeCoverUrlToHttps("https://x")).toBe("https://x");
  });

  describe("fetchGoogleBooksFirstCover", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      global.fetch = jest.fn() as unknown as typeof fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("returns first item with thumbnail", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            { volumeInfo: { title: "No image" } },
            {
              volumeInfo: {
                title: "PR 1",
                authors: ["A. Author", "B. Co"],
                imageLinks: { thumbnail: "http://example.com/t.jpg" },
              },
            },
          ],
        }),
      });
      const r = await fetchGoogleBooksFirstCover("Perry Rhodan Test");
      expect(r).toEqual({
        coverUrl: "https://example.com/t.jpg",
        title: "PR 1",
        authors: "A. Author, B. Co",
      });
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain(
        encodeURIComponent("Perry Rhodan Test"),
      );
    });

    it("returns null when no items have images", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [{ volumeInfo: { title: "X" } }],
        }),
      });
      await expect(fetchGoogleBooksFirstCover("q")).resolves.toBeNull();
    });

    it("throws on non-ok response", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 429 });
      await expect(fetchGoogleBooksFirstCover("x")).rejects.toThrow(
        "Google Books HTTP 429",
      );
    });
  });
});
