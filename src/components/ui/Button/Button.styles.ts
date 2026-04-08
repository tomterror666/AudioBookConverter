import { StyleSheet, TextStyle, ViewStyle } from "react-native";
import { Color } from "../../../constants";

type ButtonStyleKeys = {
  buttonBase: ViewStyle;
  buttonNormal: ViewStyle;
  buttonSmall: ViewStyle;
  buttonPrimary: ViewStyle;
  buttonSecondary: ViewStyle;
  buttonTertiary: ViewStyle;
  buttonTextVariant: ViewStyle;
  buttonGhost: ViewStyle;
  buttonDestructive: ViewStyle;
  buttonDisabled: ViewStyle;
  textBase: TextStyle;
  textNormal: TextStyle;
  textSmall: TextStyle;
  textLight: TextStyle;
  textDark: TextStyle;
  textDisabled: TextStyle;
};

export const styles = StyleSheet.create<ButtonStyleKeys>({
  buttonBase: {
    alignSelf: "flex-start",
    borderRadius: 8,
    alignItems: "center",
  },
  buttonNormal: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  buttonSmall: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  buttonPrimary: {
    backgroundColor: Color.primary,
  },
  buttonSecondary: {
    backgroundColor: Color.gray200,
  },
  buttonTertiary: {
    backgroundColor: Color.surfaceLight,
    borderWidth: 1,
    borderColor: Color.borderLight,
  },
  buttonTextVariant: {
    backgroundColor: Color.transparent,
  },
  buttonGhost: {
    backgroundColor: Color.transparent,
    borderWidth: 1,
    borderColor: Color.borderLight,
  },
  buttonDestructive: {
    backgroundColor: Color.destructive,
  },
  buttonDisabled: {
    backgroundColor: Color.textSecondaryDark,
  },
  textBase: {
    fontWeight: "600",
  },
  textNormal: {
    fontSize: 15,
  },
  textSmall: {
    fontSize: 13,
  },
  textLight: {
    color: Color.white,
  },
  textDark: {
    color: Color.textPrimaryLight,
  },
  textDisabled: {
    color: Color.surfaceLight,
  },
});
