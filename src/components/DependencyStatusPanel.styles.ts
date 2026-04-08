import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  panel: {
    margin: 0,
    padding: 16,
    borderWidth: 1,
    borderColor: "#CCCCCC",
    borderRadius: 12,
    backgroundColor: "#FAFAFA",
    minWidth: 540,
    maxWidth: 920,
    alignSelf: "flex-start",
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#000000",
    marginBottom: 16,
  },
  labelColumn: {
    flexShrink: 0,
    width: 204,
    paddingRight: 11,
  },
  venvValueColumn: {
    marginLeft: 16,
    flex: 1,
    minWidth: 260,
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  venvTableRow: {
    alignItems: "flex-start",
  },
  venvPathFill: {
    flex: 1,
    minWidth: 260,
    justifyContent: "center",
  },
  rowLast: {
    marginBottom: 0,
  },
  ledColumn: {
    width: 36,
    flexShrink: 0,
    marginLeft: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  pathText: {
    alignSelf: "stretch",
    fontSize: 14,
    fontWeight: "400",
    color: "#000000",
  },
  actionColumn: {
    width: 78,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  rowTrailSpacer: {
    flex: 1,
    minWidth: 0,
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
