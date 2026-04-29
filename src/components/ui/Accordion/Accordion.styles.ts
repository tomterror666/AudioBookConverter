import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerPressed: {
    opacity: 0.78,
  },
  /** Title slot: shrinks to content; override `maxWidth` or pass `titleContainerStyle` from caller. */
  titleContainer: {
    flexGrow: 0,
    flexShrink: 0,
    maxWidth: 400,
    justifyContent: "center",
  },
  chevron: {
    fontSize: 11,
    lineHeight: 16,
    color: "#555555",
    minWidth: 18,
    textAlign: "left",
  },
  panel: {
    marginTop: 8,
    gap: 24,
    alignSelf: "stretch",
  },
});
