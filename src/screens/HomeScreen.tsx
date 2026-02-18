import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
  Animated,
  Dimensions,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useDashboard } from './DashboardContext';
import { useNavigation } from '@react-navigation/native';
import { colors, fonts } from './styles';

const { width: SCREEN_W } = Dimensions.get('window');
const STAT_W = (SCREEN_W - 40 - 12) / 2;
const GRID_W = (SCREEN_W - 40 - 10) / 2;

function ProgressRing({
  size,
  stroke,
  progress,
  color = colors.accent,
}: {
  size: number;
  stroke: number;
  progress: number;
  color?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));
  const dash = circumference * clamped;

  return (
    <Svg width={size} height={size}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={colors.border}
        strokeWidth={stroke}
        fill="none"
      />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeDasharray={`${dash} ${circumference - dash}`}
        strokeLinecap="round"
        rotation={-90}
        originX={size / 2}
        originY={size / 2}
      />
    </Svg>
  );
}

function FadeSlideIn({
  children,
  delay = 0,
  direction = 'up',
}: {
  children: React.ReactNode;
  delay?: number;
  direction?: 'up' | 'left' | 'right';
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(direction === 'up' ? 30 : direction === 'left' ? -30 : 30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 500, delay, useNativeDriver: true }),
      Animated.spring(translate, { toValue: 0, friction: 8, tension: 50, delay, useNativeDriver: true }),
    ]).start();
  }, [opacity, translate, delay]);

  const transform = direction === 'up'
    ? [{ translateY: translate }]
    : [{ translateX: translate }];

  return (
    <Animated.View style={{ opacity, transform }}>
      {children}
    </Animated.View>
  );
}

function PulseView({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const scale = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay),
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }),
    ]).start();
  }, [scale, delay]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      {children}
    </Animated.View>
  );
}

function CountUp({ target, suffix = '', prefix = '' }: { target: number; suffix?: string; prefix?: string }) {
  const animValue = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = React.useState(0);

  useEffect(() => {
    animValue.setValue(0);
    Animated.timing(animValue, {
      toValue: target,
      duration: 1200,
      useNativeDriver: false,
    }).start();

    const listener = animValue.addListener(({ value }) => {
      setDisplay(Math.round(value));
    });
    return () => animValue.removeListener(listener);
  }, [animValue, target]);

  return (
    <Text style={h.statNumber}>{prefix}{display}{suffix}</Text>
  );
}

