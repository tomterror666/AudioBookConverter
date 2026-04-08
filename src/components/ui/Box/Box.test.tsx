import "react-native";
import React from "react";
import { StyleSheet, View } from "react-native";
import { describe, expect, it } from "@jest/globals";
import renderer from "react-test-renderer";
import { Size } from "../../../constants";
import { Box } from "./Box";

function flattenStyle(input: unknown): Record<string, unknown> {
  return StyleSheet.flatten(input) as Record<string, unknown>;
}

describe("Box", () => {
  it("renders children", () => {
    const tree = renderer.create(
      <Box>
        <View testID="child" />
      </Box>,
    );
    const child = tree.root.findByProps({ testID: "child" });
    expect(child).toBeTruthy();
  });

  it("applies single token spacing", () => {
    const tree = renderer.create(
      <Box padding={Size.size_8} margin={Size.size_4}>
        <View />
      </Box>,
    );
    const boxView = tree.root.findAllByType(View)[0];
    const style = flattenStyle(boxView.props.style);
    expect(style.padding).toBe(8);
    expect(style.margin).toBe(4);
  });

  it("applies directional inline/block spacing", () => {
    const tree = renderer.create(
      <Box margin={{ inline: Size.size_16, block: Size.size_12 }}>
        <View />
      </Box>,
    );
    const boxView = tree.root.findAllByType(View)[0];
    const style = flattenStyle(boxView.props.style);
    expect(style.marginLeft).toBe(16);
    expect(style.marginRight).toBe(16);
    expect(style.marginTop).toBe(12);
    expect(style.marginBottom).toBe(12);
  });
});
