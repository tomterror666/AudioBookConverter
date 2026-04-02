/**
 * AudioBookConverter App
 *
 * @format
 */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Alert,
  DeviceEventEmitter,
  GestureResponderEvent,
  LayoutChangeEvent,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {openFolder} from 'react-native-file-panel';
import {DependencyStatusPanel} from './src/components/DependencyStatusPanel';
import {
  allDependencyLedsGreen,
  type DependencyCheckResult,
  type DependencyStatuses,
} from './src/dependencyStatus';
import {isCudaDeviceSupportedOnThisPlatform} from './src/deviceCudaSupport';
import {
  countMp3Files,
  createAudiobookFile,
  createMp4WithChapterMarkers,
  isConversionCancelled,
  locateChapters,
} from './src/conversionPipeline';

const TRACK_HEIGHT = 6;
const THUMB_SIZE = 24;
const CONTENT_ROW_PADDING = 24;
const FORM_EDGE_MARGIN = 32;
const SLIDER_HORIZONTAL_INSET = CONTENT_ROW_PADDING + FORM_EDGE_MARGIN;
const MODE_OPTIONS = ['tiny', 'base', 'small', 'medium', 'large'] as const;
const DEVICE_OPTIONS = ['cpu', 'cuda'] as const;

const CONVERSION_STEP_TITLES: Record<number, string> = {
  1: 'MP3-Dateien zählen',
  2: 'Kapitelpositionen ermitteln',
  3: 'Kapitel in die M4A einbetten',
  4: 'Audiobook (M4B) erstellen',
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
  const [mergeChapterMode, setMergeChapterMode] = useState<'marks' | 'mp3' | null>(
    null,
  );
  const [dependencyStatuses, setDependencyStatuses] =
    useState<DependencyStatuses | null>(null);
  const trackLayout = useRef({width: 300});

  const onDependencyCheckResult = useCallback((result: DependencyCheckResult) => {
    setDependencyStatuses(result.statuses);
  }, []);

  const step2SliderProgress =
    conversionStep === 2 &&
    mp3FileTotal != null &&
    mp3FileTotal > 0
      ? Math.max(0, Math.min(1, whisperMp3Done / mp3FileTotal))
      : null;
  const step3SliderProgress =
    conversionStep === 3 && mergeProgressTotal > 0
      ? Math.max(
          0,
          Math.min(1, mergeProgressDone / mergeProgressTotal),
        )
      : null;
  const displayProgress =
    step2SliderProgress != null
      ? step2SliderProgress
      : step3SliderProgress != null
        ? step3SliderProgress
        : progress;

  useEffect(() => {
    if (Platform.OS !== 'macos') {
      return;
    }
    // Native ruft RCTDeviceEventEmitter.emit auf (siehe DependencyStatus.mm).
    const sub = DeviceEventEmitter.addListener(
      'WhisperScanProgress',
      (payload: {
        current?: number;
        total?: number;
        kind?: string;
        chapterCurrent?: number;
        chapterTotal?: number;
        chapterMode?: string;
      }) => {
        const isMerge = payload?.kind === 'merge';
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
            if (md === 'marks' || md === 'mp3') {
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
    const {width} = e.nativeEvent.layout;
    if (width > 0) {
      trackLayout.current = {width};
      setTrackWidth(width);
    }
  };

  const handlePress = (e: GestureResponderEvent) => {
    if (isConverting && (conversionStep === 2 || conversionStep === 3)) {
      return;
    }
    const {locationX} = e.nativeEvent;
    const {width} = trackLayout.current;
    if (width > 0) {
      const newValue = Math.max(0, Math.min(1, locationX / width));
      setProgress(newValue);
    }
  };

  const handleVerzeichnisPress = async () => {
    try {
      if (Platform.OS === 'macos' || Platform.OS === 'windows') {
        const path = await openFolder();
        if (path) {
          setSelectedDirectory(path);
        }
      } else {
        Alert.alert(
          'Nicht unterstützt',
          'Der Verzeichnis-Dialog wird nur auf macOS und Windows unterstützt.',
        );
      }
    } catch (error) {
      Alert.alert(
        'Fehler',
        'Verzeichnis konnte nicht ausgewählt werden: ' +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  };

  const handleModePress = () => {
    Alert.alert(
      'Mode wählen',
      'Bitte wählen Sie einen Modus',
      MODE_OPTIONS.map(mode => ({
        text: mode,
        onPress: () => setSelectedMode(mode),
      })),
    );
  };

  const handleDevicePress = () => {
    Alert.alert(
      'Device wählen',
      'Bitte wählen Sie ein Gerät',
      DEVICE_OPTIONS.map(device => ({
        text: device,
        onPress: () => setSelectedDevice(device),
      })),
    );
  };

  const formComplete =
    typeof selectedDirectory === 'string' &&
    selectedDirectory.trim().length > 0 &&
    selectedMode != null &&
    selectedMode.trim().length > 0 &&
    selectedDevice != null &&
    selectedDevice.trim().length > 0;

  const depsOkForStart =
    Platform.OS !== 'macos' || allDependencyLedsGreen(dependencyStatuses);
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
        typeof selectedDirectory === 'string' &&
        selectedDirectory.trim().length > 0
      )
    ) {
      missing.push('Verzeichnis');
    }
    if (!(selectedMode != null && selectedMode.trim().length > 0)) {
      missing.push('Mode');
    }
    if (!(selectedDevice != null && selectedDevice.trim().length > 0)) {
      missing.push('Device');
    }
    if (missing.length > 0) {
      Alert.alert(
        'Angaben unvollständig',
        `Bitte wählen Sie noch:\n${missing.map(m => `• ${m}`).join('\n')}`,
        [{text: 'OK'}],
      );
      return;
    }

    const deviceLower = selectedDevice!.trim().toLowerCase();
    if (
      deviceLower === 'cuda' &&
      !isCudaDeviceSupportedOnThisPlatform()
    ) {
      const cudaBody =
        Platform.OS === 'macos'
          ? 'Auf macOS steht kein CUDA-Gerät (NVIDIA) zur Verfügung. Bitte wählen Sie „cpu“.'
          : 'CUDA wird auf dieser Plattform nicht unterstützt. Bitte wählen Sie „cpu“.';
      Alert.alert('CUDA nicht verfügbar', cudaBody, [{text: 'OK'}]);
      return;
    }

    void (async () => {
      setIsConverting(true);
      try {
        setConversionStep(1);
        const mp3Count = await countMp3Files(selectedDirectory!.trim());
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
        setConversionStep(4);
        const m4bPath = await createAudiobookFile(
          mergedPath,
          selectedDirectory!.trim(),
        );
        Alert.alert(
          'Erfolg',
          `Die Konvertierung ist abgeschlossen.\n\nAudiobook (M4B):\n${m4bPath}`,
          [{text: 'OK'}],
        );
      } catch (e) {
        if (isConversionCancelled(e)) {
          return;
        }
        Alert.alert('Fehler', e instanceof Error ? e.message : String(e), [
          {text: 'OK'},
        ]);
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
        <Text style={styles.title}>AudioBookConverter</Text>
        <ScrollView
          style={styles.mainScroll}
          contentContainerStyle={styles.mainScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator>
          <View style={styles.contentRow}>
            <View style={styles.formColumn}>
              <View style={styles.buttonContainer}>
                <View style={styles.verzeichnisRow}>
                  <Pressable
                    style={styles.button}
                    onPress={handleVerzeichnisPress}>
                    <Text style={styles.buttonText}>Verzeichnis</Text>
                  </Pressable>
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
                        {selectedDirectory ?? 'AudioBooks'}
                      </Text>
                    </View>
                  </Pressable>
                </View>
                <View style={styles.modeRow}>
                  <Pressable
                    style={[styles.button, styles.buttonMode]}
                    onPress={handleModePress}>
                    <Text style={styles.buttonText}>Mode</Text>
                  </Pressable>
                  <Pressable
                    style={styles.modeInputWrapper}
                    onPress={handleModePress}>
                    <View style={styles.pathInput}>
                      <Text
                        style={[
                          styles.pathInputText,
                          !selectedMode && styles.pathInputPlaceholder,
                        ]}>
                        {selectedMode ?? 'base'}
                      </Text>
                    </View>
                  </Pressable>
                </View>
                <View style={styles.deviceRow}>
                  <Pressable
                    style={[styles.button, styles.buttonDevice]}
                    onPress={handleDevicePress}>
                    <Text style={styles.buttonText}>Device</Text>
                  </Pressable>
                  <Pressable
                    style={styles.deviceInputWrapper}
                    onPress={handleDevicePress}>
                    <View style={styles.pathInput}>
                      <Text
                        style={[
                          styles.pathInputText,
                          !selectedDevice && styles.pathInputPlaceholder,
                        ]}>
                        {selectedDevice ?? 'cpu'}
                      </Text>
                    </View>
                  </Pressable>
                </View>
                <Pressable
                  style={[
                    styles.button,
                    styles.buttonStart,
                    startLooksInactive && styles.buttonStartDisabled,
                  ]}
                  disabled={startLooksInactive}
                  onPress={handleStartPress}>
                  <Text
                    style={[
                      styles.buttonText,
                      startLooksInactive && styles.buttonStartTextDisabled,
                    ]}>
                    Start
                  </Text>
                </Pressable>
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
              Schritt {conversionStep}/4:{' '}
              {CONVERSION_STEP_TITLES[conversionStep] ?? '—'}
              {conversionStep === 2 &&
              mp3FileTotal != null &&
              mp3FileTotal >= 0 ? (
                <Text style={styles.progressStepMp3}>
                  {' '}
                  ({whisperMp3Done} von {mp3FileTotal})
                </Text>
              ) : null}
              {conversionStep === 3 && mergeProgressTotal > 0 ? (
                <Text style={styles.progressStepMp3}>
                  {' '}
                  (
                  {mergeChapterTotal > 0 && mergeChapterCurrent > 0 ? (
                    <>
                      {mergeChapterMode === 'mp3'
                        ? `Datei ${mergeChapterCurrent}/${mergeChapterTotal}`
                        : `Kapitel ${mergeChapterCurrent}/${mergeChapterTotal}`}
                      {' · '}
                    </>
                  ) : null}
                  {Math.min(
                    100,
                    Math.round((100 * mergeProgressDone) / mergeProgressTotal),
                  )}
                  % fertig
                  {mp3FileTotal != null && mp3FileTotal > 0
                    ? ` · ${mp3FileTotal} MP3-Dateien`
                    : ''}
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
              style={[styles.sliderFill, {width: displayProgress * trackWidth}]}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  mainColumn: {
    flex: 1,
    flexDirection: 'column',
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
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 24,
    paddingHorizontal: CONTENT_ROW_PADDING,
  },
  formColumn: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'flex-start',
  },
  statusAside: {
    flexShrink: 0,
    marginLeft: FORM_EDGE_MARGIN,
    marginRight: FORM_EDGE_MARGIN,
    minWidth: 0,
    maxWidth: 920,
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  title: {
    fontSize: 32,
    fontWeight: '600',
    color: '#000000',
    alignSelf: 'center',
    marginTop: 20,
  },
  buttonContainer: {
    marginLeft: FORM_EDGE_MARGIN,
    marginTop: 0,
    alignSelf: 'flex-start',
  },
  verzeichnisRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 32,
  },
  modeInputWrapper: {
    marginLeft: 64,
    flex: 1,
    maxWidth: 600,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
    borderColor: '#CCCCCC',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    minWidth: 300,
  },
  pathInputText: {
    fontSize: 14,
    color: '#000000',
  },
  pathInputPlaceholder: {
    color: '#999999',
  },
  button: {
    width: 130,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: '#007AFF',
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonMode: {},
  buttonDevice: {},
  buttonStart: {
    marginTop: 64,
    backgroundColor: '#34C759',
  },
  buttonStartDisabled: {
    backgroundColor: '#8E8E93',
  },
  buttonStartTextDisabled: {
    color: '#F2F2F7',
  },
  buttonText: {
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '500',
    textAlign: 'center',
  },
  sliderContainer: {
    alignSelf: 'stretch',
    marginHorizontal: SLIDER_HORIZONTAL_INSET,
    marginBottom: 32,
  },
  progressStepLabel: {
    alignSelf: 'stretch',
    marginBottom: 10,
    fontSize: 20,
    fontWeight: '500',
    color: '#333333',
    textAlign: 'left',
  },
  progressStepMp3: {
    fontSize: 20,
    fontWeight: '400',
    color: '#666666',
  },
  sliderTrack: {
    height: THUMB_SIZE,
    justifyContent: 'center',
    alignSelf: 'stretch',
    width: '100%',
    minWidth: 200,
  },
  sliderTrackBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: (THUMB_SIZE - TRACK_HEIGHT) / 2,
    height: TRACK_HEIGHT,
    backgroundColor: '#E0E0E0',
    borderRadius: TRACK_HEIGHT / 2,
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    top: (THUMB_SIZE - TRACK_HEIGHT) / 2,
    height: TRACK_HEIGHT,
    backgroundColor: '#34C759',
    borderRadius: TRACK_HEIGHT / 2,
  },
  sliderThumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: '#333333',
    top: 0,
  },
});

export default App;
