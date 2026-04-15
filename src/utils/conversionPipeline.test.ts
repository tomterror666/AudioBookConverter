import "react-native";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { NativeModules, Platform } from "react-native";
import {
  ConversionCancelledError,
  createAudiobookFile,
  createMp4WithChapterMarkers,
  countMp3Files,
  isConversionCancelled,
  locateChapters,
} from "./conversionPipeline";

function setPlatform(os: string): void {
  Object.defineProperty(Platform, "OS", {
    value: os,
    configurable: true,
  });
}

/** Default: no chapter cache file (Whisper path). */
function mockMacosDeps(partial: Record<string, unknown>): void {
  (NativeModules as Record<string, unknown>).DependencyStatus = {
    readChapterMarksCacheIfPresent: jest.fn(async () => null),
    ...partial,
  };
}

const validMarksPayload = {
  marks: [
    {
      filePath: "/a/1.mp3",
      startSec: 0,
      number: 1,
      label: "Chapter 1",
    },
  ],
};

describe("conversionPipeline", () => {
  beforeEach(() => {
    delete (NativeModules as Record<string, unknown>).DependencyStatus;
    setPlatform("macos");
  });

  it("ConversionCancelledError and isConversionCancelled", () => {
    const err = new ConversionCancelledError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ConversionCancelledError");
    expect(err.message).toBe("Conversion cancelled");
    expect(isConversionCancelled(err)).toBe(true);
    expect(isConversionCancelled(new Error("other"))).toBe(false);
    expect(isConversionCancelled(null)).toBe(false);
  });

  describe("countMp3Files", () => {
    it("returns numeric count from native", async () => {
      (NativeModules as Record<string, unknown>).DependencyStatus = {
        countMp3FilesInDirectory: jest.fn(async () => 4),
      };
      await expect(countMp3Files("/proj")).resolves.toBe(4);
    });

    it("coerces numeric string from native", async () => {
      (NativeModules as Record<string, unknown>).DependencyStatus = {
        countMp3FilesInDirectory: jest.fn(async () => "9"),
      };
      await expect(countMp3Files("/proj")).resolves.toBe(9);
    });

    it("throws when not macOS", async () => {
      setPlatform("windows");
      await expect(countMp3Files("/p")).rejects.toThrow(
        "MP3 counting is only available on macOS.",
      );
    });

    it("throws when native counter is missing", async () => {
      await expect(countMp3Files("/p")).rejects.toThrow(
        "countMp3FilesInDirectory (native) is not available.",
      );
    });
  });

  describe("locateChapters", () => {
    it("trims and lowercases options and returns parsed marks", async () => {
      const whisper = jest.fn(async () => validMarksPayload);
      mockMacosDeps({
        detectChaptersWithWhisper: whisper,
      });
      const result = await locateChapters({
        rootDirectory: "  /root  ",
        modelSize: "  BASE  ",
        device: "  CPU  ",
      });
      expect(whisper).toHaveBeenCalledWith(
        "/root",
        "base",
        "cpu",
        "int8_float32",
      );
      expect(result.marks).toHaveLength(1);
      expect(result.marks[0]?.label).toBe("Chapter 1");
      expect(result.usedChapterCache).not.toBe(true);
    });

    it("uses cached chapter marks when present and skips whisper", async () => {
      const whisper = jest.fn(async () => {
        throw new Error("whisper should not run");
      });
      mockMacosDeps({
        readChapterMarksCacheIfPresent: jest.fn(async () => validMarksPayload),
        detectChaptersWithWhisper: whisper,
      });
      const result = await locateChapters({
        rootDirectory: "/root",
        modelSize: "base",
        device: "cpu",
      });
      expect(whisper).not.toHaveBeenCalled();
      expect(result.usedChapterCache).toBe(true);
      expect(result.marks).toEqual(validMarksPayload.marks);
    });

    it("falls back to whisper when cache payload fails to parse", async () => {
      const whisper = jest.fn(async () => validMarksPayload);
      mockMacosDeps({
        readChapterMarksCacheIfPresent: jest.fn(async () => ({
          marks: [{ filePath: 1, label: "x" }],
        })),
        detectChaptersWithWhisper: whisper,
      });
      const result = await locateChapters({
        rootDirectory: "/root",
        modelSize: "base",
        device: "cpu",
      });
      expect(whisper).toHaveBeenCalled();
      expect(result.usedChapterCache).not.toBe(true);
    });

    it("accepts string startSec and number in native payload", async () => {
      mockMacosDeps({
        detectChaptersWithWhisper: jest.fn(async () => ({
          marks: [
            {
              filePath: "x.mp3",
              startSec: "1.5",
              number: "2",
              label: "L",
            },
          ],
        })),
      });
      const result = await locateChapters({
        rootDirectory: "/r",
        modelSize: "tiny",
        device: "cpu",
      });
      expect(result.marks[0]?.startSec).toBe(1.5);
      expect(result.marks[0]?.number).toBe(2);
    });

    it("throws when not macOS", async () => {
      setPlatform("android");
      await expect(
        locateChapters({
          rootDirectory: "/r",
          modelSize: "base",
          device: "cpu",
        }),
      ).rejects.toThrow("Whisper chapter detection is only implemented on macOS.");
    });

    it("throws when native whisper is missing", async () => {
      await expect(
        locateChapters({
          rootDirectory: "/r",
          modelSize: "base",
          device: "cpu",
        }),
      ).rejects.toThrow("detectChaptersWithWhisper (native) is not available.");
    });

    it("throws on invalid chapter payload", async () => {
      mockMacosDeps({
        detectChaptersWithWhisper: jest.fn(async () => null),
      });
      await expect(
        locateChapters({
          rootDirectory: "/r",
          modelSize: "base",
          device: "cpu",
        }),
      ).rejects.toThrow("Invalid chapter response.");
    });

    it("throws on invalid marks array", async () => {
      mockMacosDeps({
        detectChaptersWithWhisper: jest.fn(async () => ({ marks: "no" })),
      });
      await expect(
        locateChapters({
          rootDirectory: "/r",
          modelSize: "base",
          device: "cpu",
        }),
      ).rejects.toThrow("Invalid chapter response (marks).");
    });

    it("throws on bad chapter item", async () => {
      mockMacosDeps({
        detectChaptersWithWhisper: jest.fn(async () => ({
          marks: [{ filePath: 1, label: "x" }],
        })),
      });
      await expect(
        locateChapters({
          rootDirectory: "/r",
          modelSize: "base",
          device: "cpu",
        }),
      ).rejects.toThrow("Invalid chapter item (index 0, paths/label).");
    });

    it("throws when a chapter item is not an object", async () => {
      mockMacosDeps({
        detectChaptersWithWhisper: jest.fn(async () => ({
          marks: [null],
        })),
      });
      await expect(
        locateChapters({
          rootDirectory: "/r",
          modelSize: "base",
          device: "cpu",
        }),
      ).rejects.toThrow("Invalid chapter item (index 0).");
    });

    it("throws on non-numeric startSec", async () => {
      mockMacosDeps({
        detectChaptersWithWhisper: jest.fn(async () => ({
          marks: [
            {
              filePath: "a.mp3",
              startSec: "x",
              number: 1,
              label: "L",
            },
          ],
        })),
      });
      await expect(
        locateChapters({
          rootDirectory: "/r",
          modelSize: "base",
          device: "cpu",
        }),
      ).rejects.toThrow('Invalid numeric value in "startSec".');
    });
  });

  describe("createMp4WithChapterMarkers", () => {
    it("trims root and returns merged path", async () => {
      const merge = jest.fn(async () => "/out/merged.m4a");
      (NativeModules as Record<string, unknown>).DependencyStatus = {
        createMergedAudiobookWithChapters: merge,
      };
      const path = await createMp4WithChapterMarkers("  /root  ", {
        marks: validMarksPayload.marks,
      });
      expect(path).toBe("/out/merged.m4a");
      expect(merge).toHaveBeenCalledWith("/root", validMarksPayload.marks);
    });

    it("throws when merge returns empty path", async () => {
      (NativeModules as Record<string, unknown>).DependencyStatus = {
        createMergedAudiobookWithChapters: jest.fn(async () => "   "),
      };
      await expect(
        createMp4WithChapterMarkers("/r", { marks: [] }),
      ).rejects.toThrow("Invalid output path from native merge.");
    });

    it("throws when not macOS", async () => {
      setPlatform("ios");
      await expect(
        createMp4WithChapterMarkers("/r", { marks: [] }),
      ).rejects.toThrow("Merge with chapters is only implemented on macOS.");
    });

    it("throws when native merge is missing", async () => {
      await expect(
        createMp4WithChapterMarkers("/r", { marks: [] }),
      ).rejects.toThrow(
        "createMergedAudiobookWithChapters (native) is not available.",
      );
    });
  });

  describe("createAudiobookFile", () => {
    it("trims paths and passes metadata to native", async () => {
      const m4b = jest.fn(async (_m: string, _r: string, meta: unknown) => {
        expect(meta).toEqual({ title: "T", author: "A" });
        return "/book.m4b";
      });
      (NativeModules as Record<string, unknown>).DependencyStatus = {
        createM4bAudiobook: m4b,
      };
      const out = await createAudiobookFile(
        "  /m.m4a  ",
        "  /root  ",
        { title: "T", author: "A" },
      );
      expect(out).toBe("/book.m4b");
      expect(m4b).toHaveBeenCalledWith("/m.m4a", "/root", {
        title: "T",
        author: "A",
      });
    });

    it("throws when M4B path invalid", async () => {
      (NativeModules as Record<string, unknown>).DependencyStatus = {
        createM4bAudiobook: jest.fn(async () => ""),
      };
      await expect(
        createAudiobookFile("/m.m4a", "/root", null),
      ).rejects.toThrow("Invalid output path for the M4B file.");
    });

    it("throws when not macOS", async () => {
      setPlatform("windows");
      await expect(
        createAudiobookFile("/m.m4a", "/root"),
      ).rejects.toThrow("M4B creation is only implemented on macOS.");
    });

    it("throws when native M4B is missing", async () => {
      await expect(
        createAudiobookFile("/m.m4a", "/root"),
      ).rejects.toThrow("createM4bAudiobook (native) is not available.");
    });
  });
});