export default function HomeScreen() {
  const {
    storage,
    usageAccess,
    unusedCount,
    unusedApps,
    savedTodayBytes,
    refreshing,
    refreshAll,
    openAppUninstall,
  } = useDashboard();
  const navigation = useNavigation();


  const total = storage?.totalBytes ?? 0;
  const used = storage?.usedBytes ?? 0;
  const free = storage?.freeBytes ?? 0;
  const percent = total > 0 ? used / total : 0;

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024)
      return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024)
      return `${Math.round(bytes / 1024 / 1024)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
  };

  const CO2_PER_GB = 0.02;
  const savedGB = savedTodayBytes / 1024 / 1024 / 1024;
  const savedCO2Kg = savedGB * CO2_PER_GB;

  const formatCO2 = (bytes: number) => {
    const GB = bytes / 1024 / 1024 / 1024;
    const kg = GB * CO2_PER_GB;
    if (kg >= 0.01) return `${kg.toFixed(2)} kg`;
    const g = kg * 1000;
    if (g >= 0.01) return `${g.toFixed(2)} g`;
    return '0 g';
  };

  const treesEquiv = Math.max(0, savedCO2Kg / 21.77 * 365).toFixed(4);

  return (
    <SafeAreaView style={h.safeArea}>
      <View style={h.root}>
        {/* Header */}
        <FadeSlideIn delay={0}>
          <View style={h.header}>
            <View style={h.avatar}>
              <MaterialCommunityIcons name="leaf" size={18} color={colors.accent} />
            </View>
            <Text style={h.brand}>EcoCleaner</Text>
            
          </View>
        </FadeSlideIn>

        <ScrollView
          contentContainerStyle={h.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={colors.accent} />
          }
        >
          {/* ─── Storage Hero ─── */}
          <PulseView delay={100}>
            <TouchableOpacity
              style={h.heroCard}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('StorageBreakdown' as never)}
            >
              <View style={h.ringWrap}>
                <ProgressRing
                  size={190}
                  stroke={16}
                  progress={percent}
                  color={percent > 0.85 ? colors.danger : percent > 0.7 ? colors.warn : colors.accent}
                />
                <View style={h.ringCenter}>
                  <Text style={h.ringLabel}>STORAGE</Text>
                  <CountUp target={Math.round(percent * 100)} suffix="%" />
                  <Text style={h.ringSub}>
                    {formatSize(used)} / {formatSize(total)}
                  </Text>
                </View>
              </View>

              {/* Stat pills */}
              <View style={h.pillRow}>
                <View style={[h.pill, percent > 0.85 && { borderColor: colors.dangerDim, backgroundColor: colors.dangerBg }]}>
                  <View style={[h.pillDot, percent > 0.85 && { backgroundColor: colors.danger }]} />
                  <Text style={[h.pillText, percent > 0.85 && { color: colors.danger }]}>
                    {free > 5 * 1024 * 1024 * 1024 ? 'HEALTHY' : free > 1024 * 1024 * 1024 ? 'MODERATE' : 'LOW SPACE'}
                  </Text>
                </View>
                <View style={h.pill}>
                  <MaterialCommunityIcons name="harddisk" size={12} color={colors.accent} style={{ marginRight: 6 }} />
                  <Text style={h.pillText}>{formatSize(free)} FREE</Text>
                </View>
              </View>

              {/* Tap hint */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 4, opacity: 0.5 }}>
                <MaterialCommunityIcons name="gesture-tap" size={14} color={colors.textDim} />
                <Text style={{ color: colors.textDim, fontSize: 10, fontFamily: fonts.medium }}>
                  Tap for detailed breakdown
                </Text>
              </View>
            </TouchableOpacity>
          </PulseView>

          {/* ─── Quick Stats Row ─── */}
          <View style={h.statsRow}>
            <FadeSlideIn delay={200} direction="left">
              <View style={h.statCard}>
                <View style={[h.statIconWrap, { backgroundColor: 'rgba(92, 235, 107, 0.12)' }]}>
                  <MaterialCommunityIcons name="leaf" size={20} color={colors.accent} />
                </View>
                <Text style={h.statLabel}>Freed Today</Text>
                <Text style={h.statValue}>
                  {savedTodayBytes > 0 ? formatSize(savedTodayBytes) : '0 B'}
                </Text>
              </View>
            </FadeSlideIn>
            <FadeSlideIn delay={300} direction="right">
              <View style={h.statCard}>
                <View style={[h.statIconWrap, { backgroundColor: 'rgba(130, 177, 255, 0.12)' }]}>
                  <MaterialCommunityIcons name="molecule-co2" size={20} color="#82b1ff" />
                </View>
                <Text style={h.statLabel}>CO2 Saved</Text>
                <Text style={[h.statValue, { color: '#82b1ff' }]}>
                  {formatCO2(savedTodayBytes)}
                </Text>
              </View>
            </FadeSlideIn>
          </View>

          {/* ─── Carbon Impact Banner ─── */}
          <FadeSlideIn delay={420}>
            <TouchableOpacity
              style={h.carbonCard}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('Stats' as never)}
            >
              <Image
                source={{ uri: 'https://images.unsplash.com/photo-1501004318641-b39e6451bec6?w=800' }}
                style={h.carbonBg}
              />
              <View style={h.carbonOverlay} />
              <View style={h.carbonContent}>
                <View style={h.carbonBadge}>
                  <MaterialCommunityIcons name="leaf-circle" size={14} color={colors.accent} />
                  <Text style={h.carbonBadgeText}>DIGITAL FOOTPRINT</Text>
                </View>
                <Text style={h.carbonValue}>{formatCO2(savedTodayBytes)} CO2 Saved</Text>
                <Text style={h.carbonSub}>
                  {savedTodayBytes > 0
                    ? `${formatSize(savedTodayBytes)} freed \u2022 ~${treesEquiv} trees/yr equivalent`
                    : 'Delete files to reduce your carbon footprint'}
                </Text>
              </View>
              <View style={h.carbonArrow}>
                <MaterialCommunityIcons name="arrow-right" size={18} color={colors.bg} />
              </View>
            </TouchableOpacity>
          </FadeSlideIn>

          {/* ─── System Booster Banner ─── */}
          <FadeSlideIn delay={400}>
            <TouchableOpacity
              style={h.boosterCard}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('SystemBooster' as never)}
            >
              <View style={h.boosterGlow} />
              <View style={h.boosterIconWrap}>
                <MaterialCommunityIcons name="rocket-launch" size={28} color={colors.bg} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={h.boosterTitle}>System Booster</Text>
                <Text style={h.boosterSub}>Optimize RAM, CPU & clear cache</Text>
              </View>
              <View style={h.boosterArrow}>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.accent} />
              </View>
            </TouchableOpacity>
          </FadeSlideIn>

          {/* ─── Quick Actions ─── */}
          <FadeSlideIn delay={480}>
            <Text style={h.sectionTitle}>Quick Actions</Text>
          </FadeSlideIn>

          <View style={h.actionGrid}>
            {[
              {
                icon: 'broom' as const,
                title: 'Cleaner',
                sub: 'Junk & duplicates',
                nav: 'Clean',
                iconBg: 'rgba(92, 235, 107, 0.12)',
                iconColor: colors.accent,
              },
              {
                icon: 'apps' as const,
                title: 'App Manager',
                sub: usageAccess ? `${unusedCount ?? 0} unused` : 'Enable access',
                nav: 'Apps',
                iconBg: 'rgba(255, 201, 92, 0.12)',
                iconColor: colors.warn,
              },
              {
                icon: 'rocket-launch' as const,
                title: 'Booster',
                sub: 'Speed up device',
                nav: 'SystemBooster',
                iconBg: 'rgba(178, 160, 255, 0.12)',
                iconColor: '#b2a0ff',
              },
              {
                icon: 'devices' as const,
                title: 'Devices',
                sub: 'Remote cleanup',
                nav: 'ConnectedDevices',
                iconBg: 'rgba(130, 177, 255, 0.12)',
                iconColor: '#82b1ff',
              },
            ].map((item, idx) => (
              <FadeSlideIn key={item.nav} delay={520 + idx * 60}>
                <TouchableOpacity
                  style={h.gridCard}
                  activeOpacity={0.75}
                  onPress={() => navigation.navigate(item.nav as never)}
                >
                  <View style={[h.gridIcon, { backgroundColor: item.iconBg }]}>
                    <MaterialCommunityIcons name={item.icon} size={24} color={item.iconColor} />
                  </View>
                  <Text style={h.gridTitle}>{item.title}</Text>
                  <Text style={h.gridSub}>{item.sub}</Text>
                </TouchableOpacity>
              </FadeSlideIn>
            ))}
          </View>

          {/* ─── Unused Apps ─── */}
          {usageAccess && unusedApps.length > 0 && (
            <FadeSlideIn delay={700}>
              <Text style={h.sectionTitle}>Unused Apps</Text>
              <View style={h.unusedCard}>
                {unusedApps.map((app, i) => (
                  <View key={app.packageName} style={[h.unusedRow, i === unusedApps.length - 1 && { borderBottomWidth: 0 }]}>
                    <View style={h.unusedIcon}>
                      <MaterialCommunityIcons name="package-variant" size={18} color={colors.textDim} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={h.unusedName}>{app.appName}</Text>
                      <Text style={h.unusedPkg} numberOfLines={1}>{app.packageName}</Text>
                    </View>
                    <TouchableOpacity
                      style={h.uninstallBtn}
                      onPress={() => openAppUninstall(app.packageName)}
                    >
                      <Text style={h.uninstallText}>Uninstall</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </FadeSlideIn>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const h = StyleSheet.create({
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
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {
    color: colors.text,
    fontSize: 20,
    fontFamily: fonts.bold,
    marginLeft: 12,
    flex: 1,
    letterSpacing: 0.3,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },

  heroCard: {
    backgroundColor: colors.card,
    borderRadius: 28,
    paddingVertical: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  ringWrap: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringCenter: { position: 'absolute', alignItems: 'center' },
  ringLabel: {
    color: colors.textDim,
    fontSize: 10,
    letterSpacing: 2,
    fontFamily: fonts.semiBold,
  },
  ringSub: {
    color: colors.textSec,
    fontSize: 13,
    fontFamily: fonts.regular,
    marginTop: 2,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  pill: {
    backgroundColor: colors.accentBg,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.accentDim,
  },
  pillDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.accent,
    marginRight: 7,
  },
  pillText: {
    color: colors.accent,
    fontSize: 10,
    letterSpacing: 0.8,
    fontFamily: fonts.semiBold,
  },

  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
  },
  statCard: {
    width: STAT_W,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  statLabel: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: fonts.medium,
    letterSpacing: 0.3,
  },
  statValue: {
    color: colors.accent,
    fontSize: 18,
    fontFamily: fonts.bold,
    marginTop: 2,
  },
  statNumber: {
    color: colors.text,
    fontSize: 36,
    fontFamily: fonts.bold,
    marginTop: 2,
  },


  carbonCard: {
    marginTop: 14,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: colors.cardLight,
    height: 120,
    borderWidth: 1,
    borderColor: colors.border,
  },
  carbonBg: { position: 'absolute', width: '100%', height: '100%' },
  carbonOverlay: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(11, 20, 16, 0.72)',
  },
  carbonContent: { padding: 16, flex: 1, justifyContent: 'center' },
  carbonBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  carbonBadgeText: {
    color: colors.textDim,
    fontSize: 9,
    letterSpacing: 1.5,
    fontFamily: fonts.semiBold,
  },
  carbonValue: {
    color: colors.text,
    fontSize: 18,
    fontFamily: fonts.semiBold,
  },
  carbonSub: {
    color: colors.textSec,
    fontSize: 11,
    fontFamily: fonts.regular,
    marginTop: 3,
  },
  carbonArrow: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionTitle: {
    marginTop: 22,
    marginBottom: 6,
    color: colors.text,
    fontSize: 16,
    fontFamily: fonts.semiBold,
  },

  boosterCard: {
    marginTop: 14,
    backgroundColor: colors.accent,
    borderRadius: 22,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    elevation: 6,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  boosterGlow: {
    position: 'absolute',
    top: -30,
    right: -30,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  boosterIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  boosterTitle: {
    color: colors.bg,
    fontSize: 16,
    fontFamily: fonts.bold,
  },
  boosterSub: {
    color: 'rgba(11, 20, 16, 0.65)',
    fontSize: 12,
    fontFamily: fonts.medium,
    marginTop: 1,
  },
  boosterArrow: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
  },
  gridCard: {
    width: GRID_W,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 120,
    justifyContent: 'space-between',
  },
  gridIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  gridTitle: {
    color: colors.text,
    fontSize: 14,
    fontFamily: fonts.semiBold,
  },
  gridSub: {
    color: colors.textSec,
    fontSize: 11,
    fontFamily: fonts.regular,
    marginTop: 2,
  },

  unusedCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 4,
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  unusedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  unusedIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.cardLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  unusedName: {
    color: colors.text,
    fontSize: 13,
    fontFamily: fonts.semiBold,
  },
  unusedPkg: {
    color: colors.textDim,
    fontSize: 10,
    fontFamily: fonts.regular,
    marginTop: 1,
  },
  uninstallBtn: {
    backgroundColor: colors.dangerBg,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.dangerDim,
  },
  uninstallText: {
    color: colors.danger,
    fontSize: 11,
    fontFamily: fonts.semiBold,
  },
});
