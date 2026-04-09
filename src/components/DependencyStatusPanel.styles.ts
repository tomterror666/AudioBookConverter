import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  /** Outer shell holds the border (reliable on RN macOS). */
  panelOutline: {
    margin: 0,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#CCCCCC",
    borderRadius: 12,
    backgroundColor: "#FAFAFA",
    minWidth: 488,
    alignSelf: "stretch",
    overflow: "hidden",
  },
  panelInner: {
    padding: 16,
  },
  panelTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000000",
    marginBottom: 10,
  },
  labelColumn: {
    flexShrink: 0,
    width: 232,
    paddingRight: 28,
  },
  venvPathColumn: {
    flex: 1,
    minWidth: 0,
    alignSelf: "stretch",
    justifyContent: "center",
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  venvTableRow: {
    alignItems: "center",
  },
  rowLast: {
    marginBottom: 0,
  },
  ledColumn: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  actionColumn: {
    width: 80,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  afterTitleGap: {
    marginTop: 10,
  },
  led: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  rowButton: {
    minWidth: 76,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: "#007AFF",
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 32,
  },
  rowButtonDisabled: {
    opacity: 0.85,
  },
  rowButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  rowButtonPlaceholder: {
    minWidth: 76,
    minHeight: 32,
  },
});
