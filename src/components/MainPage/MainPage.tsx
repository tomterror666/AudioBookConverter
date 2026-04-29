/**
 * Main conversion UI: form, progress steps, and related modals.
 *
 * @format
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ImageLoadEventData, NativeSyntheticEvent } from "react-native";
import {
  ActivityIndicator,
  DeviceEventEmitter,
  Image,
  NativeModules,
  Platform,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { openFolder } from "react-native-file-panel";
import { Accordion } from "../ui/Accordion";
import { Box } from "../ui/Box";
import { SettingsGearOverlay } from "../SettingsGearOverlay";
import { Progress, ProgressSize } from "../ui/Progress";
import { Button, ButtonVariant } from "../ui/Button";
import { InputField } from "../ui/InputField";
import { Label, LabelAlign, LabelVariant } from "../ui/Label";
import {
  Color,
  COMPUTE_TYPE_OPTIONS,
  DEVICE_OPTIONS,
  MODE_OPTIONS,
  Size,
} from "../../constants";
import { UiLocaleProvider, useUiCopy } from "../../UiLocaleContext";
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
import { fetchGoogleBooksCoverForFolderPath } from "../../utils/googleBooksCover";
import {
  ConversionCancelledError,
  countMp3Files,
  createAudiobookFile,
  createEncodedAudiobookTrack,
  isConversionCancelled,
  locateChapters,
  muxChaptersIntoMergedM4a,
  type AudiobookM4bMetadata,
  type ChapterCue,
} from "../../utils/conversionPipeline";
import { styles } from "./MainPage.styles";

function pathBasenameForDisplay(p: string): string {
  const t = p.trim();
  if (!t) {
    return "";
  }
  const parts = t.split(/[/\\]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : t;
}

type DependencyStatusNativeModule = {
  selectDirectory?: () => Promise<string | null>;
  /** macOS: multi-select folder panel → ordered paths */
  selectDirectories?: () => Promise<string[] | null | undefined>;
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
  /** Cover fetch failed; folder thumbnail shows a red question mark. */
  | { status: "error" };

/** Placeholder width when cover intrinsic size is unknown (typical book cover ratio). */
const FOLDER_COVER_DEFAULT_ASPECT = 2 / 3;

type MoreSettingsAccordionLine = {
  key: string;
  title: React.ReactElement<typeof Label>;
  input: () => React.ReactNode;
};

