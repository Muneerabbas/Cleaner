import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Platform,
  RefreshControl,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Circle, G } from 'react-native-svg';
import RNFS from 'react-native-fs';
import { colors, fonts } from './styles';
import { useDashboard } from './DashboardContext';

const { width: SCREEN_W } = Dimensions.get('window');
const RING_SIZE = 200;
const RING_STROKE = 18;
const CO2_PER_GB = 0.02;

interface StorageCategory {
  key: string;
  label: string;
  icon: string;
  color: string;
  sizeBytes: number;
  fileCount: number;
  dirs: string[];
  extensions: string[];
}

const CATEGORIES: Omit<StorageCategory, 'sizeBytes' | 'fileCount'>[] = [
  {
    key: 'photos',
    label: 'Photos',
    icon: 'image-multiple',
    color: '#FF6B6B',
    dirs: ['DCIM', 'Pictures'],
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp', '.svg'],
  },
  {
    key: 'videos',
    label: 'Videos',
    icon: 'video',
    color: '#82B1FF',
    dirs: ['Movies', 'DCIM'],
    extensions: ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.3gp', '.m4v'],
  },
  {
    key: 'audio',
    label: 'Audio',
    icon: 'music',
    color: '#FFD93D',
    dirs: ['Music', 'Ringtones', 'Alarms', 'Notifications', 'Podcasts'],
    extensions: ['.mp3', '.aac', '.flac', '.ogg', '.wav', '.m4a', '.wma', '.opus'],
  },
  {
    key: 'documents',
    label: 'Documents',
    icon: 'file-document',
    color: '#5ceb6b',
    dirs: ['Documents', 'Download'],
    extensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.rtf'],
  },
  {
    key: 'apps',
    label: 'Apps',
    icon: 'apps',
    color: '#B2A0FF',
    dirs: [],
    extensions: ['.apk', '.xapk', '.aab'],
  },
  {
    key: 'other',
    label: 'Other',
    icon: 'folder-outline',
    color: '#627A6B',
    dirs: [],
    extensions: [],
  },
];

const STORAGE_ROOT = '/storage/emulated/0';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatCO2(bytes: number): string {
  const kg = (bytes / 1024 / 1024 / 1024) * CO2_PER_GB;
  if (kg >= 0.01) return `${kg.toFixed(2)} kg`;
  const g = kg * 1000;
  if (g >= 0.1) return `${g.toFixed(1)} g`;
  if (g >= 0.01) return `${g.toFixed(2)} g`;
  return '< 0.01 g';
}

async function scanDirShallow(dirPath: string): Promise<{ size: number; count: number }> {
  try {
    const exists = await RNFS.exists(dirPath);
    if (!exists) return { size: 0, count: 0 };
    const items = await RNFS.readDir(dirPath);
    let size = 0;
    let count = 0;
    for (const item of items) {
      if (item.isFile()) {
        size += Number(item.size) || 0;
        count++;
      } else if (item.isDirectory()) {
        const sub = await scanDirShallow(item.path);
        size += sub.size;
        count += sub.count;
      }
    }
    return { size, count };
  } catch {
    return { size: 0, count: 0 };
  }
}

function DonutChart({
  segments,
  size,
  stroke,
  centerLabel,
  centerValue,
  centerSub,
}: {
  segments: { color: string; percent: number }[];
  size: number;
  stroke: number;
  centerLabel: string;
  centerValue: string;
  centerSub: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.border}
          strokeWidth={stroke}
          fill="none"
        />
        <G rotation={-90} originX={size / 2} originY={size / 2}>
          {segments.map((seg, i) => {
            const dash = circumference * seg.percent;
            const gap = circumference - dash;
            const dashOffset = circumference * offset;
            offset += seg.percent;
            return (
              <Circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={seg.color}
                strokeWidth={stroke}
                fill="none"
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={-dashOffset}
                strokeLinecap="round"
              />
            );
          })}
        </G>
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <Text style={ds.ringLabel}>{centerLabel}</Text>
        <Text style={ds.ringValue}>{centerValue}</Text>
        <Text style={ds.ringSub}>{centerSub}</Text>
      </View>
    </View>
  );
}

function AnimatedBar({
  percent,
  color,
  delay = 0,
}: {
  percent: number;
  color: string;
  delay?: number;
}) {
  const width = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(width, {
      toValue: percent,
      duration: 800,
      delay,
      useNativeDriver: false,
    }).start();
  }, [width, percent, delay]);

  const widthInterp = width.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={ds.barTrack}>
      <Animated.View style={[ds.barFill, { width: widthInterp, backgroundColor: color }]} />
    </View>
  );
}

function FadeIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(25)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 450, delay, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, friction: 8, tension: 50, delay, useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY, delay]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

