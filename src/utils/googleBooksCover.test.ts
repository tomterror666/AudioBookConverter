import {
  describe,
  expect,
  it,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import {
  fetchGoogleBooksCoverForFolderPath,
  fetchGoogleBooksFirstCover,
  fetchGoogleBooksVolumeList,
  folderLastNameAfterHyphen,
  folderMatchContextFromPath,
  normalizeFolderBasename,
  perryRhodanSearchQueryFromPath,
  scoreGoogleBooksVolumeForFolder,
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
    expect(normalizeFolderBasename("")).toBe("");
    expect(normalizeFolderBasename("   ")).toBe("");
  });

  it("perryRhodanSearchQueryFromPath uses Perry Rhodan: + text after first hyphen", () => {
    expect(perryRhodanSearchQueryFromPath("/b/Brand - Der Titan")).toBe(
      "Perry Rhodan: Der Titan",
    );
    expect(
      perryRhodanSearchQueryFromPath("/audiobooks/Silber Edition 33 - OLD MAN"),
    ).toBe("Perry Rhodan: OLD MAN");
    expect(perryRhodanSearchQueryFromPath("/x/SingleNoHyphen")).toBe(
      "Perry Rhodan: SingleNoHyphen",
    );
    expect(perryRhodanSearchQueryFromPath("")).toBe("");
    expect(perryRhodanSearchQueryFromPath("///")).toBe("");
  });

  it("folderLastNameAfterHyphen returns substring after first hyphen", () => {
    expect(folderLastNameAfterHyphen("A - B")).toBe("B");
    expect(folderLastNameAfterHyphen("A - B - C")).toBe("B - C");
    expect(folderLastNameAfterHyphen("only")).toBe("only");
    expect(folderLastNameAfterHyphen("")).toBe("");
  });

  it("upgradeCoverUrlToHttps rewrites http thumbnails", () => {
    expect(upgradeCoverUrlToHttps("http://books.google.com/cover")).toBe(
      "https://books.google.com/cover",
    );
    expect(upgradeCoverUrlToHttps("https://x")).toBe("https://x");
  });

  describe("scoreGoogleBooksVolumeForFolder", () => {
    const ctx = folderMatchContextFromPath(
      "/audiobooks/Silber Edition 33 - OLD MAN",
    )!;

    it("assigns heavy penalty for junk catalog titles", () => {
      expect(
        scoreGoogleBooksVolumeForFolder(
          {
            id: "1",
            title: "Lieferbarer PR Band 1",
            subtitle: null,
            authors: null,
            publisher: null,
            publishedDate: null,
            coverUrl: "https://x/c.jpg",
          },
          ctx,
        ),
      ).toBe(-10000);
    });

    it("ranks exact last-name match above unrelated API-first hit", () => {
      const weak = scoreGoogleBooksVolumeForFolder(
        {
          id: "a",
          title: "Perry Rhodan",
          subtitle: "Anthology",
          authors: null,
          publisher: null,
          publishedDate: null,
          coverUrl: null,
        },
        ctx,
      );
      const strong = scoreGoogleBooksVolumeForFolder(
        {
          id: "b",
          title: "Perry Rhodan: OLD MAN",
          subtitle: "",
          authors: null,
          publisher: null,
          publishedDate: null,
          coverUrl: null,
        },
        ctx,
      );
      expect(strong).toBeGreaterThan(weak);
    });
  });

  describe("fetchGoogleBooksCoverForFolderPath", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      global.fetch = jest.fn() as unknown as typeof fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("picks best-scoring volume with cover, not first API item", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            {
              volumeInfo: {
                title: "Perry Rhodan",
                subtitle: "Misc",
                imageLinks: { thumbnail: "http://books.google.com/a.jpg" },
              },
            },
            {
              volumeInfo: {
                title: "Perry Rhodan: OLD MAN",
                imageLinks: { thumbnail: "http://books.google.com/b.jpg" },
              },
            },
          ],
        }),
      });
      const path = "/audiobooks/Silber Edition 33 - OLD MAN";
      const r = await fetchGoogleBooksCoverForFolderPath(path);
      expect(r).toMatchObject({
        coverUrl: "https://books.google.com/b.jpg",
        title: "Perry Rhodan: OLD MAN",
      });
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain(
        encodeURIComponent("Perry Rhodan: OLD MAN"),
      );
    });

    it("skips junk first hit when a later volume has the cover", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            {
              volumeInfo: {
                title: "Gesamtverzeichnis der Hefte",
                imageLinks: { thumbnail: "http://books.google.com/junk.jpg" },
              },
            },
            {
              volumeInfo: {
                title: "Perry Rhodan: OLD MAN",
                imageLinks: { thumbnail: "http://books.google.com/good.jpg" },
              },
            },
          ],
        }),
      });
      const r = await fetchGoogleBooksCoverForFolderPath(
        "/audiobooks/Silber Edition 33 - OLD MAN",
      );
      expect(r?.coverUrl).toBe("https://books.google.com/good.jpg");
    });

    it("returns null when path yields no query context", async () => {
      await expect(fetchGoogleBooksCoverForFolderPath("")).resolves.toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("fetchGoogleBooksVolumeList", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      global.fetch = jest.fn() as unknown as typeof fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("maps items including entries without covers", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            {
              id: "vol1",
              volumeInfo: { title: "A", publisher: "PubCo" },
            },
            {
              id: "vol2",
              volumeInfo: {
                title: "B",
                subtitle: "Sub",
                authors: ["X"],
                publishedDate: "2020",
                imageLinks: { thumbnail: "http://t/c.jpg" },
              },
            },
          ],
        }),
      });
      const list = await fetchGoogleBooksVolumeList("q", { maxResults: 10 });
      expect(list).toHaveLength(2);
      expect(list[0]).toMatchObject({
        id: "vol1",
        title: "A",
        coverUrl: null,
        publisher: "PubCo",
      });
      expect(list[1]).toMatchObject({
        id: "vol2",
        title: "B",
        subtitle: "Sub",
        authors: "X",
        coverUrl: "https://t/c.jpg",
        publishedDate: "2020",
      });
    });

    it("returns empty array for blank query without fetch", async () => {
      await expect(fetchGoogleBooksVolumeList("  ")).resolves.toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });
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

    it("returns null for empty query", async () => {
      await expect(fetchGoogleBooksFirstCover(" ")).resolves.toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("returns null when items array is empty", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ items: [] }),
      });
      await expect(fetchGoogleBooksFirstCover("q")).resolves.toBeNull();
    });

    it("skips volumes without thumbnails until one has image", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            { volumeInfo: { title: "A" } },
            {
              volumeInfo: {
                title: "B",
                authors: [],
                imageLinks: { smallThumbnail: "https://x/y.png" },
              },
            },
          ],
        }),
      });
      const r = await fetchGoogleBooksFirstCover("q", { maxResults: 3 });
      expect(r?.coverUrl).toBe("https://x/y.png");
      expect(r?.title).toBe("B");
      expect(r?.authors).toBeNull();
    });

    it("clamps maxResults to 1..40", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ items: [] }),
      });
      await fetchGoogleBooksFirstCover("q", { maxResults: 99 });
      const url = String((global.fetch as jest.Mock).mock.calls[0][0]);
      expect(url).toContain("maxResults=40");
      await fetchGoogleBooksFirstCover("q", { maxResults: 0 });
      const url2 = String((global.fetch as jest.Mock).mock.calls[1][0]);
      expect(url2).toContain("maxResults=1");
    });
  });
});
