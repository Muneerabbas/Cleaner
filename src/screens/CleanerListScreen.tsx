import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  Platform,
  RefreshControl,
  AppState,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { storageCleaner, FileEntry } from '../services/storageCleaner';
import { useDashboard } from './DashboardContext';
import { styles, colors, fonts } from './styles';
import { CleanerMode } from './CleanerHomeScreen';
import { getEcoTip, ScanSummary } from '../services/geminiService';
import EcoTipModal from '../components/EcoTipModal';

const { width: SCREEN_W } = Dimensions.get('window');

type CleanerListParams = { mode: CleanerMode };

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function fileName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function shortPath(path: string): string {
  const parts = path.split(/[/\\]/);
  if (parts.length > 4) return `.../${parts.slice(-3).join('/')}`;
  return path;
}

const MODE_CONFIG: Record<CleanerMode, { title: string; icon: string; iconColor: string }> = {
  junk: { title: 'Junk Files', icon: 'delete-sweep', iconColor: '#ffab40' },
  large: { title: 'Large Files', icon: 'file-alert', iconColor: colors.accent },
  duplicates: { title: 'Duplicates', icon: 'content-copy', iconColor: '#82b1ff' },
  trash: { title: 'Trash', icon: 'delete-restore', iconColor: colors.danger },
  empty: { title: 'Empty Folders', icon: 'folder-off-outline', iconColor: '#b2a0ff' },
  compress: { title: 'Compressor', icon: 'folder-zip-outline', iconColor: '#7cb342' },
};

function FadeInItem({ children, index }: { children: React.ReactNode; index: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    const delay = Math.min(index * 50, 500);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, delay, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, friction: 8, tension: 60, delay, useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY, index]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

function PulseScanButton({ children, loading }: { children: React.ReactNode; loading: boolean }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!loading) {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.03, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ]),
      );
      anim.start();
      return () => anim.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [loading, pulseAnim]);

  return (
    <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
      {children}
    </Animated.View>
  );
}

const QUALITY_PRESETS = [
  { label: 'Maximum', value: 9, desc: 'Smallest file, slowest', icon: 'speedometer-slow' },
  { label: 'Balanced', value: 6, desc: 'Good size & speed', icon: 'speedometer-medium' },
  { label: 'Fast', value: 3, desc: 'Fastest, larger file', icon: 'speedometer' },
];

