import "react-native";
import React from "react";
import { StyleSheet, Text } from "react-native";
import { describe, expect, it } from "@jest/globals";
import renderer from "react-test-renderer";
import { Label, LabelAlign, LabelVariant } from "./Label";

function flattenStyle(input: unknown): Record<string, unknown> {
  return StyleSheet.flatten(input) as Record<string, unknown>;
}

describe("Label", () => {
  it("renders title", () => {
    const tree = renderer.create(
      <Label title="Hello" variant={LabelVariant.Normal} />,
    );
    const textNode = tree.root.findByType(Text);
    expect(textNode.props.children).toBe("Hello");
  });

  it("applies provided color and alignment", () => {
    const tree = renderer.create(
      <Label
        title="Hello"
        variant={LabelVariant.Normal}
        color="#112233"
        align={LabelAlign.Center}
      />,
    );
    const textNode = tree.root.findByType(Text);
    const style = flattenStyle(textNode.props.style);
    expect(style.color).toBe("#112233");
    expect(style.textAlign).toBe("center");
  });

  it("applies header variant font size", () => {
    const tree = renderer.create(
      <Label title="Header" variant={LabelVariant.Header2} />,
    );
    const textNode = tree.root.findByType(Text);
    const style = flattenStyle(textNode.props.style);
    expect(style.fontSize).toBe(28);
  });

  it("passes through numberOfLines and ellipsizeMode", () => {
    const tree = renderer.create(
      <Label
        title="Line"
        variant={LabelVariant.Normal}
        numberOfLines={1}
        ellipsizeMode="tail"
      />,
    );
    const textNode = tree.root.findByType(Text);
    expect(textNode.props.numberOfLines).toBe(1);
    expect(textNode.props.ellipsizeMode).toBe("tail");
  });
});