export default function StorageBreakdownScreen() {
  const navigation = useNavigation();
  const { storage, savedTodayBytes, appsStorage, refreshAll, refreshing } = useDashboard();
  const [scanning, setScanning] = useState(false);
  const [categories, setCategories] = useState<StorageCategory[]>([]);
  const [scanned, setScanned] = useState(false);

  const total = storage?.totalBytes ?? 0;
  const used = storage?.usedBytes ?? 0;
  const free = storage?.freeBytes ?? 0;

  const runScan = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    setScanning(true);

    const results: StorageCategory[] = [];
    const allKnownExts = CATEGORIES.flatMap((c) => c.extensions);

    for (const cat of CATEGORIES) {
      if (cat.key === 'apps') {
        const appsTotal = appsStorage.reduce((s, a) => s + a.appBytes + a.dataBytes + a.cacheBytes, 0);
        results.push({ ...cat, sizeBytes: appsTotal, fileCount: appsStorage.length });
        continue;
      }

      if (cat.key === 'other') {
        continue;
      }

      let totalSize = 0;
      let totalCount = 0;
      const scannedDirs = new Set<string>();

      for (const dir of cat.dirs) {
        const fullPath = `${STORAGE_ROOT}/${dir}`;
        if (scannedDirs.has(fullPath)) continue;
        scannedDirs.add(fullPath);

        try {
          const exists = await RNFS.exists(fullPath);
          if (!exists) continue;
          const items = await RNFS.readDir(fullPath);

          for (const item of items) {
            if (item.isFile()) {
              const ext = (item.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
              if (cat.extensions.length === 0 || cat.extensions.includes(ext)) {
                totalSize += Number(item.size) || 0;
                totalCount++;
              }
            } else if (item.isDirectory()) {
              const sub = await scanDirShallow(item.path);
              totalSize += sub.size;
              totalCount += sub.count;
            }
          }
        } catch {
          // skip inaccessible
        }
      }

      results.push({ ...cat, sizeBytes: totalSize, fileCount: totalCount });
    }

    const knownTotal = results.reduce((s, c) => s + c.sizeBytes, 0);
    const otherSize = Math.max(0, used - knownTotal);
    const otherCat = CATEGORIES.find((c) => c.key === 'other')!;
    results.push({ ...otherCat, sizeBytes: otherSize, fileCount: 0 });

    results.sort((a, b) => b.sizeBytes - a.sizeBytes);
    setCategories(results);
    setScanned(true);
    setScanning(false);
  }, [appsStorage, used]);

  useEffect(() => {
    if (!scanned && Platform.OS === 'android') {
      runScan();
    }
  }, [scanned, runScan]);

  const donutSegments = categories
    .filter((c) => c.sizeBytes > 0)
    .map((c) => ({
      color: c.color,
      percent: used > 0 ? c.sizeBytes / used : 0,
    }));

  const freePercent = total > 0 ? free / total : 0;
  if (freePercent > 0) {
    donutSegments.push({ color: colors.border, percent: freePercent });
  }

  return (
    <SafeAreaView style={ds.safeArea}>
      <View style={ds.root}>
        {/* Header */}
        <View style={ds.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4, marginRight: 4 }}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={colors.text} />
          </TouchableOpacity>
          <MaterialCommunityIcons name="chart-donut" size={20} color={colors.accent} style={{ marginRight: 8 }} />
          <Text style={ds.headerTitle}>Storage Breakdown</Text>
        </View>

        <ScrollView
          contentContainerStyle={ds.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => { await refreshAll(); setScanned(false); }}
              tintColor={colors.accent}
            />
          }
        >
          {/* Donut Chart */}
          <FadeIn delay={50}>
            <View style={ds.chartCard}>
              {scanning ? (
                <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                  <ActivityIndicator color={colors.accent} size="large" />
                  <Text style={[ds.ringSub, { marginTop: 12 }]}>Analyzing storage...</Text>
                </View>
              ) : (
                <DonutChart
                  segments={donutSegments}
                  size={RING_SIZE}
                  stroke={RING_STROKE}
                  centerLabel="USED"
                  centerValue={formatBytes(used)}
                  centerSub={`of ${formatBytes(total)}`}
                />
              )}

              {/* Legend */}
              {!scanning && categories.length > 0 && (
                <View style={ds.legendWrap}>
                  {categories.filter((c) => c.sizeBytes > 0).map((c) => (
                    <View key={c.key} style={ds.legendItem}>
                      <View style={[ds.legendDot, { backgroundColor: c.color }]} />
                      <Text style={ds.legendText}>{c.label}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </FadeIn>

          {/* Carbon summary */}
          <FadeIn delay={150}>
            <View style={ds.carbonRow}>
              <View style={ds.carbonCard}>
                <MaterialCommunityIcons name="leaf" size={20} color={colors.accent} />
                <Text style={ds.carbonLabel}>Freed Today</Text>
                <Text style={ds.carbonValue}>{formatBytes(savedTodayBytes)}</Text>
              </View>
              <View style={ds.carbonCard}>
                <MaterialCommunityIcons name="molecule-co2" size={20} color="#82b1ff" />
                <Text style={ds.carbonLabel}>CO2 Saved</Text>
                <Text style={[ds.carbonValue, { color: '#82b1ff' }]}>{formatCO2(savedTodayBytes)}</Text>
              </View>
              <View style={ds.carbonCard}>
                <MaterialCommunityIcons name="harddisk" size={20} color={colors.warn} />
                <Text style={ds.carbonLabel}>Free Space</Text>
                <Text style={[ds.carbonValue, { color: colors.warn }]}>{formatBytes(free)}</Text>
              </View>
            </View>
          </FadeIn>

          {/* Category breakdown */}
          {!scanning && (
            <FadeIn delay={250}>
              <Text style={ds.sectionTitle}>Category Breakdown</Text>
            </FadeIn>
          )}

          {!scanning && categories.map((cat, idx) => {
            const pct = used > 0 ? cat.sizeBytes / used : 0;
            const co2 = formatCO2(cat.sizeBytes);

            return (
              <FadeIn key={cat.key} delay={300 + idx * 60}>
                <View style={ds.catCard}>
                  <View style={ds.catHeader}>
                    <View style={[ds.catIcon, { backgroundColor: cat.color + '18' }]}>
                      <MaterialCommunityIcons name={cat.icon as any} size={22} color={cat.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={ds.catName}>{cat.label}</Text>
                        <Text style={[ds.catSize, { color: cat.color }]}>{formatBytes(cat.sizeBytes)}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
                        <Text style={ds.catMeta}>
                          {cat.fileCount > 0 ? `${cat.fileCount} item${cat.fileCount !== 1 ? 's' : ''}` : ''}
                        </Text>
                        <Text style={ds.catMeta}>{Math.round(pct * 100)}%</Text>
                      </View>
                    </View>
                  </View>

                  <AnimatedBar percent={pct} color={cat.color} delay={400 + idx * 60} />

                  <View style={ds.catFooter}>
                    <View style={ds.catCo2Badge}>
                      <MaterialCommunityIcons name="molecule-co2" size={12} color={colors.textDim} />
                      <Text style={ds.catCo2Text}>{co2} CO2</Text>
                    </View>
                    {pct > 0.15 && (
                      <View style={[ds.catCo2Badge, { backgroundColor: cat.color + '15' }]}>
                        <MaterialCommunityIcons name="alert-circle-outline" size={12} color={cat.color} />
                        <Text style={[ds.catCo2Text, { color: cat.color }]}>High usage</Text>
                      </View>
                    )}
                  </View>
                </View>
              </FadeIn>
            );
          })}

          {/* Eco tip */}
          {!scanning && categories.length > 0 && (
            <FadeIn delay={600}>
              <View style={ds.tipCard}>
                <MaterialCommunityIcons name="lightbulb-outline" size={20} color={colors.accent} />
                <Text style={ds.tipText}>
                  {(() => {
                    const largest = categories[0];
                    if (!largest) return 'Scan to see your storage breakdown.';
                    return `Your ${largest.label.toLowerCase()} take up the most space (${formatBytes(largest.sizeBytes)}). Consider cleaning unused ${largest.label.toLowerCase()} to free up storage and reduce your digital carbon footprint.`;
                  })()}
                </Text>
              </View>
            </FadeIn>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const ds = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 20, paddingBottom: 120 },

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

  chartCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  ringLabel: {
    color: colors.textDim,
    fontSize: 10,
    letterSpacing: 2,
    fontFamily: fonts.semiBold,
  },
  ringValue: {
    color: colors.text,
    fontSize: 24,
    fontFamily: fonts.bold,
    marginTop: 2,
  },
  ringSub: {
    color: colors.textSec,
    fontSize: 12,
    fontFamily: fonts.regular,
    marginTop: 1,
  },
  legendWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    marginTop: 18,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    color: colors.textSec,
    fontSize: 11,
    fontFamily: fonts.medium,
  },

  carbonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  carbonCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  carbonLabel: {
    color: colors.textDim,
    fontSize: 10,
    fontFamily: fonts.medium,
    textAlign: 'center',
  },
  carbonValue: {
    color: colors.accent,
    fontSize: 14,
    fontFamily: fonts.bold,
    textAlign: 'center',
  },

  sectionTitle: {
    marginTop: 22,
    marginBottom: 8,
    color: colors.text,
    fontSize: 16,
    fontFamily: fonts.semiBold,
  },

  catCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  catHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  catIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  catName: {
    color: colors.text,
    fontSize: 15,
    fontFamily: fonts.semiBold,
  },
  catSize: {
    fontSize: 15,
    fontFamily: fonts.bold,
  },
  catMeta: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: fonts.regular,
  },
  barTrack: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
  catFooter: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  catCo2Badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.cardLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  catCo2Text: {
    color: colors.textDim,
    fontSize: 10,
    fontFamily: fonts.medium,
  },

  tipCard: {
    backgroundColor: colors.cardLight,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tipText: {
    color: colors.textSec,
    fontSize: 13,
    fontFamily: fonts.regular,
    flex: 1,
    lineHeight: 20,
  },
});
