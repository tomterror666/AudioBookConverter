import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  /** Border on outer View — RN macOS often skips borders on Pressable / inner layouts. */
  outline: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#CCCCCC",
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
    minWidth: 300,
  },
  pressable: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  text: {
    fontSize: 14,
    color: "#000000",
  },
  placeholder: {
    color: "#999999",
  },
});
