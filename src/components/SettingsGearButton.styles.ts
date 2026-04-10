import { StyleSheet } from "react-native";
import { Color } from "../constants";

export const SETTINGS_GEAR_HIT = 44;
export const SETTINGS_GEAR_ICON_SIZE = 22;

export const styles = StyleSheet.create({
  hit: {
    width: SETTINGS_GEAR_HIT,
    height: SETTINGS_GEAR_HIT,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  iconWrap: {
    width: SETTINGS_GEAR_ICON_SIZE + 6,
    height: SETTINGS_GEAR_ICON_SIZE + 6,
    alignItems: "center",
    justifyContent: "center",
  },
  glyph: {
    fontSize: SETTINGS_GEAR_ICON_SIZE,
    lineHeight: SETTINGS_GEAR_ICON_SIZE + 2,
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