function CompressionModal({
  visible,
  onClose,
  onConfirm,
  fileCount,
  totalSize,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (level: number) => void;
  fileCount: number;
  totalSize: string;
}) {
  const [level, setLevel] = useState(6);
  const scaleAnim = useRef(new Animated.Value(0.85)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const sliderWidth = SCREEN_W - 48 - 48;

  useEffect(() => {
    if (visible) {
      scaleAnim.setValue(0.85);
      opacityAnim.setValue(0);
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, friction: 7, tension: 70, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, scaleAnim, opacityAnim]);

  const sliderPos = ((level - 1) / 8) * sliderWidth;
  const estSaving = level >= 7 ? '50-70%' : level >= 4 ? '30-50%' : '10-30%';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={cStyles.backdrop}>
        <Animated.View style={[cStyles.card, { transform: [{ scale: scaleAnim }], opacity: opacityAnim }]}>
          <View style={cStyles.glowStrip} />

          <View style={cStyles.iconCircle}>
            <MaterialCommunityIcons name="folder-zip-outline" size={28} color="#7cb342" />
          </View>

          <Text style={cStyles.title}>Compression Settings</Text>

          <View style={cStyles.infoPill}>
            <Text style={cStyles.infoPillText}>
              {fileCount} file{fileCount !== 1 ? 's' : ''} \u00B7 {totalSize}
            </Text>
          </View>

          {/* Quality Presets */}
          <View style={cStyles.presetRow}>
            {QUALITY_PRESETS.map((p) => {
              const active = level === p.value;
              return (
                <TouchableOpacity
                  key={p.value}
                  style={[cStyles.presetBtn, active && cStyles.presetBtnActive]}
                  onPress={() => setLevel(p.value)}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons
                    name={p.icon as any}
                    size={18}
                    color={active ? colors.bg : colors.textDim}
                  />
                  <Text style={[cStyles.presetLabel, active && cStyles.presetLabelActive]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Slider */}
          <View style={cStyles.sliderWrap}>
            <Text style={cStyles.sliderLabel}>Compression Level: {level}</Text>
            <View style={cStyles.sliderTrack}>
              <View style={[cStyles.sliderFill, { width: sliderPos + 16 }]} />
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((v) => (
                <TouchableOpacity
                  key={v}
                  style={[
                    cStyles.sliderDot,
                    { left: ((v - 1) / 8) * sliderWidth + 4 },
                    v === level && cStyles.sliderDotActive,
                    v <= level && { backgroundColor: '#7cb342' },
                  ]}
                  onPress={() => setLevel(v)}
                  hitSlop={{ top: 15, bottom: 15, left: 8, right: 8 }}
                />
              ))}
              <TouchableOpacity
                style={[cStyles.sliderThumb, { left: sliderPos }]}
                activeOpacity={0.9}
              >
                <Text style={cStyles.thumbText}>{level}</Text>
              </TouchableOpacity>
            </View>
            <View style={cStyles.sliderLabels}>
              <Text style={cStyles.sliderEndLabel}>Fast</Text>
              <Text style={cStyles.sliderEndLabel}>Small</Text>
            </View>
          </View>

          {/* Estimate */}
          <View style={cStyles.estimateRow}>
            <MaterialCommunityIcons name="chart-donut" size={16} color="#7cb342" />
            <Text style={cStyles.estimateText}>
              Estimated size reduction: {estSaving}
            </Text>
          </View>

          {/* Buttons */}
          <View style={cStyles.btnRow}>
            <TouchableOpacity style={cStyles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={cStyles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={cStyles.compressBtn}
              onPress={() => onConfirm(level)}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="folder-zip-outline" size={16} color={colors.bg} />
              <Text style={cStyles.compressBtnText}>Compress</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const cStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: SCREEN_W - 48,
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    paddingBottom: 22,
    overflow: 'hidden',
  },
  glowStrip: {
    width: '100%',
    height: 3,
    backgroundColor: '#7cb342',
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(124, 179, 66, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontFamily: fonts.semiBold,
    marginTop: 10,
  },
  infoPill: {
    backgroundColor: colors.cardLight,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 999,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoPillText: {
    color: colors.textSec,
    fontSize: 12,
    fontFamily: fonts.medium,
  },
  presetRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 18,
    paddingHorizontal: 20,
  },
  presetBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.cardLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  presetBtnActive: {
    backgroundColor: '#7cb342',
    borderColor: '#7cb342',
  },
  presetLabel: {
    fontSize: 11,
    fontFamily: fonts.semiBold,
    color: colors.textDim,
  },
  presetLabelActive: {
    color: colors.bg,
  },
  sliderWrap: {
    width: '100%',
    paddingHorizontal: 24,
    marginTop: 18,
  },
  sliderLabel: {
    color: colors.textSec,
    fontSize: 12,
    fontFamily: fonts.medium,
    marginBottom: 10,
  },
  sliderTrack: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    position: 'relative',
  },
  sliderFill: {
    position: 'absolute',
    height: 6,
    backgroundColor: '#7cb342',
    borderRadius: 3,
  },
  sliderDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.border,
    top: -2,
  },
  sliderDotActive: {
    backgroundColor: '#7cb342',
    width: 12,
    height: 12,
    borderRadius: 6,
    top: -3,
  },
  sliderThumb: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#7cb342',
    top: -11,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  thumbText: {
    color: colors.bg,
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  sliderEndLabel: {
    color: colors.textDim,
    fontSize: 10,
    fontFamily: fonts.regular,
  },
  estimateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 24,
  },
  estimateText: {
    color: colors.textSec,
    fontSize: 12,
    fontFamily: fonts.regular,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
    paddingHorizontal: 20,
    width: '100%',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: colors.cardLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelText: {
    color: colors.textSec,
    fontSize: 14,
    fontFamily: fonts.semiBold,
  },
  compressBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#7cb342',
  },
  compressBtnText: {
    color: colors.bg,
    fontSize: 14,
    fontFamily: fonts.semiBold,
  },
});

export default function CleanerListScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<{ params: CleanerListParams }, 'params'>>();
  const mode = route.params?.mode ?? 'junk';
  const config = MODE_CONFIG[mode];
  const { refreshAll, addSavedBytes } = useDashboard();

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<FileEntry[]>([]);
  const [emptyPaths, setEmptyPaths] = useState<string[]>([]);
  const [duplicateGroups, setDuplicateGroups] = useState<FileEntry[][]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);

  const [ecoModalVisible, setEcoModalVisible] = useState(false);
  const [ecoTip, setEcoTip] = useState<string | null>(null);
  const [ecoTipLoading, setEcoTipLoading] = useState(false);
  const ecoScanRef = useRef({ itemCount: 0, totalSize: '' });

  const [compressModalVisible, setCompressModalVisible] = useState(false);

  const isTrash = mode === 'trash';
  const isDuplicates = mode === 'duplicates';
  const isEmpty = mode === 'empty';
  const isCompress = mode === 'compress';

  // ─── Permission ───
  const checkPermission = useCallback(async () => {
    if (Platform.OS !== 'android') { setHasPermission(false); return false; }
    try {
      const g = await storageCleaner.hasStoragePermission();
      setHasPermission(g);
      return g;
    } catch { setHasPermission(false); return false; }
  }, []);

  useEffect(() => { checkPermission(); }, [checkPermission]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        checkPermission().then((g) => { if (g && !scanned) runScan(); });
      }
    });
    return () => sub.remove();
  }, [checkPermission, scanned]);

  const openSettings = useCallback(async () => {
    try { await storageCleaner.openManageStorageSettings(); }
    catch (e) { Alert.alert('Error', e instanceof Error ? e.message : String(e)); }
  }, []);

  // ─── Eco Tip ───
  const showEcoTip = useCallback(
    (scanItems: FileEntry[], scanEmpty: string[]) => {
      const count = mode === 'empty' ? scanEmpty.length : scanItems.length;
      const totalBytes = scanItems.reduce((s, f) => s + f.size, 0);
      const sizeStr = formatBytes(totalBytes);
      const sampleFiles = scanItems
        .slice(0, 6)
        .map((f) => fileName(f.path));

      ecoScanRef.current = { itemCount: count, totalSize: sizeStr };
      setEcoTip(null);
      setEcoTipLoading(true);
      setEcoModalVisible(true);

      const summary: ScanSummary = {
        mode,
        itemCount: count,
        totalSizeBytes: totalBytes,
        sampleFiles,
      };

      getEcoTip(summary)
        .then((tip) => setEcoTip(tip))
        .catch(() => setEcoTip('Every byte you clean saves a tiny bit of energy. Keep your storage tidy!'))
        .finally(() => setEcoTipLoading(false));
    },
    [mode],
  );

  // ─── Scan ───
  const runScan = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    setLoading(true);
    setError(null);
    let scanItems: FileEntry[] = [];
    let scanEmpty: string[] = [];
    try {
      switch (mode) {
        case 'junk': {
          const r = await storageCleaner.scanJunk();
          scanItems = r;
          setItems(r); setDuplicateGroups([]); setEmptyPaths([]);
          break;
        }
        case 'large': {
          const r = await storageCleaner.scanLargeFiles(100 * 1024 * 1024, 500);
          scanItems = r;
          setItems(r); setDuplicateGroups([]); setEmptyPaths([]);
          break;
        }
        case 'duplicates': {
          const groups = await storageCleaner.detectDuplicates();
          setDuplicateGroups(groups);
          scanItems = groups.flat();
          setItems(scanItems);
          setEmptyPaths([]);
          const autoSelect = new Set<string>();
          groups.forEach(g => g.slice(1).forEach(f => autoSelect.add(f.path)));
          setSelected(autoSelect);
          break;
        }
        case 'trash': {
          const r = await storageCleaner.getTrashFiles();
          scanItems = r;
          setItems(r); setDuplicateGroups([]); setEmptyPaths([]);
          break;
        }
        case 'empty': {
          const r = await storageCleaner.scanEmptyFolders();
          scanEmpty = r;
          setEmptyPaths(r); setItems([]); setDuplicateGroups([]);
          break;
        }
        case 'compress': {
          const r = await storageCleaner.scanCompressibleFiles(10 * 1024 * 1024, 600);
          scanItems = r;
          setItems(r); setDuplicateGroups([]); setEmptyPaths([]);
          break;
        }
      }
      if (mode !== 'duplicates') setSelected(new Set());
      setScanned(true);
      if (scanItems.length > 0 || scanEmpty.length > 0) {
        showEcoTip(scanItems, scanEmpty);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]); setEmptyPaths([]); setDuplicateGroups([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [mode, showEcoTip]);

  useEffect(() => {
    if (hasPermission && isTrash && !scanned) runScan();
  }, [hasPermission, isTrash, scanned, runScan]);

  const onRefresh = useCallback(() => { setRefreshing(true); runScan(); }, [runScan]);

  // ─── Selection ───
  const displayList: FileEntry[] = isEmpty ? [] : items;
  const totalSize = displayList.reduce((s, f) => s + f.size, 0);

  const selectedCount = isEmpty
    ? selected.size
    : displayList.filter(f => selected.has(f.path)).length;

  const selectedSize = useMemo(() =>
    displayList.filter(f => selected.has(f.path)).reduce((s, f) => s + f.size, 0),
    [displayList, selected],
  );

  const toggle = (path: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const selectAll = () => {
    if (isEmpty) setSelected(new Set(emptyPaths));
    else setSelected(new Set(displayList.map(f => f.path)));
  };
  const selectNone = () => setSelected(new Set());

  const getSelectedPaths = (): string[] => {
    if (isEmpty) return emptyPaths.filter(p => selected.has(p));
    return displayList.filter(f => selected.has(f.path)).map(f => f.path);
  };

  // ─── Actions ───
  const handleClean = useCallback(() => {
    const paths = getSelectedPaths();
    if (!paths.length) { Alert.alert('Nothing selected', 'Select items first.'); return; }
    const msg = isEmpty
      ? `Delete ${paths.length} empty folder(s)?`
      : isTrash
        ? `Permanently delete ${paths.length} item(s)?`
        : `Delete ${paths.length} item(s) (${formatBytes(selectedSize)})?`;
    Alert.alert('Confirm Delete', msg, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setCleaning(true); setError(null);
          try {
            const result = await storageCleaner.cleanup(paths, { dryRun: false, moveToTrash: false });
            if (result.status === 'success') {
              Alert.alert('Done', `Deleted ${result.deletedCount} item(s).${result.failedPaths.length ? ` ${result.failedPaths.length} failed.` : ''}`);
              await addSavedBytes(selectedSize);
              await refreshAll();
              runScan();
            } else if (result.status === 'rejected') {
              Alert.alert('Rejected', result.reason);
            } else {
              Alert.alert('Error', result.message);
            }
          } catch (e) {
            Alert.alert('Error', e instanceof Error ? e.message : String(e));
          } finally { setCleaning(false); }
        },
      },
    ]);
  }, [isEmpty, isTrash, selectedSize, runScan, refreshAll, addSavedBytes, emptyPaths, displayList, selected]);

  const handleRestore = useCallback(() => {
    const paths = getSelectedPaths();
    if (!paths.length) { Alert.alert('Nothing selected', 'Select items to restore.'); return; }
    Alert.alert('Restore', `Restore ${paths.length} item(s)?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restore', onPress: async () => {
          setCleaning(true); setError(null);
          try {
            const restored = await storageCleaner.restoreFromTrash(paths);
            Alert.alert('Done', `Restored ${restored.length} item(s).`);
            runScan();
          } catch (e) {
            Alert.alert('Error', e instanceof Error ? e.message : String(e));
          } finally { setCleaning(false); }
        },
      },
    ]);
  }, [runScan, emptyPaths, displayList, selected, isEmpty]);

  const handleCompress = useCallback(() => {
    const paths = getSelectedPaths();
    if (!paths.length) {
      Alert.alert('Nothing selected', 'Select files to compress first.');
      return;
    }
    setCompressModalVisible(true);
  }, [emptyPaths, displayList, selected, isEmpty]);

  const executeCompress = useCallback(async (_level: number) => {
    setCompressModalVisible(false);
    const paths = getSelectedPaths();
    if (!paths.length) return;
    setCleaning(true);
    setError(null);
    try {
      const archiveName = `cleaner_${Date.now()}`;
      const result = await storageCleaner.compressFiles(paths, archiveName);
      const saved = Math.max(0, result.sourceBytes - result.archiveBytes);
      if (saved > 0) {
        await addSavedBytes(saved);
        await refreshAll();
      }
      Alert.alert(
        'Compression Complete',
        `Archive: ${result.archivePath}\n` +
          `Files: ${result.sourceFileCount}\n` +
          `Original: ${formatBytes(result.sourceBytes)}\n` +
          `Archive: ${formatBytes(result.archiveBytes)}\n` +
          `Saved: ${formatBytes(saved)}`
      );
    } catch (e) {
      Alert.alert('Compression Error', e instanceof Error ? e.message : String(e));
    } finally {
      setCleaning(false);
    }
  }, [emptyPaths, displayList, selected, isEmpty, addSavedBytes, refreshAll]);

  // ─── Renders ───
  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4, marginRight: 4 }}>
        <MaterialCommunityIcons name="arrow-left" size={24} color={colors.text} />
      </TouchableOpacity>
      <MaterialCommunityIcons name={config.icon as any} size={20} color={config.iconColor} style={{ marginRight: 8 }} />
      <Text style={[styles.brand, { marginLeft: 0 }]}>{config.title}</Text>
      <View style={{ width: 36 }} />
    </View>
  );

  const renderCheckbox = (checked: boolean) => (
    <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
      {checked && <MaterialCommunityIcons name="check" size={16} color={colors.bg} />}
    </View>
  );

  // Permission states
  if (Platform.OS !== 'android') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.root}>
          {renderHeader()}
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="android" size={48} color={colors.textDim} />
            <Text style={styles.emptyText}>Available on Android only.</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (hasPermission === null) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.root}>
          {renderHeader()}
          <View style={styles.emptyState}>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={[styles.emptyText, { marginTop: 16 }]}>Checking permissions...</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.root}>
          {renderHeader()}
          <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
            <View style={styles.accessCard}>
              <MaterialCommunityIcons name="shield-lock-outline" size={40} color={colors.accent} />
              <Text style={[styles.accessTitle, { marginTop: 12 }]}>Storage Access Required</Text>
              <Text style={styles.accessSub}>
                To scan and clean files, the app needs full storage access.
                {'\n\n'}Tap below, then enable "Allow access to manage all files."
              </Text>
              <TouchableOpacity style={styles.accessButton} onPress={openSettings}>
                <Text style={styles.accessButtonText}>Grant Storage Access</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.accessButton, { backgroundColor: colors.cardLight, marginTop: 8 }]}
                onPress={checkPermission}
              >
                <Text style={[styles.accessButtonText, { color: colors.text }]}>I've granted it — check again</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Main UI ───
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        {renderHeader()}

        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: selectedCount > 0 ? 120 : 80 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        >
          {/* Scan Button */}
          {mode !== 'trash' && (
            <PulseScanButton loading={loading}>
              <TouchableOpacity style={styles.scanButton} onPress={runScan} disabled={loading} activeOpacity={0.8}>
                {loading ? (
                  <ActivityIndicator color={colors.bg} />
                ) : (
                  <>
                    <MaterialCommunityIcons name="magnify" size={18} color={colors.bg} />
                    <Text style={styles.scanButtonText}>{scanned ? 'Re-scan' : 'Scan Now'}</Text>
                  </>
                )}
              </TouchableOpacity>
            </PulseScanButton>
          )}

          {/* Error */}
          {error && (
            <View style={[styles.statsCard, { borderColor: colors.dangerDim }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialCommunityIcons name="alert-circle" size={18} color={colors.danger} />
                <Text style={[styles.listTitle, { color: colors.danger, flex: 1, fontSize: 13 }]}>{error}</Text>
              </View>
            </View>
          )}

          {/* Loading */}
          {loading && !refreshing && (
            <View style={styles.emptyState}>
              <ActivityIndicator color={colors.accent} size="large" />
              <Text style={[styles.emptyText, { marginTop: 12 }]}>Scanning your storage...</Text>
            </View>
          )}

          {/* Not scanned yet */}
          {!loading && !scanned && !isTrash && (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name={config.icon as any} size={48} color={colors.textDim} />
              <Text style={styles.emptyText}>Tap "Scan Now" to analyze your storage.</Text>
            </View>
          )}

          {/* Results */}
          {!loading && scanned && (
            <>
              {/* Summary Bar */}
              {(displayList.length > 0 || emptyPaths.length > 0) && (
                <View style={styles.summaryBar}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listTitle}>
                      {isEmpty ? `${emptyPaths.length} folder(s)` : `${displayList.length} item(s)`}
                    </Text>
                    {!isEmpty && <Text style={styles.listSubtitle}>{formatBytes(totalSize)} total</Text>}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity onPress={selectAll} style={{ paddingVertical: 4, paddingHorizontal: 8 }}>
                      <Text style={{ color: colors.accent, fontSize: 13, fontFamily: 'Poppins-SemiBold' }}>
                        All
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={selectNone} style={{ paddingVertical: 4, paddingHorizontal: 8 }}>
                      <Text style={{ color: colors.textSec, fontSize: 13, fontFamily: 'Poppins-SemiBold' }}>
                        None
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Empty State after scan */}
              {displayList.length === 0 && emptyPaths.length === 0 && (
                <View style={styles.emptyState}>
                  <MaterialCommunityIcons name="check-circle-outline" size={48} color={colors.accent} />
                  <Text style={styles.emptyText}>
                    {isTrash ? 'Trash is empty.' : 'Nothing found — your storage is clean!'}
                  </Text>
                </View>
              )}

              {/* Duplicate Groups */}
              {isDuplicates && duplicateGroups.length > 0 && duplicateGroups.map((group, gIdx) => (
                <FadeInItem key={gIdx} index={gIdx}><View style={styles.groupCard}>
                  <View style={styles.groupHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.groupTitle}>
                        Group {gIdx + 1} — {group.length} copies
                      </Text>
                      <Text style={styles.groupSub}>{formatBytes(group[0]?.size ?? 0)} each</Text>
                    </View>
                    <View style={styles.keepBadge}>
                      <Text style={styles.keepBadgeText}>KEEP 1ST</Text>
                    </View>
                  </View>
                  {group.map((f, fIdx) => {
                    const isKeep = fIdx === 0;
                    const isChecked = selected.has(f.path);
                    return (
                      <TouchableOpacity
                        key={f.path}
                        style={[
                          styles.miniRow,
                          { paddingHorizontal: 14 },
                          isKeep && { backgroundColor: 'rgba(92, 235, 107, 0.04)' },
                        ]}
                        onPress={() => toggle(f.path)}
                        activeOpacity={0.7}
                      >
                        {renderCheckbox(isChecked)}
                        <View style={{ flex: 1, marginLeft: 4 }}>
                          <Text style={[styles.miniName, { fontSize: 13 }]} numberOfLines={1}>
                            {fileName(f.path)}
                          </Text>
                          <Text style={styles.miniPkg} numberOfLines={1}>{shortPath(f.path)}</Text>
                        </View>
                        {isKeep && (
                          <View style={[styles.keepBadge, { marginLeft: 8 }]}>
                            <Text style={styles.keepBadgeText}>KEEP</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View></FadeInItem>
              ))}

              {/* Empty Folder Items */}
              {isEmpty && emptyPaths.map((path, idx) => (
                <FadeInItem key={path} index={idx}>
                  <TouchableOpacity
                    style={styles.fileCard}
                    onPress={() => toggle(path)}
                    activeOpacity={0.7}
                  >
                    {renderCheckbox(selected.has(path))}
                    <MaterialCommunityIcons name="folder-off-outline" size={20} color={colors.textDim} style={{ marginRight: 10 }} />
                    <Text style={[styles.miniPkg, { flex: 1, fontSize: 12 }]} numberOfLines={1}>
                      {shortPath(path)}
                    </Text>
                  </TouchableOpacity>
                </FadeInItem>
              ))}

              {/* Normal File Items (junk, large, trash, compress) */}
              {!isDuplicates && !isEmpty && displayList.map((f, idx) => (
                <FadeInItem key={f.path} index={idx}>
                  <TouchableOpacity
                    style={styles.fileCard}
                    onPress={() => toggle(f.path)}
                    activeOpacity={0.7}
                  >
                    {renderCheckbox(selected.has(f.path))}
                    <MaterialCommunityIcons
                      name={isTrash ? 'delete-outline' : 'file-outline'}
                      size={20}
                      color={colors.textDim}
                      style={{ marginRight: 10 }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.miniName, { fontSize: 13 }]} numberOfLines={1}>
                        {fileName(f.path)}
                      </Text>
                      <Text style={styles.miniPkg} numberOfLines={1}>{shortPath(f.path)}</Text>
                    </View>
                    <Text style={[styles.appSize, { marginLeft: 8 }]}>
                      {formatBytes(f.size)}
                    </Text>
                  </TouchableOpacity>
                </FadeInItem>
              ))}
            </>
          )}
        </ScrollView>

        {/* ─── Sticky Bottom Action Bar ─── */}
        {selectedCount > 0 && !loading && (
          <View style={styles.bottomBar}>
            {isTrash && (
              <TouchableOpacity
                style={[styles.bottomBtn, styles.bottomBtnRestore]}
                onPress={handleRestore}
                disabled={cleaning}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="restore" size={18} color={colors.white} />
                <Text style={styles.bottomBtnText}>
                  {cleaning ? 'Restoring...' : `Restore (${selectedCount})`}
                </Text>
              </TouchableOpacity>
            )}
            {isCompress ? (
              <TouchableOpacity
                style={[styles.bottomBtn, { backgroundColor: '#7cb342' }]}
                onPress={handleCompress}
                disabled={cleaning}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="folder-zip-outline" size={18} color={colors.white} />
                <Text style={styles.bottomBtnText}>
                  {cleaning ? 'Compressing...' : `Compress (${selectedCount}) · ${formatBytes(selectedSize)}`}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.bottomBtn, styles.bottomBtnDelete]}
                onPress={handleClean}
                disabled={cleaning}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="delete-outline" size={18} color={colors.white} />
                <Text style={styles.bottomBtnText}>
                  {cleaning ? 'Deleting...' : `Delete (${selectedCount}) · ${formatBytes(selectedSize)}`}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <EcoTipModal
          visible={ecoModalVisible}
          onClose={() => setEcoModalVisible(false)}
          tip={ecoTip}
          loading={ecoTipLoading}
          scanMode={mode}
          itemCount={ecoScanRef.current.itemCount}
          totalSize={ecoScanRef.current.totalSize}
        />

        <CompressionModal
          visible={compressModalVisible}
          onClose={() => setCompressModalVisible(false)}
          onConfirm={executeCompress}
          fileCount={selectedCount}
          totalSize={formatBytes(selectedSize)}
        />
      </View>
    </SafeAreaView>
  );
}
