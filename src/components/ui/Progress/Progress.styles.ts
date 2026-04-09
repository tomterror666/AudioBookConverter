import { StyleSheet, ViewStyle } from "react-native";

type ProgressStyleKeys = {
  root: ViewStyle;
};

export const styles = StyleSheet.create<ProgressStyleKeys>({
  root: {
    overflow: "hidden",
  },
});
