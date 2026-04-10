/**
 * @format
 */

import "react-native";
import React from "react";
jest.mock("react-native-file-panel", () => ({
  openFolder: async () => "",
}));

jest.mock("./components/DependencyStatusPanel", () => ({
  DependencyStatusPanel: () => null,
}));

import App from "./App";

// Note: import explicitly to use the types shipped with jest.
import { it, jest } from "@jest/globals";

// Note: test renderer must be required after react-native.
import renderer, { act } from "react-test-renderer";

it("renders correctly", async () => {
  let tree: renderer.ReactTestRenderer;

  await act(async () => {
    tree = renderer.create(<App />);
  });

  await act(async () => {
    tree!.unmount();
  });
});
