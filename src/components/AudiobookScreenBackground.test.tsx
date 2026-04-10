import "react-native";
import React from "react";
import { describe, expect, it } from "@jest/globals";
import renderer from "react-test-renderer";
import Svg from "react-native-svg";
import { AudiobookScreenBackground } from "./AudiobookScreenBackground";

describe("AudiobookScreenBackground", () => {
  it("renders full-bleed svg", () => {
    const tree = renderer.create(<AudiobookScreenBackground />);
    const svg = tree.root.findByType(Svg);
    expect(svg.props.preserveAspectRatio).toBe("xMidYMid slice");
    expect(svg.props.width).toBeGreaterThan(0);
    expect(svg.props.height).toBeGreaterThan(0);
  });
});
