import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Animated,
  Platform,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import RNFS from 'react-native-fs';
import { colors, fonts } from './styles';
import { storageCleaner, FileEntry } from '../services/storageCleaner';
import { getEcoTip, ScanSummary } from '../services/geminiService';
import { useDashboard } from './DashboardContext';
import EcoTipModal from '../components/EcoTipModal';

const { width: SCREEN_W } = Dimensions.get('window');

interface AppCacheInfo {
  key: string;
  name: string;
  pkg: string;
  icon: string;
  color: string;
  bgColor: string;
  paths: string[];
  categories: { label: string; path: string }[];
}

const SOCIAL_APPS: AppCacheInfo[] = [
  {
    key: 'whatsapp',
    name: 'WhatsApp',
    pkg: 'com.whatsapp',
    icon: 'whatsapp',
    color: '#25D366',
    bgColor: 'rgba(37, 211, 102, 0.12)',
    paths: [
      '/storage/emulated/0/Android/media/com.whatsapp/WhatsApp/Media',
      '/storage/emulated/0/WhatsApp/Media',
    ],
    categories: [
      { label: 'Sent Images', path: 'WhatsApp Images/Sent' },
      { label: 'Sent Videos', path: 'WhatsApp Video/Sent' },
      { label: 'Voice Notes', path: 'WhatsApp Voice Notes' },
      { label: 'Documents', path: 'WhatsApp Documents' },
      { label: 'Stickers', path: 'WhatsApp Stickers' },
    ],
  },
  {
    key: 'facebook',
    name: 'Facebook',
    pkg: 'com.facebook.katana',
    icon: 'facebook',
    color: '#1877F2',
    bgColor: 'rgba(24, 119, 242, 0.12)',
    paths: [
      '/storage/emulated/0/Pictures/Facebook',
      '/storage/emulated/0/Movies/Facebook',
      '/storage/emulated/0/DCIM/Facebook',
      '/storage/emulated/0/Facebook',
      '/storage/emulated/0/Download/Facebook',
      '/storage/emulated/0/Android/data/com.facebook.katana/cache',
      '/storage/emulated/0/Android/data/com.facebook.katana/files',
    ],
    categories: [
      { label: 'Photos', path: '__ROOT__Pictures/Facebook' },
      { label: 'Videos', path: '__ROOT__Movies/Facebook' },
      { label: 'Camera', path: '__ROOT__DCIM/Facebook' },
      { label: 'Downloads', path: '__ROOT__Download/Facebook' },
      { label: 'App Cache', path: '__ROOT__Android/data/com.facebook.katana/cache' },
    ],
  },
  {
    key: 'instagram',
    name: 'Instagram',
    pkg: 'com.instagram.android',
    icon: 'instagram',
    color: '#E4405F',
    bgColor: 'rgba(228, 64, 95, 0.12)',
    paths: [
      '/storage/emulated/0/Pictures/Instagram',
      '/storage/emulated/0/Movies/Instagram',
      '/storage/emulated/0/DCIM/Instagram',
      '/storage/emulated/0/Instagram',
      '/storage/emulated/0/Download/Instagram',
      '/storage/emulated/0/Android/data/com.instagram.android/cache',
      '/storage/emulated/0/Android/data/com.instagram.android/files',
    ],
    categories: [
      { label: 'Photos', path: '__ROOT__Pictures/Instagram' },
      { label: 'Videos', path: '__ROOT__Movies/Instagram' },
      { label: 'Camera', path: '__ROOT__DCIM/Instagram' },
      { label: 'Downloads', path: '__ROOT__Download/Instagram' },
      { label: 'App Cache', path: '__ROOT__Android/data/com.instagram.android/cache' },
    ],
  },
];

interface CategoryResult {
  label: string;
  files: FileEntry[];
  totalSize: number;
}

interface ScanResult {
  appKey: string;
  categories: CategoryResult[];
  totalSize: number;
  totalFiles: number;
}

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

