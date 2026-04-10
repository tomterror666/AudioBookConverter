import "react-native";
import { describe, expect, it, beforeEach } from "@jest/globals";
import { Platform } from "react-native";
import { isCudaDeviceSupportedOnThisPlatform } from "./deviceCudaSupport";

function setPlatform(os: string): void {
  Object.defineProperty(Platform, "OS", {
    value: os,
    configurable: true,
  });
}

describe("deviceCudaSupport", () => {
  beforeEach(() => {
    setPlatform("ios");
  });

  it("returns false on macOS", () => {
    setPlatform("macos");
    expect(isCudaDeviceSupportedOnThisPlatform()).toBe(false);
  });

  it("returns true on Windows", () => {
    setPlatform("windows");
    expect(isCudaDeviceSupportedOnThisPlatform()).toBe(true);
  });

  it("returns false on other platforms (e.g. iOS)", () => {
    setPlatform("ios");
    expect(isCudaDeviceSupportedOnThisPlatform()).toBe(false);
  });
});
