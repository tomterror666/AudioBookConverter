import "react-native";
import React from "react";
import { ScrollView, Text } from "react-native";
import { describe, expect, it, jest } from "@jest/globals";
import renderer from "react-test-renderer";
import { Modal } from "../components/ui/Modal";
import { PythonInfoModal } from "./PythonInfoModal";

jest.mock("../components/DependencyStatusPanel", () => {
  const ReactNs = require("react");
  const { Text: RNText } = require("react-native");
  return {
    DependencyStatusPanel: () =>
      ReactNs.createElement(RNText, null, "DependencyPanelMock"),
  };
});

describe("PythonInfoModal", () => {
  it("renders nothing when not visible", () => {
    const tree = renderer.create(
      <PythonInfoModal
        visible={false}
        onClose={() => {}}
        onDependencyCheckResult={jest.fn()}
      />,
    );
    expect(tree.toJSON()).toBeNull();
  });

  it("renders scroll content and mocked panel when visible", () => {
    const tree = renderer.create(
      <PythonInfoModal
        visible
        onClose={() => {}}
        onDependencyCheckResult={jest.fn()}
      />,
    );
    const scroll = tree.root.findByType(ScrollView);
    expect(scroll).toBeTruthy();
    const texts = tree.root.findAllByType(Text);
    expect(texts.some(t => t.props.children === "DependencyPanelMock")).toBe(
      true,
    );
  });
});