async function scanDirectory(dirPath: string): Promise<FileEntry[]> {
  try {
    const exists = await RNFS.exists(dirPath);
    if (!exists) return [];
    const items = await RNFS.readDir(dirPath);
    const files: FileEntry[] = [];
    for (const item of items) {
      if (item.isFile()) {
        files.push({
          path: item.path,
          size: Number(item.size) || 0,
          modified: item.mtime ? new Date(item.mtime).getTime() : 0,
        });
      } else if (item.isDirectory()) {
        const sub = await scanDirectory(item.path);
        files.push(...sub);
      }
    }
    return files;
  } catch {
    return [];
  }
}

function PulseRing({ color, delay = 0 }: { color: string; delay?: number }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const timeout = setTimeout(() => {
      Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(scale, { toValue: 1.5, duration: 1200, useNativeDriver: true }),
            Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.timing(opacity, { toValue: 0, duration: 1200, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0.6, duration: 0, useNativeDriver: true }),
          ]),
        ]),
      ).start();
    }, delay);
    return () => clearTimeout(timeout);
  }, [scale, opacity, delay]);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        width: 52,
        height: 52,
        borderRadius: 26,
        borderWidth: 2,
        borderColor: color,
        transform: [{ scale }],
        opacity,
      }}
    />
  );
}

function AnimatedCard({
  children,
  index,
}: {
  children: React.ReactNode;
  index: number;
}) {
  const translateY = useRef(new Animated.Value(40)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        friction: 8,
        tension: 50,
        delay: index * 120,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 400,
        delay: index * 120,
        useNativeDriver: true,
      }),
    ]).start();
  }, [translateY, opacity, index]);

  return (
    <Animated.View style={{ transform: [{ translateY }], opacity }}>
      {children}
    </Animated.View>
  );
}

const STORAGE_ROOT = '/storage/emulated/0/';

