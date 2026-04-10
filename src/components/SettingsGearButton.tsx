import React from "react";
import { Pressable, Text, View } from "react-native";
import { styles } from "./SettingsGearButton.styles";

type SettingsGearButtonProps = {
  onPress: () => void;
  /** When true, a badge indicates not all dependency LEDs are green (macOS). */
  attention: boolean;
};

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
