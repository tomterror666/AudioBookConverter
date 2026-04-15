/**
 * Main conversion UI: form, progress steps, and related modals.
 *
 * @format
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  DeviceEventEmitter,
  NativeModules,
  Platform,
  ScrollView,
  View,
} from "react-native";
import { openFolder } from "react-native-file-panel";
import { Box } from "../ui/Box";
import { SettingsGearOverlay } from "../SettingsGearOverlay";
import { Progress, ProgressSize } from "../ui/Progress";
import { Button, ButtonVariant } from "../ui/Button";
import { InputField } from "../ui/InputField";
import { Label, LabelAlign, LabelVariant } from "../ui/Label";
import {
  Color,
  CONVERSION_STEP_TITLES,
  DEVICE_OPTIONS,
  MODE_OPTIONS,
  Size,
} from "../../constants";
import {
  CreateAudiobookM4bModal,
  DetermineChapterPositionsModal,
  EmbedChaptersInM4aModal,
  InfoModal,
  Mp3CountModal,
  PythonInfoModal,
  SelectionModal,
} from "../../modals";
import {
  allDependencyLedsGreen,
  type DependencyCheckResult,
  type DependencyStatuses,
  runDependencyChecks,
} from "../../utils/dependencyStatus";
import { isCudaDeviceSupportedOnThisPlatform } from "../../utils/deviceCudaSupport";
import {
  fetchGoogleBooksFirstCover,
  perryRhodanSearchQueryFromPath,
} from "../../utils/googleBooksCover";
import {
  ConversionCancelledError,
  countMp3Files,
  createAudiobookFile,
  createEncodedAudiobookTrack,
  isConversionCancelled,
  locateChapters,
  muxChaptersIntoMergedM4a,
  type AudiobookM4bMetadata,
} from "../../utils/conversionPipeline";
import { styles } from "./MainPage.styles";

type DependencyStatusNativeModule = {
  selectDirectory?: () => Promise<string | null>;
};

type BookCoverPreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ok";
      uri: string;
      title: string | null;
      authors: string | null;
    }
  | { status: "empty" }
  | { status: "error" };

export function MainPage(): React.JSX.Element {
  const [progress, setProgress] = useState(0);
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(
    null,
  );
  const [selectedMode, setSelectedMode] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionStep, setConversionStep] = useState(0);
  const [mp3FileTotal, setMp3FileTotal] = useState<number | null>(null);
  const [whisperMp3Done, setWhisperMp3Done] = useState(0);
  const [mergeProgressDone, setMergeProgressDone] = useState(0);
  const [mergeProgressTotal, setMergeProgressTotal] = useState(0);
  const [dependencyStatuses, setDependencyStatuses] =
    useState<DependencyStatuses | null>(null);
  const [pythonInfoVisible, setPythonInfoVisible] = useState(false);
  const [conversionStepsListComplete, setConversionStepsListComplete] =
    useState(false);
  const [mp3ConfirmVisible, setMp3ConfirmVisible] = useState(false);
  const [pendingMp3Count, setPendingMp3Count] = useState<number | null>(null);
  const mp3ConfirmResolver = useRef<((confirmed: boolean) => void) | null>(
    null,
  );
  const [step2SummaryVisible, setStep2SummaryVisible] = useState(false);
  const [step2SummaryContent, setStep2SummaryContent] = useState("");
  const step2SummaryResolver = useRef<(() => void) | null>(null);
  const [step3EncodeSummaryVisible, setStep3EncodeSummaryVisible] =
    useState(false);
  const [step3EncodeSummaryContent, setStep3EncodeSummaryContent] =
    useState("");
  const step3EncodeSummaryResolver = useRef<(() => void) | null>(null);
  const [step4MuxSummaryVisible, setStep4MuxSummaryVisible] = useState(false);
  const [step4MuxSummaryContent, setStep4MuxSummaryContent] = useState("");
  const step4MuxSummaryResolver = useRef<(() => void) | null>(null);
  const [m4bSuccessVisible, setM4bSuccessVisible] = useState(false);
  const [m4bSuccessContent, setM4bSuccessContent] = useState("");
  const m4bSuccessResolver = useRef<(() => void) | null>(null);
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
  const [bookCoverPreview, setBookCoverPreview] =
    useState<BookCoverPreviewState>({ status: "idle" });
  const googleBooksM4bMetaRef = useRef<AudiobookM4bMetadata | null>(null);

  useEffect(() => {
    if (bookCoverPreview.status === "ok") {
      googleBooksM4bMetaRef.current = {
        coverUrl: bookCoverPreview.uri,
        ...(bookCoverPreview.title?.trim()
          ? { title: bookCoverPreview.title.trim() }
          : {}),
        ...(bookCoverPreview.authors?.trim()
          ? { author: bookCoverPreview.authors.trim() }
          : {}),
      };
    } else {
      googleBooksM4bMetaRef.current = null;
    }
  }, [bookCoverPreview]);

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
        const morePart = remaining > 0 ? `\n… and ${remaining} more` : "";
        setStep2SummaryContent(
          `Detected ${chapterCount} chapters.${listPart}${morePart}`,
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

  const askStep3EncodeSummary = useCallback(
    (encodedPath: string): Promise<void> =>
      new Promise(resolve => {
        setStep3EncodeSummaryContent(
          `Step 3 complete.\n\nEncoded M4A (no chapters yet):\n${encodedPath}`,
        );
        setStep3EncodeSummaryVisible(true);
        step3EncodeSummaryResolver.current = resolve;
      }),
    [],
  );

  const resolveStep3EncodeSummary = useCallback(() => {
    const resolver = step3EncodeSummaryResolver.current;
    step3EncodeSummaryResolver.current = null;
    setStep3EncodeSummaryVisible(false);
    setStep3EncodeSummaryContent("");
    resolver?.();
  }, []);

  const askStep4MuxSummary = useCallback(
    (mergedPath: string): Promise<void> =>
      new Promise(resolve => {
        setStep4MuxSummaryContent(
          `Step 4 complete.\n\nMerged file with chapters:\n${mergedPath}`,
        );
        setStep4MuxSummaryVisible(true);
        step4MuxSummaryResolver.current = resolve;
      }),
    [],
  );

  const resolveStep4MuxSummary = useCallback(() => {
    const resolver = step4MuxSummaryResolver.current;
    step4MuxSummaryResolver.current = null;
    setStep4MuxSummaryVisible(false);
    setStep4MuxSummaryContent("");
    resolver?.();
  }, []);

  const showM4bSuccess = useCallback(
    (m4bPath: string): Promise<void> =>
      new Promise(resolve => {
        setM4bSuccessContent(
          `Conversion complete.\n\nAudiobook (M4B):\n${m4bPath}`,
        );
        setM4bSuccessVisible(true);
        m4bSuccessResolver.current = resolve;
      }),
    [],
  );

  const resolveM4bSuccess = useCallback(() => {
    const resolver = m4bSuccessResolver.current;
    m4bSuccessResolver.current = null;
    setM4bSuccessVisible(false);
    setM4bSuccessContent("");
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
  const step4SliderProgress =
    conversionStep === 4 && mergeProgressTotal > 0
      ? Math.max(0, Math.min(1, mergeProgressDone / mergeProgressTotal))
      : null;

  const conversionStepListCircleValue = (step: 1 | 2 | 3 | 4 | 5): number => {
    if (conversionStepsListComplete) {
      return 1;
    }
    if (!isConverting || conversionStep === 0) {
      return 0;
    }
    if (step < conversionStep) {
      return 1;
    }
    if (step > conversionStep) {
      return 0;
    }
    if (step === 2) {
      return step2SliderProgress ?? 0;
    }
    if (step === 3) {
      const p = step3SliderProgress ?? progress;
      return Math.max(0, Math.min(1, p));
    }
    if (step === 4) {
      const p = step4SliderProgress ?? progress;
      return Math.max(0, Math.min(1, p));
    }
    if (step === 5) {
      return Math.max(0, Math.min(1, progress));
    }
    return 0;
  };

  useEffect(() => {
    if (Platform.OS !== "macos") {
      return;
    }
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
        const k = payload?.kind ?? "";
        const isMerge = k === "merge_encode" || k === "merge_chapters";
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

  useEffect(() => {
    if (Platform.OS !== "macos") {
      return;
    }
    const sub = DeviceEventEmitter.addListener("OpenPythonInfoModal", () => {
      setPythonInfoVisible(true);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS !== "macos") {
      return;
    }
    let cancelled = false;
    void runDependencyChecks().then(result => {
      if (!cancelled) {
        setDependencyStatuses(result.statuses);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedDirectory?.trim()) {
      setBookCoverPreview({ status: "idle" });
      return;
    }
    const q = perryRhodanSearchQueryFromPath(selectedDirectory);
    if (!q) {
      setBookCoverPreview({ status: "idle" });
      return;
    }
    const ac = new AbortController();
    setBookCoverPreview({ status: "loading" });
    void fetchGoogleBooksFirstCover(q, { signal: ac.signal })
      .then(result => {
        if (ac.signal.aborted) {
          return;
        }
        if (result) {
          setBookCoverPreview({
            status: "ok",
            uri: result.coverUrl,
            title: result.title,
            authors: result.authors,
          });
        } else {
          setBookCoverPreview({ status: "empty" });
        }
      })
      .catch(() => {
        if (ac.signal.aborted) {
          return;
        }
        setBookCoverPreview({ status: "error" });
      });
    return () => ac.abort();
  }, [selectedDirectory]);

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
          "Not supported",
          "The folder picker is only supported on macOS and Windows.",
        );
      }
    } catch (error) {
      showInfoModal(
        "Error",
        "Could not choose folder: " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  };

  const handleModePress = async () => {
    const picked = await askSelection(
      "Choose mode",
      "Please choose a model size",
      MODE_OPTIONS,
      selectedMode,
    );
    if (picked) {
      setSelectedMode(picked);
    }
  };

  const handleDevicePress = async () => {
    const picked = await askSelection(
      "Choose device",
      "Please choose a compute device",
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
  const depsNeedAttention =
    dependencyStatuses != null && !allDependencyLedsGreen(dependencyStatuses);
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
      missing.push("Folder");
    }
    if (!(selectedMode != null && selectedMode.trim().length > 0)) {
      missing.push("Mode");
    }
    if (!(selectedDevice != null && selectedDevice.trim().length > 0)) {
      missing.push("Device");
    }
    if (missing.length > 0) {
      showInfoModal(
        "Incomplete",
        `Please also choose:\n${missing.map(m => `• ${m}`).join("\n")}`,
      );
      return;
    }

    const deviceLower = selectedDevice!.trim().toLowerCase();
    if (deviceLower === "cuda" && !isCudaDeviceSupportedOnThisPlatform()) {
      const cudaBody =
        Platform.OS === "macos"
          ? "macOS does not support NVIDIA CUDA. Please choose “cpu”."
          : "CUDA is not supported on this platform. Please choose “cpu”.";
      showInfoModal("CUDA unavailable", cudaBody);
      return;
    }

    void (async () => {
      setIsConverting(true);
      setConversionStepsListComplete(false);
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
        if (
          chapterMarks.usedChapterCache &&
          mp3FileTotal != null &&
          mp3FileTotal > 0
        ) {
          setWhisperMp3Done(mp3FileTotal);
        }
        setProgress(1);
        await askStep2Summary(
          chapterMarks.marks.length,
          chapterMarks.marks.map(mark => mark.label),
        );
        setConversionStep(3);
        setMergeProgressDone(0);
        setMergeProgressTotal(0);
        setProgress(0);
        const encodedPath = await createEncodedAudiobookTrack(
          selectedDirectory!.trim(),
        );
        await askStep3EncodeSummary(encodedPath);
        setConversionStep(4);
        setMergeProgressDone(0);
        setMergeProgressTotal(0);
        setProgress(0);
        const mergedPath = await muxChaptersIntoMergedM4a(
          selectedDirectory!.trim(),
          chapterMarks,
        );
        await askStep4MuxSummary(mergedPath);
        setConversionStep(5);
        setProgress(0);
        const metaNow = googleBooksM4bMetaRef.current;
        const hasAnyMeta =
          metaNow &&
          (Boolean(metaNow.coverUrl?.trim()) ||
            Boolean(metaNow.title?.trim()) ||
            Boolean(metaNow.author?.trim()));
        const m4bPath = await createAudiobookFile(
          mergedPath,
          selectedDirectory!.trim(),
          hasAnyMeta ? metaNow : null,
        );
        await showM4bSuccess(m4bPath);
        setConversionStepsListComplete(true);
      } catch (e) {
        setConversionStepsListComplete(false);
        if (isConversionCancelled(e)) {
          return;
        }
        showInfoModal("Error", e instanceof Error ? e.message : String(e));
      } finally {
        setConversionStep(0);
        setMp3FileTotal(null);
        setWhisperMp3Done(0);
        setMergeProgressDone(0);
        setMergeProgressTotal(0);
        setProgress(0);
        setIsConverting(false);
      }
    })();
  };

  return (
    <>
      <View style={styles.mainColumn}>
        <Box padding={{ block: Size.size_32 }}>
          <Label
            title="AudioBookConverter"
            variant={LabelVariant.Header1}
            align={LabelAlign.Center}
          />
        </Box>
        <SettingsGearOverlay
          attention={depsNeedAttention}
          onPress={() => setPythonInfoVisible(true)}
        />
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
                      title="Folder:"
                      variant={LabelVariant.NormalBold}
                      align={LabelAlign.Left}
                    />
                  </View>
                  <InputField
                    wrapperStyle={styles.pathInputWrapper}
                    onPress={handleVerzeichnisPress}
                    value={selectedDirectory}
                    placeholder="AudioBooks"
                    numberOfLines={1}
                    ellipsizeMode="middle"
                  />
                </View>
                <View style={styles.modeRow}>
                  <View style={styles.fieldLabelContainer}>
                    <Label
                      title="Mode:"
                      variant={LabelVariant.NormalBold}
                      align={LabelAlign.Left}
                    />
                  </View>
                  <InputField
                    wrapperStyle={styles.modeInputWrapper}
                    onPress={handleModePress}
                    value={selectedMode}
                    placeholder="base"
                  />
                </View>
                <View style={styles.deviceRow}>
                  <View style={styles.fieldLabelContainer}>
                    <Label
                      title="Device:"
                      variant={LabelVariant.NormalBold}
                      align={LabelAlign.Left}
                    />
                  </View>
                  <InputField
                    wrapperStyle={styles.deviceInputWrapper}
                    onPress={handleDevicePress}
                    value={selectedDevice}
                    placeholder="cpu"
                  />
                </View>
                <View style={styles.startButtonWrapper}>
                  <Button
                    variant={ButtonVariant.Primary}
                    disabled={startLooksInactive}
                    onPress={handleStartPress}>
                    Start
                  </Button>
                </View>
                <View style={styles.conversionStepsListPanel}>
                  <View style={styles.conversionStepsList}>
                    {([1, 2, 3, 4, 5] as const).map(step => (
                      <View key={step} style={styles.conversionStepListRow}>
                        <View style={styles.conversionStepListLabelWrap}>
                          <Label
                            title={`${CONVERSION_STEP_TITLES[step]}:`}
                            variant={LabelVariant.Normal}
                            color={Color.gray700}
                            align={LabelAlign.Left}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          />
                        </View>
                        <View style={styles.conversionStepListProgress}>
                          <Progress
                            size={ProgressSize.Small}
                            color={Color.primary}
                            value={conversionStepListCircleValue(step)}
                          />
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            </View>
          </View>
        </ScrollView>
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
        visible={step3EncodeSummaryVisible}
        content={step3EncodeSummaryContent}
        onContinue={resolveStep3EncodeSummary}
      />
      <EmbedChaptersInM4aModal
        visible={step4MuxSummaryVisible}
        content={step4MuxSummaryContent}
        onContinue={resolveStep4MuxSummary}
      />
      <CreateAudiobookM4bModal
        visible={m4bSuccessVisible}
        content={m4bSuccessContent}
        onClose={resolveM4bSuccess}
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
      <PythonInfoModal
        visible={pythonInfoVisible}
        onClose={() => setPythonInfoVisible(false)}
        onDependencyCheckResult={onDependencyCheckResult}
      />
    </>
  );
}
