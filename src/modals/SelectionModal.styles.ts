import { StyleSheet } from "react-native";
import { Color } from "../constants";

export const styles = StyleSheet.create({
  optionsContainer: {
    marginTop: 12,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  radioOuter: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  radioOuterActive: {
    borderColor: Color.primary,
  },
  radioOuterInactive: {
    borderColor: Color.gray500,
  },
  radioInnerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Color.primary,
  },
});
