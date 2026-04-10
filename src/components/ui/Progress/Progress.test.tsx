import "react-native";
import React from "react";
import { View } from "react-native";
import { Circle, Path, Svg } from "react-native-svg";
import { describe, expect, it } from "@jest/globals";
import renderer from "react-test-renderer";
import { Color } from "../../../constants";
import { Progress, ProgressSize, ProgressType } from "./Progress";

describe("Progress", () => {
  it("renders empty circle track when value is 0", () => {
    const tree = renderer.create(
      <Progress color={Color.primary} value={0} size={ProgressSize.Medium} />,
    );
    const svg = tree.root.findByType(Svg);
    const circles = svg.findAllByType(Circle);
    expect(circles).toHaveLength(1);
    expect(() => svg.findByType(Path)).toThrow();
  });

  it("renders filled sector path for partial value", () => {
    const tree = renderer.create(
      <Progress color={Color.primary} value={0.4} size={ProgressSize.Medium} />,
    );
    const svg = tree.root.findByType(Svg);
    expect(svg.findAllByType(Circle)).toHaveLength(1);
    expect(svg.findByType(Path)).toBeTruthy();
  });

  it("renders second circle when value is 1", () => {
    const tree = renderer.create(
      <Progress color={Color.primary} value={1} size={ProgressSize.Medium} />,
    );
    const svg = tree.root.findByType(Svg);
    expect(svg.findAllByType(Circle)).toHaveLength(2);
    expect(() => svg.findByType(Path)).toThrow();
  });

  it("renders an empty view for unsupported type", () => {
    const tree = renderer.create(
      <Progress
        type={"unsupported" as ProgressType}
        color={Color.primary}
        value={0.5}
      />,
    );
    expect(tree.root.findByType(View)).toBeTruthy();
    expect(() => tree.root.findByType(Svg)).toThrow();
  });
});
