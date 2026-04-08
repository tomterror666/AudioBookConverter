/**
 * AudioBookConverter App
 *
 * @format
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  DeviceEventEmitter,
  GestureResponderEvent,
  LayoutChangeEvent,
  NativeModules,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  View,
} from "react-native";
import { openFolder } from "react-native-file-panel";
import { DependencyStatusPanel } from "./components/DependencyStatusPanel";
import { Box } from "./components/ui/Box";
import { Button, ButtonVariant } from "./components/ui/Button";
import { Label, LabelAlign, LabelVariant } from "./components/ui/Label";
import {
  CONVERSION_STEP_TITLES,
  DEVICE_OPTIONS,
  MODE_OPTIONS,
  Size,
  THUMB_SIZE,
} from "./constants";
import {
  CreateAudiobookM4bModal,
  DetermineChapterPositionsModal,
  EmbedChaptersInM4aModal,
  InfoModal,
  Mp3CountModal,
  SelectionModal,
} from "./modals";
import {
  allDependencyLedsGreen,
  type DependencyCheckResult,
  type DependencyStatuses,
} from "./utils/dependencyStatus";
import { isCudaDeviceSupportedOnThisPlatform } from "./utils/deviceCudaSupport";
import { styles } from "./App.styles";
import {
  ConversionCancelledError,
  countMp3Files,
  createAudiobookFile,
  createMp4WithChapterMarkers,
  isConversionCancelled,
  locateChapters,
} from "./utils/conversionPipeline";

type DependencyStatusNativeModule = {
  selectDirectory?: () => Promise<string | null>;
};

function App(): React.JSX.Element {
  const [progress, setProgress] = useState(0);
  const [trackWidth, setTrackWidth] = useState(0);
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(
    null,
  );
  const [selectedMode, setSelectedMode] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  /** Aktueller Pipeline-Schritt 1…4, 0 = inaktiv */
  const [conversionStep, setConversionStep] = useState(0);
  /** Aus Schritt 1 (MP3-Anzahl) — Anzeige „x von N“ in Schritt 2 */
  const [mp3FileTotal, setMp3FileTotal] = useState<number | null>(null);
  /** In Schritt 2: fertig verarbeitete MP3s (laut Native-Events nach jeder Datei) */
  const [whisperMp3Done, setWhisperMp3Done] = useState(0);
  /** Schritt 3 (Merge): Unterfortschritt aus nativen Events (kind === 'merge') */
  const [mergeProgressDone, setMergeProgressDone] = useState(0);
  const [mergeProgressTotal, setMergeProgressTotal] = useState(0);
  /** Schritt 3: erkannte Kapitel (marks) oder MP3-Dateien in Timeline-Reihenfolge */
  const [mergeChapterCurrent, setMergeChapterCurrent] = useState(0);
  const [mergeChapterTotal, setMergeChapterTotal] = useState(0);
  const [mergeChapterMode, setMergeChapterMode] = useState<
    "marks" | "mp3" | null
  >(null);
  const [dependencyStatuses, setDependencyStatuses] =
    useState<DependencyStatuses | null>(null);
  const trackLayout = useRef({ width: 300 });
  const [mp3ConfirmVisible, setMp3ConfirmVisible] = useState(false);
  const [pendingMp3Count, setPendingMp3Count] = useState<number | null>(null);
  const mp3ConfirmResolver = useRef<((confirmed: boolean) => void) | null>(
    null,
  );
  const [step2SummaryVisible, setStep2SummaryVisible] = useState(false);
  const [step2SummaryContent, setStep2SummaryContent] = useState("");
  const step2SummaryResolver = useRef<(() => void) | null>(null);
  const [step3SummaryVisible, setStep3SummaryVisible] = useState(false);
  const [step3SummaryContent, setStep3SummaryContent] = useState("");
  const step3SummaryResolver = useRef<(() => void) | null>(null);
  const [step4SuccessVisible, setStep4SuccessVisible] = useState(false);
  const [step4SuccessContent, setStep4SuccessContent] = useState("");
  const step4SuccessResolver = useRef<(() => void) | null>(null);
  const [infoVisible, setInfoVisible] = useState(false);
  const [infoHeadline, setInfoHeadline] = useState("");
  const [infoContent, setInfoContent] = useState("");
  const [selectionVisible, setSelectionVisible] = useState(false);
  const [selectionHeadline, setSelectionHeadline] = useState("");
  const [selectionContent, setSelectionContent] = useState("");
  const [selectionOptions, setSelectionOptions] = useState<string[]>([]);
  const [selectionInitialValue, setSelectionInitialValue] = useState<
    string | null
  >(null);
  const selectionResolver = useRef<((value: string | null) => void) | null>(
    null,
  );

  const onDependencyCheckResult = useCallback(
    (result: DependencyCheckResult) => {
      setDependencyStatuses(result.statuses);
    },
    [],
  );

  const askMp3CountConfirmation = useCallback(
    (count: number): Promise<boolean> =>
      new Promise(resolve => {
        setPendingMp3Count(count);
        setMp3ConfirmVisible(true);
        mp3ConfirmResolver.current = resolve;
      }),
    [],
  );

  const resolveMp3CountConfirmation = useCallback((confirmed: boolean) => {
    const resolver = mp3ConfirmResolver.current;
    mp3ConfirmResolver.current = null;
    setMp3ConfirmVisible(false);
    setPendingMp3Count(null);
    resolver?.(confirmed);
  }, []);

  const askStep2Summary = useCallback(
    (chapterCount: number, chapterLabels: string[]): Promise<void> =>
      new Promise(resolve => {
        const shown = chapterLabels.slice(0, 12);
        const remaining = Math.max(0, chapterLabels.length - shown.length);
        const listPart =
          shown.length > 0 ? `\n\n${shown.map(l => `• ${l}`).join("\n")}` : "";
        const morePart = remaining > 0 ? `\n… und ${remaining} weitere` : "";
        setStep2SummaryContent(
          `Es wurden ${chapterCount} Kapitel erkannt.${listPart}${morePart}`,
        );
        setStep2SummaryVisible(true);
        step2SummaryResolver.current = resolve;
      }),
    [],
  );

  const resolveStep2Summary = useCallback(() => {
    const resolver = step2SummaryResolver.current;
    step2SummaryResolver.current = null;
    setStep2SummaryVisible(false);
    setStep2SummaryContent("");
    resolver?.();
  }, []);

  const askStep3Summary = useCallback(
    (mergedPath: string): Promise<void> =>
      new Promise(resolve => {
        setStep3SummaryContent(
          `Schritt 3 abgeschlossen.\n\nZusammengeführte Datei:\n${mergedPath}`,
        );
        setStep3SummaryVisible(true);
        step3SummaryResolver.current = resolve;
      }),
    [],
  );

  const resolveStep3Summary = useCallback(() => {
    const resolver = step3SummaryResolver.current;
    step3SummaryResolver.current = null;
    setStep3SummaryVisible(false);
    setStep3SummaryContent("");
    resolver?.();
  }, []);

  const showStep4Success = useCallback(
    (m4bPath: string): Promise<void> =>
      new Promise(resolve => {
        setStep4SuccessContent(
          `Die Konvertierung ist abgeschlossen.\n\nAudiobook (M4B):\n${m4bPath}`,
        );
        setStep4SuccessVisible(true);
        step4SuccessResolver.current = resolve;
      }),
    [],
  );

  const resolveStep4Success = useCallback(() => {
    const resolver = step4SuccessResolver.current;
    step4SuccessResolver.current = null;
    setStep4SuccessVisible(false);
    setStep4SuccessContent("");
    resolver?.();
  }, []);

  const showInfoModal = useCallback((headline: string, content: string) => {
    setInfoHeadline(headline);
    setInfoContent(content);
    setInfoVisible(true);
  }, []);

  const closeInfoModal = useCallback(() => {
    setInfoVisible(false);
    setInfoHeadline("");
    setInfoContent("");
  }, []);

  const askSelection = useCallback(
    (
      headline: string,
      content: string,
      options: readonly string[],
      initialValue?: string | null,
    ): Promise<string | null> =>
      new Promise(resolve => {
        setSelectionHeadline(headline);
        setSelectionContent(content);
        setSelectionOptions([...options]);
        setSelectionInitialValue(initialValue ?? null);
        setSelectionVisible(true);
        selectionResolver.current = resolve;
      }),
    [],
  );

  const resolveSelection = useCallback((value: string | null) => {
    const resolver = selectionResolver.current;
    selectionResolver.current = null;
    setSelectionVisible(false);
    setSelectionHeadline("");
    setSelectionContent("");
    setSelectionOptions([]);
    setSelectionInitialValue(null);
    resolver?.(value);
  }, []);

  const step2SliderProgress =
    conversionStep === 2 && mp3FileTotal != null && mp3FileTotal > 0
      ? Math.max(0, Math.min(1, whisperMp3Done / mp3FileTotal))
      : null;
  const step3SliderProgress =
    conversionStep === 3 && mergeProgressTotal > 0
      ? Math.max(0, Math.min(1, mergeProgressDone / mergeProgressTotal))
      : null;
  const displayProgress =
    step2SliderProgress != null
      ? step2SliderProgress
      : step3SliderProgress != null
      ? step3SliderProgress
      : progress;

  useEffect(() => {
    if (Platform.OS !== "macos") {
      return;
    }
    // Native ruft RCTDeviceEventEmitter.emit auf (siehe DependencyStatus.mm).
    const sub = DeviceEventEmitter.addListener(
      "WhisperScanProgress",
      (payload: {
        current?: number;
        total?: number;
        kind?: string;
        chapterCurrent?: number;
        chapterTotal?: number;
        chapterMode?: string;
      }) => {
        const isMerge = payload?.kind === "merge";
        if (isMerge) {
          const chC = payload?.chapterCurrent;
          const chT = payload?.chapterTotal;
          if (
            chC != null &&
            chT != null &&
            Number.isFinite(Number(chC)) &&
            Number.isFinite(Number(chT))
          ) {
            setMergeChapterCurrent(Math.max(0, Math.floor(Number(chC))));
            setMergeChapterTotal(Math.max(0, Math.floor(Number(chT))));
            const md = payload?.chapterMode;
            if (md === "marks" || md === "mp3") {
              setMergeChapterMode(md);
            }
          }
        }
        const cur = Number(payload?.current);
        const tot = Number(payload?.total);
        if (!Number.isFinite(cur) || !Number.isFinite(tot) || tot <= 0) {
          return;
        }
        const done = Math.max(0, Math.floor(cur));
        const frac = Math.max(0, Math.min(1, cur / tot));
        if (isMerge) {
          setMergeProgressDone(done);
          setMergeProgressTotal(Math.floor(tot));
          setProgress(frac);
        } else {
          setWhisperMp3Done(done);
          setProgress(frac);
        }
      },
    );
    return () => sub.remove();
  }, []);

  const handleTrackLayout = (e: LayoutChangeEvent) => {
    const { width } = e.nativeEvent.layout;
    if (width > 0) {
      trackLayout.current = { width };
      setTrackWidth(width);
    }
  };

  const handlePress = (e: GestureResponderEvent) => {
    if (isConverting && (conversionStep === 2 || conversionStep === 3)) {
      return;
    }
    const { locationX } = e.nativeEvent;
    const { width } = trackLayout.current;
    if (width > 0) {
      const newValue = Math.max(0, Math.min(1, locationX / width));
      setProgress(newValue);
    }
  };

  const handleVerzeichnisPress = async () => {
    try {
      if (Platform.OS === "macos") {
        const mod = NativeModules.DependencyStatus as
          | DependencyStatusNativeModule
          | undefined;
        const path =
          typeof mod?.selectDirectory === "function"
            ? await mod.selectDirectory()
            : null;
        if (path) {
          setSelectedDirectory(path);
        }
      } else if (Platform.OS === "windows") {
        const path = await openFolder();
        if (path) {
          setSelectedDirectory(path);
        }
      } else {
        showInfoModal(
          "Nicht unterstützt",
          "Der Verzeichnis-Dialog wird nur auf macOS und Windows unterstützt.",
        );
      }
    } catch (error) {
      showInfoModal(
        "Fehler",
        "Verzeichnis konnte nicht ausgewählt werden: " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  };

  const handleModePress = async () => {
    const picked = await askSelection(
      "Mode wählen",
      "Bitte wählen Sie einen Modus",
      MODE_OPTIONS,
      selectedMode,
    );
    if (picked) {
      setSelectedMode(picked);
    }
  };

  const handleDevicePress = async () => {
    const picked = await askSelection(
      "Device wählen",
      "Bitte wählen Sie ein Gerät",
      DEVICE_OPTIONS,
      selectedDevice,
    );
    if (picked) {
      setSelectedDevice(picked);
    }
  };

  const formComplete =
    typeof selectedDirectory === "string" &&
    selectedDirectory.trim().length > 0 &&
    selectedMode != null &&
    selectedMode.trim().length > 0 &&
    selectedDevice != null &&
    selectedDevice.trim().length > 0;

  const depsOkForStart =
    Platform.OS !== "macos" || allDependencyLedsGreen(dependencyStatuses);
  const startLooksInactive = !formComplete || isConverting || !depsOkForStart;

  const handleStartPress = () => {
    if (isConverting) {
      return;
    }
    if (!depsOkForStart) {
      return;
    }
    const missing: string[] = [];
    if (
      !(
        typeof selectedDirectory === "string" &&
        selectedDirectory.trim().length > 0
      )
    ) {
      missing.push("Verzeichnis");
    }
    if (!(selectedMode != null && selectedMode.trim().length > 0)) {
      missing.push("Mode");
    }
    if (!(selectedDevice != null && selectedDevice.trim().length > 0)) {
      missing.push("Device");
    }
    if (missing.length > 0) {
      showInfoModal(
        "Angaben unvollständig",
        `Bitte wählen Sie noch:\n${missing.map(m => `• ${m}`).join("\n")}`,
      );
      return;
    }

    const deviceLower = selectedDevice!.trim().toLowerCase();
    if (deviceLower === "cuda" && !isCudaDeviceSupportedOnThisPlatform()) {
      const cudaBody =
        Platform.OS === "macos"
          ? "Auf macOS steht kein CUDA-Gerät (NVIDIA) zur Verfügung. Bitte wählen Sie „cpu“."
          : "CUDA wird auf dieser Plattform nicht unterstützt. Bitte wählen Sie „cpu“.";
      showInfoModal("CUDA nicht verfügbar", cudaBody);
      return;
    }

    void (async () => {
      setIsConverting(true);
      try {
        setConversionStep(1);
        const mp3Count = await countMp3Files(selectedDirectory!.trim());
        const confirmed = await askMp3CountConfirmation(mp3Count);
        if (!confirmed) {
          throw new ConversionCancelledError();
        }
        setMp3FileTotal(mp3Count);
        setConversionStep(2);
        setWhisperMp3Done(0);
        setProgress(0);
        const chapterMarks = await locateChapters({
          rootDirectory: selectedDirectory!.trim(),
          modelSize: selectedMode!.trim(),
          device: selectedDevice!.trim().toLowerCase(),
        });
        setProgress(1);
        await askStep2Summary(
          chapterMarks.marks.length,
          chapterMarks.marks.map(mark => mark.label),
        );
        setConversionStep(3);
        setMergeProgressDone(0);
        setMergeProgressTotal(0);
        setMergeChapterCurrent(0);
        setMergeChapterTotal(0);
        setMergeChapterMode(null);
        setProgress(0);
        const mergedPath = await createMp4WithChapterMarkers(
          selectedDirectory!.trim(),
          chapterMarks,
        );
        await askStep3Summary(mergedPath);
        setConversionStep(4);
        const m4bPath = await createAudiobookFile(
          mergedPath,
          selectedDirectory!.trim(),
        );
        await showStep4Success(m4bPath);
      } catch (e) {
        if (isConversionCancelled(e)) {
          return;
        }
        showInfoModal("Fehler", e instanceof Error ? e.message : String(e));
      } finally {
        setConversionStep(0);
        setMp3FileTotal(null);
        setWhisperMp3Done(0);
        setMergeProgressDone(0);
        setMergeProgressTotal(0);
        setMergeChapterCurrent(0);
        setMergeChapterTotal(0);
        setMergeChapterMode(null);
        setProgress(0);
        setIsConverting(false);
      }
    })();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.mainColumn}>
        <Box padding={{ block: Size.size_32 }}>
          <Label
            title="AudioBookConverter"
            variant={LabelVariant.Header1}
            align={LabelAlign.Center}
          />
        </Box>
        <ScrollView
          style={styles.mainScroll}
          contentContainerStyle={styles.mainScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator>
          <View style={styles.contentRow}>
            <View style={styles.formColumn}>
              <View style={styles.buttonContainer}>
                <View style={styles.verzeichnisRow}>
                  <View style={styles.fieldLabelContainer}>
                    <Label
                      title="Verzeichnis:"
                      variant={LabelVariant.NormalBold}
                      align={LabelAlign.Left}
                    />
                  </View>
                  <Pressable
                    style={styles.pathInputWrapper}
                    onPress={handleVerzeichnisPress}>
                    <View style={styles.pathInput}>
                      <Text
                        style={[
                          styles.pathInputText,
                          !selectedDirectory && styles.pathInputPlaceholder,
                        ]}
                        numberOfLines={1}
                        ellipsizeMode="middle">
                        {selectedDirectory ?? "AudioBooks"}
                      </Text>
                    </View>
                  </Pressable>
                </View>
                <View style={styles.modeRow}>
                  <View style={styles.fieldLabelContainer}>
                    <Label
                      title="Mode:"
                      variant={LabelVariant.NormalBold}
                      align={LabelAlign.Left}
                    />
                  </View>
                  <Pressable
                    style={styles.modeInputWrapper}
                    onPress={handleModePress}>
                    <View style={styles.pathInput}>
                      <Text
                        style={[
                          styles.pathInputText,
                          !selectedMode && styles.pathInputPlaceholder,
                        ]}>
                        {selectedMode ?? "base"}
                      </Text>
                    </View>
                  </Pressable>
                </View>
                <View style={styles.deviceRow}>
                  <View style={styles.fieldLabelContainer}>
                    <Label
                      title="Device:"
                      variant={LabelVariant.NormalBold}
                      align={LabelAlign.Left}
                    />
                  </View>
                  <Pressable
                    style={styles.deviceInputWrapper}
                    onPress={handleDevicePress}>
                    <View style={styles.pathInput}>
                      <Text
                        style={[
                          styles.pathInputText,
                          !selectedDevice && styles.pathInputPlaceholder,
                        ]}>
                        {selectedDevice ?? "cpu"}
                      </Text>
                    </View>
                  </Pressable>
                </View>
                <View style={styles.startButtonWrapper}>
                  <Button
                    variant={ButtonVariant.Primary}
                    disabled={startLooksInactive}
                    onPress={handleStartPress}>
                    Start
                  </Button>
                </View>
              </View>
            </View>
            <View style={styles.statusAside}>
              <DependencyStatusPanel onCheckResult={onDependencyCheckResult} />
            </View>
          </View>
        </ScrollView>
        <View style={styles.sliderContainer}>
          {conversionStep > 0 && (
            <Text style={styles.progressStepLabel}>
              Schritt {conversionStep}/4:{" "}
              {CONVERSION_STEP_TITLES[conversionStep] ?? "—"}
              {conversionStep === 2 &&
              mp3FileTotal != null &&
              mp3FileTotal >= 0 ? (
                <Text style={styles.progressStepMp3}>
                  {" "}
                  ({whisperMp3Done} von {mp3FileTotal})
                </Text>
              ) : null}
              {conversionStep === 3 && mergeProgressTotal > 0 ? (
                <Text style={styles.progressStepMp3}>
                  {" "}
                  (
                  {mergeChapterTotal > 0 && mergeChapterCurrent > 0 ? (
                    <>
                      {mergeChapterMode === "mp3"
                        ? `Datei ${mergeChapterCurrent}/${mergeChapterTotal}`
                        : `Kapitel ${mergeChapterCurrent}/${mergeChapterTotal}`}
                      {" · "}
                    </>
                  ) : null}
                  {Math.min(
                    100,
                    Math.round((100 * mergeProgressDone) / mergeProgressTotal),
                  )}
                  % fertig
                  {mp3FileTotal != null && mp3FileTotal > 0
                    ? ` · ${mp3FileTotal} MP3-Dateien`
                    : ""}
                  )
                </Text>
              ) : null}
            </Text>
          )}
          <Pressable
            style={styles.sliderTrack}
            onLayout={handleTrackLayout}
            onPress={handlePress}>
            <View style={styles.sliderTrackBg} />
            <View
              style={[
                styles.sliderFill,
                { width: displayProgress * trackWidth },
              ]}
            />
            <View
              style={[
                styles.sliderThumb,
                {
                  left: displayProgress * trackWidth - THUMB_SIZE / 2,
                },
              ]}
            />
          </Pressable>
        </View>
      </View>
      <Mp3CountModal
        visible={mp3ConfirmVisible}
        mp3Count={pendingMp3Count}
        onCancel={() => resolveMp3CountConfirmation(false)}
        onContinue={() => resolveMp3CountConfirmation(true)}
      />
      <DetermineChapterPositionsModal
        visible={step2SummaryVisible}
        content={step2SummaryContent}
        onContinue={resolveStep2Summary}
      />
      <EmbedChaptersInM4aModal
        visible={step3SummaryVisible}
        content={step3SummaryContent}
        onContinue={resolveStep3Summary}
      />
      <CreateAudiobookM4bModal
        visible={step4SuccessVisible}
        content={step4SuccessContent}
        onClose={resolveStep4Success}
      />
      <InfoModal
        visible={infoVisible}
        headline={infoHeadline}
        content={infoContent}
        onClose={closeInfoModal}
      />
      <SelectionModal
        visible={selectionVisible}
        headline={selectionHeadline}
        content={selectionContent}
        options={selectionOptions}
        selectedValue={selectionInitialValue}
        onSelect={resolveSelection}
      />
    </SafeAreaView>
  );
}

export default App;
