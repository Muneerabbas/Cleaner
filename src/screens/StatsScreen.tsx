import React, { useEffect, useRef } from 'react';
import { View, Text, ScrollView, RefreshControl, Animated, StyleSheet, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { useDashboard } from './DashboardContext';
import { colors, fonts } from './styles';

const { width: SCREEN_W } = Dimensions.get('window');
const RING_SIZE = 140;
const RING_STROKE = 12;

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatCO2(bytes: number): string {
  const kg = (bytes / 1024 / 1024 / 1024) * 0.02;
  if (kg >= 0.01) return `${kg.toFixed(2)} kg`;
  const g = kg * 1000;
  if (g >= 0.1) return `${g.toFixed(1)} g`;
  if (g >= 0.01) return `${g.toFixed(2)} g`;
  return '0 g';
}

function FadeIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 450, delay, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, friction: 8, tension: 50, delay, useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY, delay]);

  return <Animated.View style={{ opacity, transform: [{ translateY }] }}>{children}</Animated.View>;
}

function StatRow({
  icon,
  iconColor,
  label,
  value,
  valueColor,
  last = false,
}: {
  icon: string;
  iconColor: string;
  label: string;
  value: string;
  valueColor?: string;
  last?: boolean;
}) {
  return (
    <View style={[st.statRow, last && { borderBottomWidth: 0 }]}>
      <View style={[st.statIconWrap, { backgroundColor: iconColor + '15' }]}>
        <MaterialCommunityIcons name={icon as any} size={18} color={iconColor} />
      </View>
      <Text style={st.statLabel}>{label}</Text>
      <Text style={[st.statValue, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
    </View>
  );
}

export default function StatsScreen() {
  const {
    storage,
    savedTodayBytes,
    unusedCount,
    usageAccess,
    refreshing,
    refreshAll,
  } = useDashboard();

  const total = storage?.totalBytes ?? 0;
  const used = storage?.usedBytes ?? 0;
  const free = storage?.freeBytes ?? 0;
  const percent = total > 0 ? used / total : 0;

  const co2Used = formatCO2(used);
  const co2Saved = formatCO2(savedTodayBytes);
  const treesEquiv = Math.max(0, ((savedTodayBytes / 1024 / 1024 / 1024) * 0.02) / 21.77 * 365).toFixed(4);

  return (
    <SafeAreaView style={st.safe}>
      <View style={st.root}>
        {/* Header */}
        <FadeIn delay={0}>
          <View style={st.header}>
            <View style={st.avatar}>
              <MaterialCommunityIcons name="chart-arc" size={18} color={colors.accent} />
            </View>
            <Text style={st.brand}>Statistics</Text>
            
          </View>
        </FadeIn>

        <ScrollView
          contentContainerStyle={st.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={colors.accent} />}
        >
          {/* Hero Impact Card */}
          <FadeIn delay={50}>
            <View style={st.heroCard}>
              <View style={st.heroRingWrap}>
                <Svg width={RING_SIZE} height={RING_SIZE}>
                  <Circle
                    cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={(RING_SIZE - RING_STROKE) / 2}
                    stroke={colors.border} strokeWidth={RING_STROKE} fill="none"
                  />
                  <Circle
                    cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={(RING_SIZE - RING_STROKE) / 2}
                    stroke={percent > 0.85 ? colors.danger : percent > 0.7 ? colors.warn : colors.accent}
                    strokeWidth={RING_STROKE} fill="none"
                    strokeDasharray={`${2 * Math.PI * ((RING_SIZE - RING_STROKE) / 2) * percent} ${2 * Math.PI * ((RING_SIZE - RING_STROKE) / 2) * (1 - percent)}`}
                    strokeLinecap="round" rotation={-90}
                    originX={RING_SIZE / 2} originY={RING_SIZE / 2}
                  />
                </Svg>
                <View style={{ position: 'absolute', alignItems: 'center' }}>
                  <Text style={st.heroPct}>{Math.round(percent * 100)}%</Text>
                  <Text style={st.heroSub}>used</Text>
                </View>
              </View>

              <View style={st.heroStats}>
                <View style={st.heroStatItem}>
                  <Text style={st.heroStatValue}>{formatSize(used)}</Text>
                  <Text style={st.heroStatLabel}>Used</Text>
                </View>
                <View style={[st.heroStatDivider]} />
                <View style={st.heroStatItem}>
                  <Text style={[st.heroStatValue, { color: colors.accent }]}>{formatSize(free)}</Text>
                  <Text style={st.heroStatLabel}>Free</Text>
                </View>
                <View style={st.heroStatDivider} />
                <View style={st.heroStatItem}>
                  <Text style={st.heroStatValue}>{formatSize(total)}</Text>
                  <Text style={st.heroStatLabel}>Total</Text>
                </View>
              </View>
            </View>
          </FadeIn>

          {/* Freed Today */}
          <FadeIn delay={150}>
            <View style={st.freedCard}>
              <View style={st.freedIcon}>
                <MaterialCommunityIcons name="leaf" size={26} color={colors.accent} />
              </View>
              <Text style={st.freedValue}>
                {savedTodayBytes > 0 ? formatSize(savedTodayBytes) : '0 B'}
              </Text>
              <Text style={st.freedLabel}>Freed Today</Text>
              <View style={st.freedCo2Row}>
                <View style={st.freedCo2Pill}>
                  <MaterialCommunityIcons name="molecule-co2" size={14} color="#82b1ff" />
                  <Text style={st.freedCo2Text}>{co2Saved} CO2</Text>
                </View>
                <View style={st.freedCo2Pill}>
                  <MaterialCommunityIcons name="tree" size={14} color={colors.accent} />
                  <Text style={[st.freedCo2Text, { color: colors.accent }]}>~{treesEquiv} trees/yr</Text>
                </View>
              </View>
            </View>
          </FadeIn>

          {/* Environment Section */}
          <FadeIn delay={250}>
            <Text style={st.sectionTitle}>Environmental Impact</Text>
            <View style={st.sectionCard}>
              <StatRow icon="molecule-co2" iconColor="#82b1ff" label="CO2 from stored data" value={co2Used} />
              <StatRow icon="leaf" iconColor={colors.accent} label="CO2 saved today" value={co2Saved} valueColor={colors.accent} />
              <StatRow icon="tree" iconColor="#7cb342" label="Tree equivalent/yr" value={`~${treesEquiv}`} valueColor="#7cb342" last />
            </View>
          </FadeIn>

          {/* Storage Section */}
          <FadeIn delay={350}>
            <Text style={st.sectionTitle}>Storage Details</Text>
            <View style={st.sectionCard}>
              <StatRow icon="harddisk" iconColor={colors.accent} label="Total Storage" value={formatSize(total)} />
              <StatRow icon="database" iconColor={colors.warn} label="Used Space" value={`${formatSize(used)} (${Math.round(percent * 100)}%)`} />
              <StatRow icon="check-circle-outline" iconColor={colors.accent} label="Free Space" value={formatSize(free)} valueColor={colors.accent} last />
            </View>
          </FadeIn>

          {/* Apps Section */}
          <FadeIn delay={450}>
            <Text style={st.sectionTitle}>App Health</Text>
            <View style={st.sectionCard}>
              <StatRow
                icon="apps"
                iconColor={colors.warn}
                label="Unused apps (30+ days)"
                value={usageAccess ? (unusedCount ?? 0).toString() : 'N/A'}
                valueColor={usageAccess && (unusedCount ?? 0) > 0 ? colors.warn : undefined}
                last
              />
            </View>
          </FadeIn>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
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
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  heroRingWrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPct: {
    color: colors.text,
    fontSize: 30,
    fontFamily: fonts.bold,
  },
  heroSub: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: fonts.medium,
  },
  heroStats: {
    flexDirection: 'row',
    marginTop: 20,
    width: '100%',
    justifyContent: 'space-around',
  },
  heroStatItem: { alignItems: 'center' },
  heroStatValue: {
    color: colors.text,
    fontSize: 16,
    fontFamily: fonts.bold,
  },
  heroStatLabel: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: fonts.regular,
    marginTop: 2,
  },
  heroStatDivider: {
    width: 1,
    height: 30,
    backgroundColor: colors.border,
    alignSelf: 'center',
  },

  freedCard: {
    backgroundColor: colors.card,
    borderRadius: 22,
    padding: 22,
    alignItems: 'center',
    marginTop: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  freedIcon: {
    width: 52,
    height: 52,
    borderRadius: 17,
    backgroundColor: 'rgba(92, 235, 107, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  freedValue: {
    color: colors.accent,
    fontSize: 28,
    fontFamily: fonts.bold,
    marginTop: 10,
  },
  freedLabel: {
    color: colors.textSec,
    fontSize: 13,
    fontFamily: fonts.medium,
    marginTop: 2,
  },
  freedCo2Row: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  freedCo2Pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.cardLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  freedCo2Text: {
    color: '#82b1ff',
    fontSize: 12,
    fontFamily: fonts.semiBold,
  },

  sectionTitle: {
    marginTop: 22,
    marginBottom: 6,
    color: colors.text,
    fontSize: 16,
    fontFamily: fonts.semiBold,
  },
  sectionCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  statLabel: {
    color: colors.textSec,
    fontSize: 13,
    fontFamily: fonts.regular,
    flex: 1,
  },
  statValue: {
    color: colors.text,
    fontSize: 14,
    fontFamily: fonts.semiBold,
  },
});
