import "react-native";
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import renderer from "react-test-renderer";
import { SettingsGearButton } from "./SettingsGearButton";
import { SettingsGearOverlay } from "./SettingsGearOverlay";

describe("SettingsGearOverlay", () => {
  it("forwards onPress and attention to SettingsGearButton", () => {
    const onPress = jest.fn();
    const tree = renderer.create(
      <SettingsGearOverlay attention onPress={onPress} />,
    );
    const button = tree.root.findByType(SettingsGearButton);
    expect(button.props.attention).toBe(true);
    button.props.onPress();
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