export default function SocialCleanerScreen() {
  const navigation = useNavigation();
  const { addSavedBytes, refreshAll } = useDashboard();
  const [scanning, setScanning] = useState<string | null>(null);
  const [results, setResults] = useState<Map<string, ScanResult>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cleaning, setCleaning] = useState(false);

  const [ecoModalVisible, setEcoModalVisible] = useState(false);
  const [ecoTip, setEcoTip] = useState<string | null>(null);
  const [ecoTipLoading, setEcoTipLoading] = useState(false);
  const ecoRef = useRef({ itemCount: 0, totalSize: '' });

  const shimmerAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 1,
        duration: 2000,
        useNativeDriver: true,
      }),
    ).start();
  }, [shimmerAnim]);

  const scanApp = useCallback(async (app: AppCacheInfo) => {
    if (Platform.OS !== 'android') {
      Alert.alert('Android Only', 'Social media cleaning is only available on Android.');
      return;
    }

    setScanning(app.key);
    const categories: CategoryResult[] = [];
    const seenPaths = new Set<string>();

    for (const cat of app.categories) {
      let catFiles: FileEntry[] = [];

      if (cat.path.startsWith('__ROOT__')) {
        const absolutePath = STORAGE_ROOT + cat.path.replace('__ROOT__', '');
        const files = await scanDirectory(absolutePath);
        catFiles = files.filter((f) => !seenPaths.has(f.path));
        catFiles.forEach((f) => seenPaths.add(f.path));
      } else {
        for (const basePath of app.paths) {
          if (basePath.includes('/Android/data/') || basePath.includes('/Android/media/')) {
            continue;
          }
          const fullPath = `${basePath}/${cat.path}`;
          const files = await scanDirectory(fullPath);
          files.forEach((f) => {
            if (!seenPaths.has(f.path)) {
              catFiles.push(f);
              seenPaths.add(f.path);
            }
          });
        }
      }

      if (catFiles.length > 0) {
        const totalSize = catFiles.reduce((s, f) => s + f.size, 0);
        categories.push({ label: cat.label, files: catFiles, totalSize });
      }
    }

    if (app.key === 'whatsapp') {
      let cacheFiles: FileEntry[] = [];
      for (const basePath of app.paths) {
        const parentDir = basePath.replace(/\/Media$/, '');
        for (const sub of ['.Shared', '.trash', 'Cache', '.Thumbs']) {
          const files = await scanDirectory(`${parentDir}/${sub}`);
          files.forEach((f) => {
            if (!seenPaths.has(f.path)) {
              cacheFiles.push(f);
              seenPaths.add(f.path);
            }
          });
        }
      }
      if (cacheFiles.length > 0) {
        const totalSize = cacheFiles.reduce((s, f) => s + f.size, 0);
        categories.push({ label: 'Cache & Temp', files: cacheFiles, totalSize });
      }
    }

    if (app.key === 'facebook' || app.key === 'instagram') {
      const rootDir = `${STORAGE_ROOT}${app.key === 'facebook' ? 'Facebook' : 'Instagram'}`;
      const generalFiles = await scanDirectory(rootDir);
      const newFiles = generalFiles.filter((f) => !seenPaths.has(f.path));
      if (newFiles.length > 0) {
        newFiles.forEach((f) => seenPaths.add(f.path));
        const totalSize = newFiles.reduce((s, f) => s + f.size, 0);
        categories.push({ label: 'Other Data', files: newFiles, totalSize });
      }
    }

    const allFiles = categories.flatMap((c) => c.files);
    const totalSize = allFiles.reduce((s, f) => s + f.size, 0);

    const result: ScanResult = {
      appKey: app.key,
      categories,
      totalSize,
      totalFiles: allFiles.length,
    };

    setResults((prev) => {
      const next = new Map(prev);
      next.set(app.key, result);
      return next;
    });
    setExpanded((prev) => new Set(prev).add(app.key));
    setScanning(null);

    if (allFiles.length > 0) {
      ecoRef.current = { itemCount: allFiles.length, totalSize: formatBytes(totalSize) };
      setEcoTip(null);
      setEcoTipLoading(true);
      setEcoModalVisible(true);

      const summary: ScanSummary = {
        mode: app.key,
        itemCount: allFiles.length,
        totalSizeBytes: totalSize,
        sampleFiles: allFiles.slice(0, 6).map((f) => fileName(f.path)),
      };
      getEcoTip(summary)
        .then((tip) => setEcoTip(tip))
        .catch(() => setEcoTip('Every byte counts! Keep your social apps lean for a greener footprint.'))
        .finally(() => setEcoTipLoading(false));
    }
  }, []);

  const { openAppInfo } = useDashboard();

  const openAppSettings = useCallback((pkg: string) => {
    try {
      openAppInfo(pkg);
    } catch {
      Alert.alert('Cannot Open', 'Please go to Settings > Apps manually and find this app.');
    }
  }, [openAppInfo]);

  const toggleCategory = (appKey: string, catLabel: string) => {
    const result = results.get(appKey);
    if (!result) return;
    const cat = result.categories.find((c) => c.label === catLabel);
    if (!cat) return;

    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = cat.files.every((f) => next.has(f.path));
      cat.files.forEach((f) => {
        if (allSelected) next.delete(f.path); else next.add(f.path);
      });
      return next;
    });
  };

  const handleClean = useCallback(async () => {
    const paths = Array.from(selected);
    if (!paths.length) {
      Alert.alert('Nothing Selected', 'Select categories to clean first.');
      return;
    }
    const bytesToDelete = selectedSize;
    Alert.alert(
      'Clean Selected',
      `Delete ${paths.length} file(s) (${formatBytes(bytesToDelete)})?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setCleaning(true);
            try {
              const result = await storageCleaner.cleanup(paths, { dryRun: false, moveToTrash: false });
              if (result.status === 'success') {
                await addSavedBytes(bytesToDelete);
                await refreshAll();
                Alert.alert('Done', `Deleted ${result.deletedCount} file(s). ${formatBytes(bytesToDelete)} saved!`);
                setSelected(new Set());
                setResults(new Map());
                setExpanded(new Set());
              } else if (result.status === 'rejected') {
                Alert.alert('Rejected', result.reason);
              } else {
                Alert.alert('Error', result.message);
              }
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : String(e));
            } finally {
              setCleaning(false);
            }
          },
        },
      ],
    );
  }, [selected, selectedSize, addSavedBytes, refreshAll]);

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const selectedSize = Array.from(selected).reduce((total, path) => {
    for (const [, result] of results) {
      for (const cat of result.categories) {
        const file = cat.files.find((f) => f.path === path);
        if (file) return total + file.size;
      }
    }
    return total;
  }, 0);

  return (
    <SafeAreaView style={s.safeArea}>
      <View style={s.root}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4, marginRight: 4 }}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={colors.text} />
          </TouchableOpacity>
          <MaterialCommunityIcons name="account-group" size={20} color={colors.accent} style={{ marginRight: 8 }} />
          <Text style={s.headerTitle}>Social Media Cleaner</Text>
        </View>

        <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Hero banner */}
          <AnimatedCard index={0}>
            <View style={s.heroBanner}>
              <View style={s.heroIconRow}>
                {SOCIAL_APPS.map((app, i) => (
                  <View key={app.key} style={[s.heroIconCircle, { backgroundColor: app.bgColor }]}>
                    <PulseRing color={app.color} delay={i * 400} />
                    <MaterialCommunityIcons name={app.icon as any} size={26} color={app.color} />
                  </View>
                ))}
              </View>
              <Text style={s.heroTitle}>Clean Social App Cache</Text>
              <Text style={s.heroSub}>
                Free up space by removing sent media, cache, and temporary files from your social apps.
              </Text>
            </View>
          </AnimatedCard>

          {/* App Cards */}
          {SOCIAL_APPS.map((app, idx) => {
            const result = results.get(app.key);
            const isExpanded = expanded.has(app.key);
            const isScanning = scanning === app.key;
            const hasDirectAccess = app.paths.length > 0;

            return (
              <AnimatedCard key={app.key} index={idx + 1}>
                <View style={[s.appCard, { borderColor: isExpanded ? app.color + '40' : colors.border }]}>
                  {/* App header */}
                  <TouchableOpacity
                    style={s.appHeader}
                    onPress={() => result && toggleExpand(app.key)}
                    activeOpacity={0.7}
                  >
                    <View style={[s.appIconCircle, { backgroundColor: app.bgColor }]}>
                      <MaterialCommunityIcons name={app.icon as any} size={24} color={app.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.appName}>{app.name}</Text>
                      <Text style={s.appPkg}>
                        {result
                          ? `${result.totalFiles} files \u00B7 ${formatBytes(result.totalSize)}`
                          : 'Tap Scan to find junk'}
                      </Text>
                    </View>
                    {result && (
                      <MaterialCommunityIcons
                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                        size={22}
                        color={colors.textSec}
                      />
                    )}
                  </TouchableOpacity>

                  {/* Actions */}
                  <View style={s.actionRow}>
                    {hasDirectAccess ? (
                      <TouchableOpacity
                        style={[s.scanBtn, { backgroundColor: app.bgColor, borderColor: app.color + '30' }]}
                        onPress={() => scanApp(app)}
                        disabled={isScanning}
                        activeOpacity={0.7}
                      >
                        {isScanning ? (
                          <ActivityIndicator color={app.color} size="small" />
                        ) : (
                          <>
                            <MaterialCommunityIcons name="magnify" size={16} color={app.color} />
                            <Text style={[s.scanBtnText, { color: app.color }]}>
                              {result ? 'Re-scan' : 'Scan'}
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      style={[s.settingsBtn, { borderColor: app.color + '30' }]}
                      onPress={() => openAppSettings(app.pkg)}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons name="cog-outline" size={16} color={app.color} />
                      <Text style={[s.settingsBtnText, { color: app.color }]}>
                        {hasDirectAccess ? 'App Settings' : 'Clear Cache in Settings'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Expanded categories */}
                  {isExpanded && result && result.categories.length > 0 && (
                    <View style={s.categoryList}>
                      {result.categories.map((cat) => {
                        const allSelected = cat.files.every((f) => selected.has(f.path));
                        const someSelected = cat.files.some((f) => selected.has(f.path));
                        return (
                          <TouchableOpacity
                            key={cat.label}
                            style={s.categoryRow}
                            onPress={() => toggleCategory(app.key, cat.label)}
                            activeOpacity={0.7}
                          >
                            <View style={[s.checkbox, allSelected && s.checkboxChecked, someSelected && !allSelected && s.checkboxPartial]}>
                              {allSelected && <MaterialCommunityIcons name="check" size={14} color={colors.bg} />}
                              {someSelected && !allSelected && <MaterialCommunityIcons name="minus" size={14} color={colors.accent} />}
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={s.categoryLabel}>{cat.label}</Text>
                              <Text style={s.categoryMeta}>
                                {cat.files.length} file{cat.files.length !== 1 ? 's' : ''} \u00B7 {formatBytes(cat.totalSize)}
                              </Text>
                            </View>
                            <View style={[s.sizeBadge, { backgroundColor: app.bgColor }]}>
                              <Text style={[s.sizeBadgeText, { color: app.color }]}>{formatBytes(cat.totalSize)}</Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}

                  {isExpanded && result && result.categories.length === 0 && (
                    <View style={s.emptyResult}>
                      <MaterialCommunityIcons name="check-circle-outline" size={28} color={colors.accent} />
                      <Text style={s.emptyResultText}>
                        No cleanable files found! Try "App Settings" to clear internal cache.
                      </Text>
                    </View>
                  )}
                </View>
              </AnimatedCard>
            );
          })}

          {/* Info card */}
          <AnimatedCard index={SOCIAL_APPS.length + 1}>
            <View style={s.infoCard}>
              <MaterialCommunityIcons name="information-outline" size={18} color={colors.textDim} />
              <Text style={s.infoText}>
                We scan shared storage for saved photos, videos, and downloads. Some app cache in restricted directories may only be clearable via "App Settings". All deletions sync with your carbon savings dashboard.
              </Text>
            </View>
          </AnimatedCard>
        </ScrollView>

        {/* Bottom bar */}
        {selected.size > 0 && (
          <View style={s.bottomBar}>
            <TouchableOpacity
              style={s.cleanBtn}
              onPress={handleClean}
              disabled={cleaning}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="delete-outline" size={18} color={colors.white} />
              <Text style={s.cleanBtnText}>
                {cleaning
                  ? 'Cleaning...'
                  : `Delete ${selected.size} files \u00B7 ${formatBytes(selectedSize)}`}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <EcoTipModal
          visible={ecoModalVisible}
          onClose={() => setEcoModalVisible(false)}
          tip={ecoTip}
          loading={ecoTipLoading}
          scanMode={ecoRef.current.itemCount > 0 ? 'whatsapp' : 'junk'}
          itemCount={ecoRef.current.itemCount}
          totalSize={ecoRef.current.totalSize}
        />
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  root: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 180 },

  header: {
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    color: colors.text,
    fontSize: 18,
    fontFamily: fonts.semiBold,
    flex: 1,
  },

  heroBanner: {
    backgroundColor: colors.card,
    borderRadius: 22,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  heroIconRow: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 16,
  },
  heroIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    color: colors.text,
    fontSize: 18,
    fontFamily: fonts.semiBold,
    marginBottom: 6,
  },
  heroSub: {
    color: colors.textSec,
    fontSize: 13,
    fontFamily: fonts.regular,
    textAlign: 'center',
    lineHeight: 20,
  },

  appCard: {
    backgroundColor: colors.card,
    borderRadius: 20,
    marginBottom: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  appHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  appIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  appName: {
    color: colors.text,
    fontSize: 16,
    fontFamily: fonts.semiBold,
  },
  appPkg: {
    color: colors.textSec,
    fontSize: 12,
    fontFamily: fonts.regular,
    marginTop: 2,
  },

  actionRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 10,
  },
  scanBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  scanBtnText: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
  },
  settingsBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  settingsBtnText: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
  },

  categoryList: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkboxPartial: {
    borderColor: colors.accent,
  },
  categoryLabel: {
    color: colors.text,
    fontSize: 14,
    fontFamily: fonts.medium,
  },
  categoryMeta: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: fonts.regular,
    marginTop: 1,
  },
  sizeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  sizeBadgeText: {
    fontSize: 11,
    fontFamily: fonts.semiBold,
  },

  emptyResult: {
    padding: 20,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  emptyResultText: {
    color: colors.textSec,
    fontSize: 13,
    fontFamily: fonts.regular,
  },

  infoCard: {
    backgroundColor: colors.cardLight,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoText: {
    color: colors.textDim,
    fontSize: 12,
    fontFamily: fonts.regular,
    flex: 1,
    lineHeight: 18,
  },

  bottomBar: {
    position: 'absolute',
    bottom: 84,
    left: 16,
    right: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  cleanBtn: {
    backgroundColor: colors.danger,
    paddingVertical: 14,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  cleanBtnText: {
    color: colors.white,
    fontSize: 14,
    fontFamily: fonts.semiBold,
  },
});
