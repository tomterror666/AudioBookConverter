import React from "react";
import { View } from "react-native";
import { SettingsGearButton } from "./SettingsGearButton";
import { styles } from "./SettingsGearOverlay.styles";

type SettingsGearOverlayProps = {
  onPress: () => void;
  attention: boolean;
};

/**
 * Top-right settings control, separate from the title header so the header stays
 * a simple centered block (historical layout).
 */
export function SettingsGearOverlay(
  props: SettingsGearOverlayProps,
): React.JSX.Element {
  const { onPress, attention } = props;

  return (
    <View style={styles.root} pointerEvents="box-none">
      <SettingsGearButton attention={attention} onPress={onPress} />
    </View>
  );
}
