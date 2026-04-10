import "react-native";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { describe, expect, it, jest } from "@jest/globals";
import renderer from "react-test-renderer";
import { SettingsGearButton } from "./SettingsGearButton";

describe("SettingsGearButton", () => {
  it("renders gear glyph and calls onPress", () => {
    const onPress = jest.fn();
    const tree = renderer.create(
      <SettingsGearButton attention={false} onPress={onPress} />,
    );
    const text = tree.root.findByType(Text);
    expect(text.props.children).toBe("\u2699");
    tree.root.findByType(Pressable).props.onPress();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("shows attention badge when attention is true", () => {
    const tree = renderer.create(
      <SettingsGearButton attention onPress={() => {}} />,
    );
    const iconWrap = tree.root.findByType(View);
    const innerViews = iconWrap.findAllByType(View);
    expect(innerViews.length).toBeGreaterThanOrEqual(1);
    const withBadge = innerViews.filter(
      v => v.props.style?.backgroundColor != null,
    );
    expect(withBadge.length).toBeGreaterThanOrEqual(1);
  });

  it("hides badge when attention is false", () => {
    const tree = renderer.create(
      <SettingsGearButton attention={false} onPress={() => {}} />,
    );
    const iconWrap = tree.root.findByType(View);
    const innerViews = iconWrap.findAllByType(View);
    const withBadge = innerViews.filter(
      v => v.props.style?.backgroundColor != null,
    );
    expect(withBadge.length).toBe(0);
  });
});
