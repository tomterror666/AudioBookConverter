import { StyleSheet } from "react-native";

const TRACK_HEIGHT = 6;
const THUMB_SIZE = 24;
const CONTENT_ROW_PADDING = 24;
const FORM_EDGE_MARGIN = 32;
const SLIDER_HORIZONTAL_INSET = CONTENT_ROW_PADDING + FORM_EDGE_MARGIN;

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  mainColumn: {
    flex: 1,
    flexDirection: "column",
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
  },
  statusAside: {
    flexShrink: 0,
    marginLeft: FORM_EDGE_MARGIN,
    marginRight: FORM_EDGE_MARGIN,
    minWidth: 0,
    maxWidth: 920,
    alignSelf: "flex-start",
    alignItems: "flex-start",
  },
  buttonContainer: {
    marginLeft: FORM_EDGE_MARGIN,
    marginTop: 0,
    alignSelf: "flex-start",
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
  pathInput: {
    borderWidth: 1,
    borderColor: "#CCCCCC",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#FFFFFF",
    minWidth: 300,
  },
  pathInputText: {
    fontSize: 14,
    color: "#000000",
  },
  pathInputPlaceholder: {
    color: "#999999",
  },
  startButtonWrapper: {
    marginTop: 64,
  },
  sliderContainer: {
    alignSelf: "stretch",
    marginHorizontal: SLIDER_HORIZONTAL_INSET,
    marginBottom: 32,
  },
  progressStepLabel: {
    alignSelf: "stretch",
    marginBottom: 10,
    fontSize: 20,
    fontWeight: "500",
    color: "#333333",
    textAlign: "left",
  },
  progressStepMp3: {
    fontSize: 20,
    fontWeight: "400",
    color: "#666666",
  },
  sliderTrack: {
    height: THUMB_SIZE,
    justifyContent: "center",
    alignSelf: "stretch",
    width: "100%",
    minWidth: 200,
  },
  sliderTrackBg: {
    position: "absolute",
    left: 0,
    right: 0,
    top: (THUMB_SIZE - TRACK_HEIGHT) / 2,
    height: TRACK_HEIGHT,
    backgroundColor: "#E0E0E0",
    borderRadius: TRACK_HEIGHT / 2,
  },
  sliderFill: {
    position: "absolute",
    left: 0,
    top: (THUMB_SIZE - TRACK_HEIGHT) / 2,
    height: TRACK_HEIGHT,
    backgroundColor: "#34C759",
    borderRadius: TRACK_HEIGHT / 2,
  },
  sliderThumb: {
    position: "absolute",
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: "#333333",
    top: 0,
  },
});
