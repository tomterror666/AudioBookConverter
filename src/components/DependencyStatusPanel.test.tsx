import "react-native";
import React from "react";
import { Platform, Text } from "react-native";
import { act, create, ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Button } from "./ui/Button";
import { DependencyStatusPanel } from "./DependencyStatusPanel";

const mockRunDependencyChecks = jest.fn<() => Promise<unknown>>();
const mockRunSingleDependencyAction =
  jest.fn<(key: string, mode: string) => Promise<string>>();

jest.mock("../utils/dependencyStatus", () => {
  return {
    runDependencyChecks: () => mockRunDependencyChecks(),
    runSingleDependencyAction: (key: string, mode: string) =>
      mockRunSingleDependencyAction(key, mode),
  };
});

function setPlatform(os: string): void {
  Object.defineProperty(Platform, "OS", {
    value: os,
    configurable: true,
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("DependencyStatusPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPlatform("macos");
  });

  it("loads dependency data on mount and forwards onCheckResult", async () => {
    const result = {
      statuses: {
        python: "ok" as const,
        pip: "ok" as const,
        ffmpeg: "ok" as const,
        fasterWhisper: "ok" as const,
      },
      venvPathDisplay: "~/.audioBookConverter",
    };
    mockRunDependencyChecks.mockResolvedValue(result);
    const onCheckResult = jest.fn();

    let tree: ReactTestRenderer;
    await act(async () => {
      tree = create(<DependencyStatusPanel onCheckResult={onCheckResult} />);
    });
    await flush();

    expect(mockRunDependencyChecks).toHaveBeenCalledTimes(1);
    expect(onCheckResult).toHaveBeenCalledWith(result);

    const texts = tree!.root
      .findAllByType(Text)
      .map(node => node.props.children);
    expect(texts).toContain("Python-Info");
    expect(texts).toContain("~/.audioBookConverter");
  });

  it("shows install/update actions according to dependency statuses", async () => {
    mockRunDependencyChecks.mockResolvedValue({
      statuses: {
        python: "missing",
        pip: "wrong_version",
        ffmpeg: "ok",
        fasterWhisper: "missing",
      },
      venvPathDisplay: "~/.audioBookConverter",
    });

    let tree: ReactTestRenderer;
    await act(async () => {
      tree = create(<DependencyStatusPanel />);
    });
    await flush();

    const buttonChildren = tree!.root
      .findAllByType(Button)
      .map(node => node.props.children);
    expect(
      buttonChildren.filter((v: string) => v === "Installieren"),
    ).toHaveLength(2);
    expect(
      buttonChildren.filter((v: string) => v === "Aktualisieren"),
    ).toHaveLength(1);
  });

  it("runs install action and opens feedback modal with log", async () => {
    mockRunDependencyChecks.mockResolvedValue({
      statuses: {
        python: "missing",
        pip: "ok",
        ffmpeg: "ok",
        fasterWhisper: "ok",
      },
      venvPathDisplay: "~/.audioBookConverter",
    });
    mockRunSingleDependencyAction.mockResolvedValue("done log");

    let tree: ReactTestRenderer;
    await act(async () => {
      tree = create(<DependencyStatusPanel />);
    });
    await flush();

    const installButton = tree!.root
      .findAllByType(Button)
      .find(node => node.props.children === "Installieren");
    expect(installButton).toBeTruthy();

    await act(async () => {
      installButton!.props.onPress();
    });
    await flush();

    expect(mockRunSingleDependencyAction).toHaveBeenCalledWith(
      "python",
      "install",
    );

    const texts = tree!.root
      .findAllByType(Text)
      .map(node => node.props.children);
    expect(texts).toContain("done log");
  });
});
