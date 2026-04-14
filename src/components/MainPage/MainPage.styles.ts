import { StyleSheet } from "react-native";

const CONTENT_ROW_PADDING = 24;
const FORM_EDGE_MARGIN = 32;
/** Space between form column content and the column edge before the status panel (px). */
const FORM_COLUMN_END_INSET = 16;
/**
 * Fixed width for the step title column so the longest line (see CONVERSION_STEP_TITLES)
 * fits on one row and the gap to the progress circle stays ~CONVERSION_STEP_LABEL_GAP.
 */
const CONVERSION_STEP_LABEL_COLUMN_WIDTH = 348;
/** Horizontal space between the end of the title column and the progress circle (px). */
const CONVERSION_STEP_LABEL_GAP = 16;

export const styles = StyleSheet.create({
  mainColumn: {
    flex: 1,
    flexDirection: "column",
    position: "relative",
    zIndex: 1,
  },
  mainScroll: {
    flex: 1,
    minHeight: 0,
  },
  mainScrollContent: {
    flexGrow: 1,
    paddingBottom: 8,
  },
  contentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingTop: 24,
    paddingHorizontal: CONTENT_ROW_PADDING,
  },
  formColumn: {
    flex: 1,
    minWidth: 0,
    alignSelf: "flex-start",
    paddingRight: FORM_COLUMN_END_INSET,
  },
  buttonContainer: {
    marginLeft: FORM_EDGE_MARGIN,
    marginTop: 0,
    alignSelf: "stretch",
  },
  verzeichnisRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  fieldLabelContainer: {
    width: 130,
    justifyContent: "center",
  },
  modeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 32,
  },
  modeInputWrapper: {
    marginLeft: 64,
    flex: 1,
    maxWidth: 600,
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 32,
  },
  deviceInputWrapper: {
    marginLeft: 64,
    flex: 1,
    maxWidth: 600,
  },
  pathInputWrapper: {
    marginLeft: 64,
    flex: 1,
    maxWidth: 600,
  },
  startButtonWrapper: {
    marginTop: 64,
  },
  conversionStepsListPanel: {
    marginTop: 48,
    alignSelf: "flex-start",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "#CCCCCC",
    borderRadius: 8,
    paddingVertical: 16,
    paddingHorizontal: 16,
    overflow: "hidden",
  },
  conversionStepsList: {
    gap: 8,
    alignSelf: "flex-start",
  },
  conversionStepListRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
  },
  conversionStepListLabelWrap: {
    width: CONVERSION_STEP_LABEL_COLUMN_WIDTH,
    flexShrink: 0,
    paddingRight: CONVERSION_STEP_LABEL_GAP,
  },
  conversionStepListProgress: {
    flexShrink: 0,
  },
});
