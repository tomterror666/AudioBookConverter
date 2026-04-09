import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Color } from "../constants";

type SettingsGearButtonProps = {
  onPress: () => void;
  /** When true, a badge indicates not all dependency LEDs are green (macOS). */
  attention: boolean;
};

const HIT = 44;
const ICON_SIZE = 22;

export function SettingsGearButton(
  props: SettingsGearButtonProps,
): React.JSX.Element {
  const { onPress, attention } = props;

  return (
    <Pressable
      onPress={onPress}
      style={styles.hit}
      accessibilityRole="button"
      accessibilityLabel="Python info and dependencies">
      <View style={styles.iconWrap}>
        <Text
          style={styles.glyph}
          allowFontScaling={false}
          maxFontSizeMultiplier={1.2}>
          ⚙
        </Text>
        {attention ? <View style={styles.badge} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    width: HIT,
    height: HIT,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  iconWrap: {
    width: ICON_SIZE + 6,
    height: ICON_SIZE + 6,
    alignItems: "center",
    justifyContent: "center",
  },
  glyph: {
    fontSize: ICON_SIZE,
    lineHeight: ICON_SIZE + 2,
    color: Color.gray800,
    textAlign: "center",
  },
  badge: {
    position: "absolute",
    top: 0,
    right: -1,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: Color.destructive,
    borderWidth: 1.5,
    borderColor: Color.white,
  },
});
