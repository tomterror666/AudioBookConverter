import React from "react";
import { StyleSheet, View } from "react-native";
import { SettingsGearButton } from "./SettingsGearButton";

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

const INSET = 8;

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: INSET,
    right: INSET,
    zIndex: 10,
  },
});
