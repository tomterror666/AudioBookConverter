import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  DependencyCheckResult,
  DependencyKey,
  DependencyLedStatus,
  DependencyStatuses,
  runDependencyChecks,
  runSingleDependencyAction,
} from '../dependencyStatus';

const LED_COLORS: Record<DependencyLedStatus, string> = {
  missing: '#FF3B30',
  wrong_version: '#FFCC00',
  ok: '#34C759',
};

const ROWS: {key: DependencyKey; label: string}[] = [
  {key: 'python', label: 'Python'},
  {key: 'pip', label: 'Package Installer (pip)'},
  {key: 'ffmpeg', label: 'ffmpeg'},
  {key: 'fasterWhisper', label: 'faster-whisper'},
];

type DependencyStatusPanelProps = {
  onCheckResult?: (result: DependencyCheckResult) => void;
};

export function DependencyStatusPanel(
  props: DependencyStatusPanelProps,
): React.JSX.Element {
  const {onCheckResult} = props;
  const [statuses, setStatuses] = useState<DependencyStatuses | null>(null);
  const [venvPathDisplay, setVenvPathDisplay] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<DependencyKey | null>(null);

  const refresh = useCallback(() => {
    runDependencyChecks().then(({statuses: next, venvPathDisplay: path}) => {
      setStatuses(next);
      setVenvPathDisplay(path);
      onCheckResult?.({statuses: next, venvPathDisplay: path});
    });
  }, [onCheckResult]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runAction = async (key: DependencyKey, mode: 'install' | 'update') => {
    setBusyKey(key);
    try {
      const log = await runSingleDependencyAction(key, mode);
      await refresh();
      const preview =
        log.length > 1400 ? `${log.slice(0, 1400)}…` : log || '(fertig)';
      Alert.alert(mode === 'install' ? 'Install' : 'Update', preview, [
        {text: 'OK'},
      ]);
    } catch (e) {
      Alert.alert('Fehler', e instanceof Error ? e.message : String(e), [
        {text: 'OK'},
      ]);
    } finally {
      setBusyKey(null);
    }
  };

  const isMacos = Platform.OS === 'macos';

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Python Info</Text>

      <View style={[styles.tableRow, styles.venvTableRow]}>
        <Text style={styles.labelBold} numberOfLines={2}>
          Python-Umgebung:
        </Text>
        <View style={styles.venvPathFill}>
          <Text style={styles.pathText} numberOfLines={1} ellipsizeMode="tail">
            {isMacos
              ? venvPathDisplay ?? 'PROJECT_ROOT/.audioBookConverter'
              : '(nur macOS)'}
          </Text>
        </View>
      </View>

      {ROWS.map((row, index) => {
        const s = statuses?.[row.key] ?? 'missing';
        const busy = busyKey === row.key;
        const showInstall = isMacos && s === 'missing';
        const showUpdate = isMacos && s === 'wrong_version';

        return (
          <View
            key={row.key}
            style={[
              styles.tableRow,
              index === ROWS.length - 1 && styles.rowLast,
            ]}>
            <Text style={styles.labelBold} numberOfLines={2}>
              {row.label}:
            </Text>
            <View style={styles.ledColumn}>
              <View style={[styles.led, {backgroundColor: LED_COLORS[s]}]} />
            </View>
            <View style={styles.actionColumn}>
              {showInstall || showUpdate ? (
                <Pressable
                  style={[styles.rowButton, busy && styles.rowButtonDisabled]}
                  onPress={() =>
                    runAction(row.key, showInstall ? 'install' : 'update')
                  }
                  disabled={busy}>
                  {busy ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.rowButtonText}>
                      {showInstall ? 'Install' : 'Update'}
                    </Text>
                  )}
                </Pressable>
              ) : (
                <View style={styles.rowButtonPlaceholder} />
              )}
            </View>
            <View style={styles.rowTrailSpacer} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    margin: 0,
    padding: 16,
    borderWidth: 1,
    borderColor: '#CCCCCC',
    borderRadius: 12,
    backgroundColor: '#FAFAFA',
    minWidth: 540,
    maxWidth: 920,
    alignSelf: 'flex-start',
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 16,
  },
  labelBold: {
    flexShrink: 0,
    width: 204,
    paddingRight: 11,
    fontSize: 14,
    fontWeight: '700',
    color: '#000000',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  venvTableRow: {
    alignItems: 'flex-start',
  },
  /** Volle Breite bis zum rechten Innenrand — keine leere Aktions-Spalte wie bei den LED-Zeilen. */
  venvPathFill: {
    flex: 1,
    minWidth: 260,
    justifyContent: 'center',
  },
  rowLast: {
    marginBottom: 0,
  },
  /** Feste schmale Spalte — kein flex:1, sonst wächst leerer Raum links/rechts der LED. */
  ledColumn: {
    width: 36,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pathText: {
    alignSelf: 'stretch',
    fontSize: 14,
    fontWeight: '400',
    color: '#000000',
  },
  actionColumn: {
    width: 78,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  /** Restbreite der Zeile — LED bleibt schmal, kein flex in der LED-Spalte. */
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
    backgroundColor: '#007AFF',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
  },
  rowButtonDisabled: {
    opacity: 0.85,
  },
  rowButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  rowButtonPlaceholder: {
    minWidth: 76,
    minHeight: 32,
  },
});
