import React, { useCallback, useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { Button, ButtonSize, ButtonVariant } from "./ui/Button";
import { Label, LabelVariant } from "./ui/Label";
import { Modal } from "./ui/Modal";
import { styles } from "./DependencyStatusPanel.styles";
import { useUiCopy } from "../UiLocaleContext";
import {
  DependencyCheckResult,
  DependencyKey,
  DependencyLedStatus,
  DependencyStatuses,
  runDependencyChecks,
  runSingleDependencyAction,
} from "../utils/dependencyStatus";

const LED_COLORS: Record<DependencyLedStatus, string> = {
  missing: "#FF3B30",
  wrong_version: "#FFCC00",
  ok: "#34C759",
};

const ROWS: { key: DependencyKey; label: string }[] = [
  { key: "python", label: "Python" },
  { key: "pip", label: "Package Installer (pip)" },
  { key: "ffmpeg", label: "ffmpeg" },
  { key: "fasterWhisper", label: "faster-whisper" },
];

type DependencyStatusPanelProps = {
  onCheckResult?: (result: DependencyCheckResult) => void;
};

export function DependencyStatusPanel(
  props: DependencyStatusPanelProps,
): React.JSX.Element {
  const { onCheckResult } = props;
  const [statuses, setStatuses] = useState<DependencyStatuses | null>(null);
  const [venvPathDisplay, setVenvPathDisplay] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<DependencyKey | null>(null);
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const [feedbackHeadline, setFeedbackHeadline] = useState("");
  const [feedbackContent, setFeedbackContent] = useState("");
  const u = useUiCopy();

  const refresh = useCallback(() => {
    runDependencyChecks().then(({ statuses: next, venvPathDisplay: path }) => {
      setStatuses(next);
      setVenvPathDisplay(path);
      onCheckResult?.({ statuses: next, venvPathDisplay: path });
    });
  }, [onCheckResult]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runAction = async (key: DependencyKey, mode: "install" | "update") => {
    setBusyKey(key);
    try {
      const log = await runSingleDependencyAction(key, mode);
      await refresh();
      const preview =
        log.length > 1400
          ? `${log.slice(0, 1400)}…`
          : log || u.pythonInfo.donePreview;
      setFeedbackHeadline(
        mode === "install"
          ? u.pythonInfo.feedbackInstall
          : u.pythonInfo.feedbackUpdate,
      );
      setFeedbackContent(preview);
      setFeedbackVisible(true);
    } catch (e) {
      setFeedbackHeadline(u.pythonInfo.errorHeadline);
      setFeedbackContent(e instanceof Error ? e.message : String(e));
      setFeedbackVisible(true);
    } finally {
      setBusyKey(null);
    }
  };

  const isMacos = Platform.OS === "macos";

  return (
    <View style={styles.panelOutline} collapsable={false}>
      <View style={styles.panelInner}>
        <Label title={u.pythonInfo.header} variant={LabelVariant.Header2} />

        <View style={styles.afterTitleGap}>
        <View style={[styles.tableRow, styles.venvTableRow]}>
          <View style={styles.labelColumn}>
            <Label
              title={u.pythonInfo.pythonEnv}
              variant={LabelVariant.NormalBold}
            />
          </View>
          <View style={styles.venvPathColumn}>
            <Label
              title={
                isMacos
                  ? venvPathDisplay ?? "~/.audioBookConverter"
                  : u.pythonInfo.macosOnly
              }
              variant={LabelVariant.Normal}
              numberOfLines={1}
              ellipsizeMode="tail"
            />
          </View>
          <View style={styles.actionColumn}>
            <View style={styles.rowButtonPlaceholder} />
          </View>
        </View>

        {ROWS.map((row, index) => {
          const s = statuses?.[row.key] ?? "missing";
          const busy = busyKey === row.key;
          const showInstall = isMacos && s === "missing";
          const showUpdate = isMacos && s === "wrong_version";

          return (
            <View
              key={row.key}
              style={[
                styles.tableRow,
                index === ROWS.length - 1 && styles.rowLast,
              ]}>
              <View style={styles.labelColumn}>
                <Label
                  title={`${row.label}:`}
                  variant={LabelVariant.NormalBold}
                />
              </View>
              <View style={styles.ledColumn}>
                <View
                  style={[styles.led, { backgroundColor: LED_COLORS[s] }]}
                />
              </View>
              <View style={styles.actionColumn}>
                {showInstall || showUpdate ? (
                  <Button
                    variant={
                      showInstall
                        ? ButtonVariant.Primary
                        : ButtonVariant.Secondary
                    }
                    size={ButtonSize.Small}
                    onPress={() =>
                      runAction(row.key, showInstall ? "install" : "update")
                    }
                    isLoading={busy}
                    disabled={busy}>
                    {showInstall ? u.pythonInfo.install : u.pythonInfo.update}
                  </Button>
                ) : (
                  <View style={styles.rowButtonPlaceholder} />
                )}
              </View>
            </View>
          );
        })}
        </View>
      </View>
      <Modal
        visible={feedbackVisible}
        headline={feedbackHeadline}
        buttonConfig={[
          {
            label: "OK",
            variant: ButtonVariant.Primary,
            onPress: () => setFeedbackVisible(false),
          },
        ]}
        onRequestClose={() => setFeedbackVisible(false)}>
        <Label title={feedbackContent} variant={LabelVariant.Normal} />
      </Modal>
    </View>
  );
}
