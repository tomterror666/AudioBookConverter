/**
 * UI-oriented tests: query like a user (screen + fireEvent), mock native/network.
 * Not a substitute for Detox / Maestro on a real device, but catches wiring regressions.
 *
 * We use Platform "windows" so Start is not blocked by macOS-only dependency checks.
 */
import "react-native";
import React from "react";
import { Platform } from "react-native";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import App from "./App";

jest.mock("react-native-file-panel", () => ({
  openFolder: jest.fn(),
}));

jest.mock("./components/DependencyStatusPanel", () => ({
  DependencyStatusPanel: () => null,
}));

jest.mock("./utils/googleBooksCover", () => ({
  ...jest.requireActual("./utils/googleBooksCover"),
  fetchGoogleBooksFirstCover: jest.fn(),
}));

jest.mock("./utils/conversionPipeline", () => ({
  ...jest.requireActual("./utils/conversionPipeline"),
  countMp3Files: jest.fn(),
}));

import { openFolder } from "react-native-file-panel";
import { countMp3Files } from "./utils/conversionPipeline";
import { fetchGoogleBooksFirstCover } from "./utils/googleBooksCover";

function setPlatform(os: string): void {
  Object.defineProperty(Platform, "OS", {
    value: os,
    configurable: true,
  });
}

describe("App UI (user-style queries, mocked IO)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPlatform("windows");
    jest.mocked(openFolder).mockResolvedValue("/audiobooks/PR Test Book");
    jest.mocked(countMp3Files).mockResolvedValue(2);
    jest.mocked(fetchGoogleBooksFirstCover).mockResolvedValue({
      coverUrl: "https://example.com/cover.jpg",
      title: "Mock volume",
      authors: "Author One",
    });
  });

  it("shows main title and default folder placeholder", async () => {
    render(<App />);
    expect(await screen.findByText("AudioBookConverter")).toBeOnTheScreen();
    expect(screen.getByText("AudioBooks")).toBeOnTheScreen();
  });

  it("keeps Start disabled until folder, mode, and device are chosen (placeholders do not count)", async () => {
    render(<App />);
    await screen.findByText("AudioBookConverter");
    const start = screen.getByText("Start");
    expect(start).toBeDisabled();
  });

  it("updates folder path after picker returns (openFolder mocked)", async () => {
    render(<App />);
    await screen.findByText("AudioBookConverter");
    fireEvent.press(screen.getByText("AudioBooks"));
    await waitFor(() => {
      expect(
        screen.getByText("/audiobooks/PR Test Book"),
      ).toBeOnTheScreen();
    });
    expect(jest.mocked(openFolder)).toHaveBeenCalled();
    await waitFor(() => {
      expect(jest.mocked(fetchGoogleBooksFirstCover)).toHaveBeenCalled();
    });
  });

  it("after confirming mode and device, Start runs mocked MP3 count and shows the MP3 summary modal", async () => {
    render(<App />);
    await screen.findByText("AudioBookConverter");
    fireEvent.press(screen.getByText("AudioBooks"));
    await waitFor(() =>
      expect(screen.getByText("/audiobooks/PR Test Book")).toBeOnTheScreen(),
    );

    fireEvent.press(screen.getByText("base"));
    expect(await screen.findByText("Choose mode")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Use"));

    fireEvent.press(screen.getByText("cpu"));
    expect(await screen.findByText("Choose device")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Use"));

    await waitFor(() => expect(screen.getByText("Start")).not.toBeDisabled());
    fireEvent.press(screen.getByText("Start"));

    expect(await screen.findByText("MP3 files")).toBeOnTheScreen();
    expect(
      screen.getByText(
        /Found 2 MP3 file\(s\) in the selected folder \(including subfolders\)\./,
      ),
    ).toBeOnTheScreen();
    expect(jest.mocked(countMp3Files)).toHaveBeenCalledWith(
      "/audiobooks/PR Test Book",
    );
  });
});
