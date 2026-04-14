/**
 * @format
 */

import "react-native";
import React from "react";
jest.mock("react-native-file-panel", () => ({
  openFolder: async () => "",
}));

jest.mock("../DependencyStatusPanel", () => ({
  DependencyStatusPanel: () => null,
}));

import { MainPage } from "./MainPage";

import { it, jest } from "@jest/globals";

import renderer, { act } from "react-test-renderer";

it("renders correctly", async () => {
  let tree: renderer.ReactTestRenderer;

  await act(async () => {
    tree = renderer.create(<MainPage />);
  });

  await act(async () => {
    tree!.unmount();
  });
});