function MainPageInner(props: {
  chapterCue: ChapterCue;
  setChapterCue: React.Dispatch<React.SetStateAction<ChapterCue>>;
}): React.JSX.Element {
  const { chapterCue, setChapterCue } = props;
  const [progress, setProgress] = useState(0);
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [selectedMode, setSelectedMode] = useState<string | null>("tiny");
  const [selectedDevice, setSelectedDevice] = useState<string | null>("cpu");
  const [selectedComputeType, setSelectedComputeType] = useState<string | null>(
    "float32",
  );
  const [isConverting, setIsConverting] = useState(false);
  const [conversionStep, setConversionStep] = useState(0);
  const [mp3FileTotal, setMp3FileTotal] = useState<number | null>(null);
  const [whisperMp3Done, setWhisperMp3Done] = useState(0);
  /** Step 2: HF model download vs per-MP3 Whisper scan (spinner vs progress ring). */
  const [whisperModelPhase, setWhisperModelPhase] = useState<
    "download" | "scan"
  >("scan");
  /** Whisper: write per-MP3 transcript `.listen.txt` files under AudiobookConverter_listen_logs. */
  const [writeListenLogs, setWriteListenLogs] = useState(false);
  /**
   * When true, conversion shows MP3 count, per-step summary, and success modals.
   * When false (default), the pipeline runs straight through (use ScrollView if content overflows).
   */
  const [confirmEachConversionStep, setConfirmEachConversionStep] =
    useState(false);
  const confirmEachConversionStepRef = useRef(false);
  /** Collapse: Mode / Device / Quantization / Language / Listen log */
  const [moreSettingsExpanded, setMoreSettingsExpanded] = useState(false);
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
  /** macOS batch: shown above step list when converting more than one folder */
  const [batchQueueProgress, setBatchQueueProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const googleBooksM4bMetaRef = useRef<AudiobookM4bMetadata | null>(null);
  const [folderInputRowHeight, setFolderInputRowHeight] = useState(44);
  const [coverIntrinsicSize, setCoverIntrinsicSize] = useState<{
    w: number;
    h: number;
  } | null>(null);

  const u = useUiCopy();

  const folderListTrimmed = useMemo(
    () => selectedFolders.map(f => f.trim()).filter(f => f.length > 0),
    [selectedFolders],
  );

  const folderFieldValue = useMemo(() => {
    if (folderListTrimmed.length === 0) {
      return null;
    }
    if (folderListTrimmed.length === 1) {
      return folderListTrimmed[0]!;
    }
    const base = pathBasenameForDisplay(folderListTrimmed[0]!);
    return `${base}${u.folderMultiHint(folderListTrimmed.length - 1)}`;
  }, [folderListTrimmed, u]);

  useEffect(() => {
    confirmEachConversionStepRef.current = confirmEachConversionStep;
  }, [confirmEachConversionStep]);

  const coverUriForFolder =
    bookCoverPreview.status === "ok" ? bookCoverPreview.uri : null;

  useEffect(() => {
    setCoverIntrinsicSize(null);
  }, [coverUriForFolder]);

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
    (count: number): Promise<boolean> => {
      if (!confirmEachConversionStepRef.current) {
        return Promise.resolve(true);
      }
      return new Promise(resolve => {
        setPendingMp3Count(count);
        setMp3ConfirmVisible(true);
        mp3ConfirmResolver.current = resolve;
      });
    },
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
    (chapterCount: number, chapterLabels: string[]): Promise<void> => {
      if (!confirmEachConversionStepRef.current) {
        return Promise.resolve();
      }
      return new Promise(resolve => {
        const shown = chapterLabels.slice(0, 12);
        const remaining = Math.max(0, chapterLabels.length - shown.length);
        const listPart =
          shown.length > 0 ? `\n\n${shown.map(l => `• ${l}`).join("\n")}` : "";
        setStep2SummaryContent(
          u.step2Summary({
            chapterCount,
            labelsPreview: listPart,
            moreCount: remaining,
          }),
        );
        setStep2SummaryVisible(true);
        step2SummaryResolver.current = resolve;
      });
    },
    [u],
  );

  const resolveStep2Summary = useCallback(() => {
    const resolver = step2SummaryResolver.current;
    step2SummaryResolver.current = null;
    setStep2SummaryVisible(false);
    setStep2SummaryContent("");
    resolver?.();
  }, []);

  const askStep3EncodeSummary = useCallback(
    (encodedPath: string): Promise<void> => {
      if (!confirmEachConversionStepRef.current) {
        return Promise.resolve();
      }
      return new Promise(resolve => {
        setStep3EncodeSummaryContent(u.step3Summary(encodedPath));
        setStep3EncodeSummaryVisible(true);
        step3EncodeSummaryResolver.current = resolve;
      });
    },
    [u],
  );

  const resolveStep3EncodeSummary = useCallback(() => {
    const resolver = step3EncodeSummaryResolver.current;
    step3EncodeSummaryResolver.current = null;
    setStep3EncodeSummaryVisible(false);
    setStep3EncodeSummaryContent("");
    resolver?.();
  }, []);

  const askStep4MuxSummary = useCallback(
    (mergedPath: string): Promise<void> => {
      if (!confirmEachConversionStepRef.current) {
        return Promise.resolve();
      }
      return new Promise(resolve => {
        setStep4MuxSummaryContent(u.step4Summary(mergedPath));
        setStep4MuxSummaryVisible(true);
        step4MuxSummaryResolver.current = resolve;
      });
    },
    [u],
  );

  const resolveStep4MuxSummary = useCallback(() => {
    const resolver = step4MuxSummaryResolver.current;
    step4MuxSummaryResolver.current = null;
    setStep4MuxSummaryVisible(false);
    setStep4MuxSummaryContent("");
    resolver?.();
  }, []);

  const showM4bSuccess = useCallback(
    (m4bPath: string): Promise<void> => {
      if (!confirmEachConversionStepRef.current) {
        return Promise.resolve();
      }
      return new Promise(resolve => {
        setM4bSuccessContent(u.m4bSuccess(m4bPath));
        setM4bSuccessVisible(true);
        m4bSuccessResolver.current = resolve;
      });
    },
    [u],
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
        modelPhase?: string;
        current?: number;
        total?: number;
        kind?: string;
        chapterCurrent?: number;
        chapterTotal?: number;
        chapterMode?: string;
      }) => {
        const phase = payload?.modelPhase;
        if (phase === "download") {
          setWhisperModelPhase("download");
          return;
        }
        if (phase === "ready") {
          setWhisperModelPhase("scan");
          return;
        }
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
    if (isConverting) {
      return;
    }
    const path = folderListTrimmed[0];
    if (!path?.trim()) {
      setBookCoverPreview({ status: "idle" });
      return;
    }
    const ac = new AbortController();
    setBookCoverPreview({ status: "loading" });
    void fetchGoogleBooksCoverForFolderPath(path, {
      signal: ac.signal,
    })
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
  }, [folderListTrimmed, isConverting]);

  const refreshCoverForConversionJob = useCallback(async (root: string) => {
    setBookCoverPreview({ status: "loading" });
    try {
      const result = await fetchGoogleBooksCoverForFolderPath(root);
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
    } catch {
      setBookCoverPreview({ status: "error" });
    }
  }, []);

  const handleVerzeichnisPress = async () => {
    try {
      if (Platform.OS === "macos") {
        const mod = NativeModules.DependencyStatus as
          | DependencyStatusNativeModule
          | undefined;
        if (typeof mod?.selectDirectories === "function") {
          const paths = await mod.selectDirectories();
          if (paths != null && Array.isArray(paths) && paths.length > 0) {
            const cleaned = paths.filter(
              (p): p is string =>
                typeof p === "string" && p.trim().length > 0,
            );
            if (cleaned.length > 0) {
              setSelectedFolders(cleaned);
            }
          }
        } else if (typeof mod?.selectDirectory === "function") {
          const path = await mod.selectDirectory();
          if (path && typeof path === "string" && path.trim().length > 0) {
            setSelectedFolders([path.trim()]);
          }
        }
      } else if (Platform.OS === "windows") {
        const path = await openFolder();
        if (path && path.trim().length > 0) {
          setSelectedFolders([path.trim()]);
        }
      } else {
        showInfoModal(
          u.errors.notSupported.headline,
          u.errors.notSupported.body,
        );
      }
    } catch (error) {
      showInfoModal(
        u.errors.errorHeadline,
        u.errors.couldNotChooseFolder(
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  };

  const handleModePress = async () => {
    const picked = await askSelection(
      u.selection.chooseMode.headline,
      u.selection.chooseMode.content,
      MODE_OPTIONS,
      selectedMode,
    );
    if (picked) {
      setSelectedMode(picked);
    }
  };

  const handleDevicePress = async () => {
    const picked = await askSelection(
      u.selection.chooseDevice.headline,
      u.selection.chooseDevice.content,
      DEVICE_OPTIONS,
      selectedDevice,
    );
    if (picked) {
      setSelectedDevice(picked);
    }
  };

  const handleComputeTypePress = async () => {
    const picked = await askSelection(
      u.selection.chooseComputeType.headline,
      u.selection.chooseComputeType.content,
      COMPUTE_TYPE_OPTIONS,
      selectedComputeType,
    );
    if (picked) {
      setSelectedComputeType(picked);
    }
  };

  const moreSettingsLines = useMemo<MoreSettingsAccordionLine[]>(
    () => [
      {
        key: "mode",
        title: (
          <Label
            title="Mode:"
            variant={LabelVariant.NormalBold}
            align={LabelAlign.Left}
          />
        ),
        input: () => (
          <InputField
            wrapperStyle={styles.modeInputWrapper}
            onPress={handleModePress}
            value={selectedMode}
            placeholder="tiny"
          />
        ),
      },
      {
        key: "device",
        title: (
          <Label
            title="Device:"
            variant={LabelVariant.NormalBold}
            align={LabelAlign.Left}
          />
        ),
        input: () => (
          <InputField
            wrapperStyle={styles.deviceInputWrapper}
            onPress={handleDevicePress}
            value={selectedDevice}
            placeholder="cpu"
          />
        ),
      },
      {
        key: "computeType",
        title: (
          <Label
            title={u.labelComputeType}
            variant={LabelVariant.NormalBold}
            align={LabelAlign.Left}
          />
        ),
        input: () => (
          <InputField
            wrapperStyle={styles.computeTypeInputWrapper}
            onPress={handleComputeTypePress}
            value={selectedComputeType}
            placeholder="float32"
          />
        ),
      },
      {
        key: "chapterCue",
        title: (
          <Label
            title={u.labelChapterCue}
            variant={LabelVariant.NormalBold}
            align={LabelAlign.Left}
          />
        ),
        input: () => (
          <View style={styles.chapterCueInputWrapper}>
            <View style={styles.chapterCueBox}>
              <View style={styles.chapterCueControls}>
                <Label
                  title="German"
                  variant={LabelVariant.Normal}
                  color={
                    chapterCue === "de" ? Color.gray900 : Color.gray500
                  }
                  align={LabelAlign.Left}
                />
                <Switch
                  value={chapterCue === "en"}
                  onValueChange={v => setChapterCue(v ? "en" : "de")}
                  trackColor={{
                    false: Color.gray300,
                    true: Color.primary,
                  }}
                />
                <Label
                  title="English"
                  variant={LabelVariant.Normal}
                  color={
                    chapterCue === "en" ? Color.gray900 : Color.gray500
                  }
                  align={LabelAlign.Left}
                />
              </View>
            </View>
          </View>
        ),
      },
      {
        key: "listenLog",
        title: (
          <Label
            title={u.labelListenLog}
            variant={LabelVariant.NormalBold}
            align={LabelAlign.Left}
          />
        ),
        input: () => (
          <View style={styles.chapterCueInputWrapper}>
            <View style={styles.chapterCueBox}>
              <View style={styles.chapterCueControls}>
                <Label
                  title={chapterCue === "de" ? "Aus" : "Off"}
                  variant={LabelVariant.Normal}
                  color={
                    !writeListenLogs ? Color.gray900 : Color.gray500
                  }
                  align={LabelAlign.Left}
                />
                <Switch
                  value={writeListenLogs}
                  onValueChange={setWriteListenLogs}
                  trackColor={{
                    false: Color.gray300,
                    true: Color.primary,
                  }}
                />
                <Label
                  title={chapterCue === "de" ? "Ein" : "On"}
                  variant={LabelVariant.Normal}
                  color={
                    writeListenLogs ? Color.gray900 : Color.gray500
                  }
                  align={LabelAlign.Left}
                />
              </View>
            </View>
          </View>
        ),
      },
      {
        key: "confirmEachStep",
        title: (
          <Label
            title={u.labelConfirmEachStep}
            variant={LabelVariant.NormalBold}
            align={LabelAlign.Left}
          />
        ),
        input: () => (
          <View style={styles.chapterCueInputWrapper}>
            <View style={styles.chapterCueBox}>
              <View style={styles.chapterCueControls}>
                <Label
                  title={chapterCue === "de" ? "Aus" : "Off"}
                  variant={LabelVariant.Normal}
                  color={
                    !confirmEachConversionStep
                      ? Color.gray900
                      : Color.gray500
                  }
                  align={LabelAlign.Left}
                />
                <Switch
                  testID="confirmEachConversionStepSwitch"
                  value={confirmEachConversionStep}
                  onValueChange={setConfirmEachConversionStep}
                  trackColor={{
                    false: Color.gray300,
                    true: Color.primary,
                  }}
                />
                <Label
                  title={chapterCue === "de" ? "Ein" : "On"}
                  variant={LabelVariant.Normal}
                  color={
                    confirmEachConversionStep
                      ? Color.gray900
                      : Color.gray500
                  }
                  align={LabelAlign.Left}
                />
              </View>
            </View>
          </View>
        ),
      },
    ],
    [
      chapterCue,
      confirmEachConversionStep,
      handleComputeTypePress,
      handleDevicePress,
      handleModePress,
      selectedComputeType,
      selectedDevice,
      selectedMode,
      setChapterCue,
      u.labelChapterCue,
      u.labelComputeType,
      u.labelConfirmEachStep,
      u.labelListenLog,
      writeListenLogs,
    ],
  );

  const formComplete =
    folderListTrimmed.length > 0 &&
    selectedMode != null &&
    selectedMode.trim().length > 0 &&
    selectedDevice != null &&
    selectedDevice.trim().length > 0 &&
    selectedComputeType != null &&
    selectedComputeType.trim().length > 0;

  const depsOkForStart =
    Platform.OS !== "macos" || allDependencyLedsGreen(dependencyStatuses);
  const depsNeedAttention =
    dependencyStatuses != null && !allDependencyLedsGreen(dependencyStatuses);
  const startLooksInactive = !formComplete || isConverting || !depsOkForStart;

  const folderCoverAspect =
    coverIntrinsicSize != null &&
    coverIntrinsicSize.h > 0 &&
    coverIntrinsicSize.w > 0
      ? coverIntrinsicSize.w / coverIntrinsicSize.h
      : FOLDER_COVER_DEFAULT_ASPECT;
  const folderCoverWidth = folderInputRowHeight * folderCoverAspect;

  const onFolderCoverLoad = useCallback(
    (e: NativeSyntheticEvent<ImageLoadEventData>) => {
    const s = e.nativeEvent.source;
    const w = typeof s.width === "number" ? s.width : 0;
    const h = typeof s.height === "number" ? s.height : 0;
      if (w > 0 && h > 0) {
        setCoverIntrinsicSize({ w, h });
      }
    },
    [],
  );

  const handleStartPress = () => {
    if (isConverting) {
      return;
    }
    if (!depsOkForStart) {
      return;
    }
    const missing: string[] = [];
    if (folderListTrimmed.length === 0) {
      missing.push(u.missingFieldToken.folder);
    }
    if (!(selectedMode != null && selectedMode.trim().length > 0)) {
      missing.push(u.missingFieldToken.mode);
    }
    if (!(selectedDevice != null && selectedDevice.trim().length > 0)) {
      missing.push(u.missingFieldToken.device);
    }
    if (
      !(selectedComputeType != null && selectedComputeType.trim().length > 0)
    ) {
      missing.push(u.missingFieldToken.computeType);
    }
    if (missing.length > 0) {
      showInfoModal(
        u.errors.incomplete.headline,
        u.errors.incomplete.body(
          missing.map(m => `• ${m}`).join("\n"),
        ),
      );
      return;
    }

    const deviceLower = selectedDevice!.trim().toLowerCase();
    if (deviceLower === "cuda" && !isCudaDeviceSupportedOnThisPlatform()) {
      const cudaBody =
        Platform.OS === "macos"
          ? u.errors.cudaUnavailable.mac
          : u.errors.cudaUnavailable.other;
      showInfoModal(u.errors.cudaUnavailable.headline, cudaBody);
      return;
    }

    void (async () => {
      const folders = folderListTrimmed.slice();
      setIsConverting(true);
      setConversionStepsListComplete(false);
      setBatchQueueProgress(null);
      try {
        for (let i = 0; i < folders.length; i++) {
          const root = folders[i]!;
          if (i > 0) {
            setConversionStepsListComplete(false);
          }
          if (folders.length > 1) {
            setBatchQueueProgress({
              current: i + 1,
              total: folders.length,
            });
          }
          await refreshCoverForConversionJob(root);

          setConversionStep(1);
          const mp3Count = await countMp3Files(root);
          const confirmed = await askMp3CountConfirmation(mp3Count);
          if (!confirmed) {
            throw new ConversionCancelledError();
          }
          setMp3FileTotal(mp3Count);
          setConversionStep(2);
          setWhisperMp3Done(0);
          setWhisperModelPhase("scan");
          setProgress(0);
          const chapterMarks = await locateChapters({
            rootDirectory: root,
            modelSize: selectedMode!.trim(),
            device: selectedDevice!.trim().toLowerCase(),
            computeType: selectedComputeType!.trim().toLowerCase(),
            chapterCue,
            writeListenLogs,
          });
          if (chapterMarks.usedChapterCache && mp3Count > 0) {
            setWhisperMp3Done(mp3Count);
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
          const encodedPath = await createEncodedAudiobookTrack(root);
          await askStep3EncodeSummary(encodedPath);
          setConversionStep(4);
          setMergeProgressDone(0);
          setMergeProgressTotal(0);
          setProgress(0);
          const mergedPath = await muxChaptersIntoMergedM4a(
            root,
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
            root,
            hasAnyMeta ? metaNow : null,
          );
          await showM4bSuccess(m4bPath);
          setConversionStepsListComplete(true);
        }
      } catch (e) {
        setConversionStepsListComplete(false);
        if (isConversionCancelled(e)) {
          return;
        }
        showInfoModal(
          u.errors.errorHeadline,
          e instanceof Error ? e.message : String(e),
        );
      } finally {
        setConversionStep(0);
        setMp3FileTotal(null);
        setWhisperMp3Done(0);
        setWhisperModelPhase("scan");
        setMergeProgressDone(0);
        setMergeProgressTotal(0);
        setProgress(0);
        setBatchQueueProgress(null);
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
                  <View style={styles.folderInputRow}>
                    <View
                      style={styles.pathInputFlex}
                      onLayout={e => {
                        const h = e.nativeEvent.layout.height;
                        if (h > 0) {
                          setFolderInputRowHeight(h);
                        }
                      }}>
                      <InputField
                        wrapperStyle={styles.pathInputFieldWrapper}
                        onPress={handleVerzeichnisPress}
                        value={folderFieldValue}
                        placeholder="AudioBooks"
                        numberOfLines={1}
                        ellipsizeMode="middle"
                      />
                    </View>
                    <View
                      style={[
                        styles.folderCoverChrome,
                        {
                          width: folderCoverWidth,
                          height: folderInputRowHeight,
                        },
                      ]}>
                      {coverUriForFolder ? (
                        <Image
                          source={{ uri: coverUriForFolder }}
                          style={styles.folderCoverImage}
                          resizeMode="contain"
                          onLoad={onFolderCoverLoad}
                        />
                      ) : bookCoverPreview.status === "error" ? (
                        <View style={styles.folderCoverErrorInner}>
                          <Text
                            style={styles.folderCoverErrorGlyph}
                            accessibilityLabel={u.coverAccessibilityFailed}>
                            ?
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.folderCoverPlaceholder} />
                      )}
                    </View>
                  </View>
                </View>
                <Accordion
                  expanded={moreSettingsExpanded}
                  onExpandedChange={setMoreSettingsExpanded}
                  style={styles.moreSettingsAccordionRoot}
                  title={
                    <Label
                      title={u.labelMoreSettings}
                      variant={LabelVariant.NormalBold}
                      align={LabelAlign.Left}
                      numberOfLines={1}
                    />
                  }>
                  {moreSettingsLines.map(line => (
                    <View
                      key={line.key}
                      style={[styles.modeRow, styles.settingsRowInAccordion]}>
                      <View style={styles.fieldLabelContainer}>
                        {line.title}
                      </View>
                      {line.input()}
                    </View>
                  ))}
                </Accordion>
                <View style={styles.startButtonWrapper}>
                  <Button
                    variant={ButtonVariant.Primary}
                    disabled={startLooksInactive}
                    onPress={handleStartPress}>
                    {u.startButton}
                  </Button>
                </View>
                <View style={styles.conversionStepsListPanel}>
                  {batchQueueProgress != null &&
                  batchQueueProgress.total > 1 &&
                  isConverting ? (
                    <View style={styles.batchQueueProgressLabel}>
                      <Label
                        title={u.batchFolderProgress(
                          batchQueueProgress.current,
                          batchQueueProgress.total,
                        )}
                        variant={LabelVariant.NormalBold}
                        color={Color.gray800}
                        align={LabelAlign.Left}
                        numberOfLines={1}
                      />
                    </View>
                  ) : null}
                  <View style={styles.conversionStepsList}>
                    {([1, 2, 3, 4, 5] as const).map(step => (
                      <View key={step} style={styles.conversionStepListRow}>
                        <View style={styles.conversionStepListLabelWrap}>
                          <Label
                            title={`${u.conversionStepTitles[step]}:`}
                            variant={LabelVariant.Normal}
                            color={Color.gray700}
                            align={LabelAlign.Left}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          />
                        </View>
                        <View style={styles.conversionStepListProgress}>
                          {step === 2 &&
                          conversionStep === 2 &&
                          whisperModelPhase === "download" ? (
                            <ActivityIndicator
                              color={Color.primary}
                              style={styles.step2DownloadSpinner}
                            />
                          ) : (
                            <Progress
                              size={ProgressSize.Small}
                              color={Color.primary}
                              value={conversionStepListCircleValue(step)}
                            />
                          )}
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
        headline={u.step2ModalHeadline}
        content={step2SummaryContent}
        onContinue={resolveStep2Summary}
      />
      <EmbedChaptersInM4aModal
        visible={step3EncodeSummaryVisible}
        headline={u.step3ModalHeadline}
        content={step3EncodeSummaryContent}
        onContinue={resolveStep3EncodeSummary}
      />
      <EmbedChaptersInM4aModal
        visible={step4MuxSummaryVisible}
        headline={u.step4ModalHeadline}
        content={step4MuxSummaryContent}
        onContinue={resolveStep4MuxSummary}
      />
      <CreateAudiobookM4bModal
        visible={m4bSuccessVisible}
        headline={u.m4bSuccessModalHeadline}
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

export function MainPage(): React.JSX.Element {
  const [chapterCue, setChapterCue] = useState<ChapterCue>("de");
  return (
    <UiLocaleProvider value={chapterCue}>
      <MainPageInner chapterCue={chapterCue} setChapterCue={setChapterCue} />
    </UiLocaleProvider>
  );
}
