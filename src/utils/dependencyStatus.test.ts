import "react-native";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { NativeModules, Platform } from "react-native";
import {
  allDependencyLedsGreen,
  runDependencyChecks,
  runSingleDependencyAction,
} from "./dependencyStatus";

function setPlatform(os: string): void {
  Object.defineProperty(Platform, "OS", {
    value: os,
    configurable: true,
  });
}

describe("dependencyStatus utils", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    delete (NativeModules as Record<string, unknown>).DependencyStatus;
  });

  it("allDependencyLedsGreen returns true only when all are ok", () => {
    expect(allDependencyLedsGreen(null)).toBe(false);
    expect(
      allDependencyLedsGreen({
        python: "ok",
        pip: "ok",
        ffmpeg: "ok",
        fasterWhisper: "ok",
      }),
    ).toBe(true);
    expect(
      allDependencyLedsGreen({
        python: "ok",
        pip: "missing",
        ffmpeg: "ok",
        fasterWhisper: "ok",
      }),
    ).toBe(false);
  });

  it("runDependencyChecks returns missing defaults on non-macos", async () => {
    setPlatform("windows");
    const result = await runDependencyChecks();
    expect(result).toEqual({
      statuses: {
        python: "missing",
        pip: "missing",
        ffmpeg: "missing",
        fasterWhisper: "missing",
      },
      venvPathDisplay: null,
    });
  });

  it("runDependencyChecks normalizes statuses and venv root on macos", async () => {
    setPlatform("macos");
    (NativeModules as Record<string, unknown>).DependencyStatus = {
      checkAll: async () => ({
        python: "ok",
        pip: "wrong_version",
        ffmpeg: "unexpected",
        fasterWhisper: "missing",
        venvRoot: "/Users/me/.audioBookConverter/",
      }),
    };

    const result = await runDependencyChecks();
    expect(result.statuses).toEqual({
      python: "ok",
      pip: "wrong_version",
      ffmpeg: "missing",
      fasterWhisper: "missing",
    });
    expect(result.venvPathDisplay).toBe("~/.audioBookConverter");
  });

  it("runDependencyChecks falls back to missing on check errors", async () => {
    setPlatform("macos");
    (NativeModules as Record<string, unknown>).DependencyStatus = {
      checkAll: async () => {
        throw new Error("boom");
      },
    };

    const result = await runDependencyChecks();
    expect(result.statuses).toEqual({
      python: "missing",
      pip: "missing",
      ffmpeg: "missing",
      fasterWhisper: "missing",
    });
    expect(result.venvPathDisplay).toBe("~/.audioBookConverter");
  });

  it("runSingleDependencyAction returns native log on macos", async () => {
    setPlatform("macos");
    const run = jest.fn(async () => ({ log: "done" }));
    (NativeModules as Record<string, unknown>).DependencyStatus = {
      runSingleDependencyAction: run,
    };

    const out = await runSingleDependencyAction("python", "install");
    expect(run).toHaveBeenCalledWith("python", "install");
    expect(out).toBe("done");
  });

  it("runSingleDependencyAction throws outside macos", async () => {
    setPlatform("ios");
    await expect(
      runSingleDependencyAction("python", "install"),
    ).rejects.toThrow("Only available on macOS.");
  });

  it("runDependencyChecks uses venv_root when venvRoot is absent", async () => {
    setPlatform("macos");
    (NativeModules as Record<string, unknown>).DependencyStatus = {
      checkAll: async () => ({
        python: "ok",
        pip: "ok",
        ffmpeg: "ok",
        fasterWhisper: "ok",
        venv_root: "/custom/.audioBookConverter",
      }),
    };
    const result = await runDependencyChecks();
    expect(result.venvPathDisplay).toBe("~/.audioBookConverter");
  });

  it("runDependencyChecks keeps custom venv path for display", async () => {
    setPlatform("macos");
    (NativeModules as Record<string, unknown>).DependencyStatus = {
      checkAll: async () => ({
        python: "ok",
        pip: "ok",
        ffmpeg: "ok",
        fasterWhisper: "ok",
        venvRoot: "/opt/my-venvs/audio",
      }),
    };
    const result = await runDependencyChecks();
    expect(result.venvPathDisplay).toBe("/opt/my-venvs/audio");
  });

  it("runDependencyChecks when checkAll is missing uses defaults", async () => {
    setPlatform("macos");
    (NativeModules as Record<string, unknown>).DependencyStatus = {};
    const result = await runDependencyChecks();
    expect(result.venvPathDisplay).toBe("~/.audioBookConverter");
  });

  it("runSingleDependencyAction throws when native action missing", async () => {
    setPlatform("macos");
    (NativeModules as Record<string, unknown>).DependencyStatus = {};
    await expect(
      runSingleDependencyAction("python", "install"),
    ).rejects.toThrow("Action not available.");
  });
});
