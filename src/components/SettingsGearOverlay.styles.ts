import { StyleSheet } from "react-native";

const INSET = 8;

export const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: INSET,
    right: INSET,
    zIndex: 10,
  },
});
