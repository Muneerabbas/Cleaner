import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Animated,
  Easing,
  StyleSheet,
  Dimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { colors, fonts } from './styles';
import { useDashboard } from './DashboardContext';

const { width: SCREEN_W } = Dimensions.get('window');
const RING_SIZE = 220;
const RING_STROKE = 14;

type BoostPhase = 'idle' | 'ram' | 'cache' | 'cpu' | 'battery' | 'done';

const PHASES: { key: BoostPhase; label: string; icon: string; color: string; duration: number }[] = [
  { key: 'ram', label: 'Optimizing RAM', icon: 'memory', color: '#82B1FF', duration: 1200 },
  { key: 'cache', label: 'Clearing Cache', icon: 'cached', color: '#5ceb6b', duration: 1800 },
  { key: 'cpu', label: 'Cooling CPU', icon: 'chip', color: '#FFD93D', duration: 1000 },
  { key: 'battery', label: 'Battery Saver', icon: 'battery-charging-high', color: '#FF6B6B', duration: 800 },
];

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function RippleRing({ active }: { active: boolean }) {
  const scale1 = useRef(new Animated.Value(1)).current;
  const scale2 = useRef(new Animated.Value(1)).current;
  const opacity1 = useRef(new Animated.Value(0.4)).current;
  const opacity2 = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (!active) {
      scale1.setValue(1);
      scale2.setValue(1);
      opacity1.setValue(0);
      opacity2.setValue(0);
      return;
    }

    const pulse = (scale: Animated.Value, opacity: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.timing(scale, { toValue: 1.6, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0, duration: 1400, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0.35, duration: 0, useNativeDriver: true }),
          ]),
        ]),
      );

    const a1 = pulse(scale1, opacity1, 0);
    const a2 = pulse(scale2, opacity2, 700);
    a1.start();
    a2.start();
    return () => { a1.stop(); a2.stop(); };
  }, [active, scale1, scale2, opacity1, opacity2]);

  const ringStyle = {
    position: 'absolute' as const,
    width: RING_SIZE + 40,
    height: RING_SIZE + 40,
    borderRadius: (RING_SIZE + 40) / 2,
    borderWidth: 2,
    borderColor: colors.accent,
  };

  return (
    <>
      <Animated.View style={[ringStyle, { transform: [{ scale: scale1 }], opacity: opacity1 }]} />
      <Animated.View style={[ringStyle, { transform: [{ scale: scale2 }], opacity: opacity2 }]} />
    </>
  );
}

function Particle({ delay, angle }: { delay: number; angle: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0)).current;

  const dx = Math.cos((angle * Math.PI) / 180) * 120;
  const dy = Math.sin((angle * Math.PI) / 180) * 120;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(translateX, { toValue: dx, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(translateY, { toValue: dy, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 600, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 0.3, duration: 600, useNativeDriver: true }),
      ]),
    ]).start();
  }, [delay, dx, dy, opacity, translateX, translateY, scale]);

  const hue = (angle * 2) % 360;
  const particleColor = `hsl(${hue}, 80%, 65%)`;

  return (
    <Animated.View
      style={{
        position: 'absolute',
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: particleColor,
        opacity,
        transform: [{ translateX }, { translateY }, { scale }],
      }}
    />
  );
}

function PhaseCard({
  icon,
  label,
  color,
  active,
  completed,
  index,
}: {
  icon: string;
  label: string;
  color: string;
  active: boolean;
  completed: boolean;
  index: number;
}) {
  const slideX = useRef(new Animated.Value(40)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, delay: index * 80, useNativeDriver: true }),
      Animated.spring(slideX, { toValue: 0, friction: 8, delay: index * 80, useNativeDriver: true }),
    ]).start();
  }, [opacity, slideX, index]);

  useEffect(() => {
    if (active) {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseScale, { toValue: 1.04, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseScale, { toValue: 1, duration: 500, useNativeDriver: true }),
        ]),
      );
      anim.start();
      return () => anim.stop();
    }
    pulseScale.setValue(1);
  }, [active, pulseScale]);

  return (
    <Animated.View
      style={[
        s.phaseCard,
        {
          opacity,
          transform: [{ translateX: slideX }, { scale: pulseScale }],
          borderColor: active ? color : completed ? colors.accentDim : colors.border,
          backgroundColor: active ? color + '10' : colors.card,
        },
      ]}
    >
      <View style={[s.phaseIcon, { backgroundColor: color + '18' }]}>
        {completed ? (
          <MaterialCommunityIcons name="check-circle" size={22} color={colors.accent} />
        ) : (
          <MaterialCommunityIcons name={icon as any} size={22} color={active ? color : colors.textDim} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.phaseLabel, active && { color: colors.text }]}>{label}</Text>
        <Text style={[s.phaseSub, active && { color }]}>
          {completed ? 'Optimized' : active ? 'In progress...' : 'Pending'}
        </Text>
      </View>
      {active && (
        <View style={[s.activeIndicator, { backgroundColor: color }]} />
      )}
    </Animated.View>
  );
}

export default function SystemBoosterScreen() {
  const navigation = useNavigation();
  const { clearJunk, clearing, savedTodayBytes, refreshAll } = useDashboard();
  const [phase, setPhase] = useState<BoostPhase>('idle');
  const [completedPhases, setCompletedPhases] = useState<Set<BoostPhase>>(new Set());
  const [progress, setProgress] = useState(0);
  const [boostedBytes, setBoostedBytes] = useState(0);
  const [showParticles, setShowParticles] = useState(false);

  const spinValue = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const doneScale = useRef(new Animated.Value(0)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeIn, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, [fadeIn]);

  const radius = (RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;

  useEffect(() => {
    if (phase !== 'idle' && phase !== 'done') {
      const anim = Animated.loop(
        Animated.timing(spinValue, {
          toValue: 1,
          duration: 2000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      anim.start();
      return () => anim.stop();
    }
    spinValue.setValue(0);
  }, [phase, spinValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const runBoost = useCallback(async () => {
    if (phase !== 'idle' && phase !== 'done') return;
    setCompletedPhases(new Set());
    setProgress(0);
    setBoostedBytes(0);
    setShowParticles(false);
    doneScale.setValue(0);

    let totalProgress = 0;
    const totalDuration = PHASES.reduce((s, p) => s + p.duration, 0);

    for (const p of PHASES) {
      setPhase(p.key);
      const step = p.duration / totalDuration;

      if (p.key === 'cache' && Platform.OS === 'android') {
        try {
          await clearJunk();
          await refreshAll();
        } catch {
          // Continue boost even if cache clear fails
        }
      } else {
        await new Promise<void>((resolve) => setTimeout(resolve, p.duration));
      }

      totalProgress += step;
      setProgress(Math.min(totalProgress, 1));
      Animated.timing(progressAnim, {
        toValue: Math.min(totalProgress, 1),
        duration: 300,
        useNativeDriver: false,
      }).start();

      setCompletedPhases((prev) => new Set(prev).add(p.key));
    }

    const randomBoost = Math.floor(Math.random() * 80 + 40) * 1024 * 1024;
    setBoostedBytes(randomBoost);
    setPhase('done');
    setShowParticles(true);

    Animated.spring(doneScale, {
      toValue: 1,
      friction: 5,
      tension: 60,
      useNativeDriver: true,
    }).start();
  }, [phase, clearJunk, refreshAll, progressAnim, doneScale]);

  const phaseColor =
    phase === 'done'
      ? colors.accent
      : PHASES.find((p) => p.key === phase)?.color ?? colors.accent;

  const progressDash = circumference * progress;

  return (
    <SafeAreaView style={s.safe}>
      <Animated.View style={[s.root, { opacity: fadeIn }]}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4, marginRight: 4 }}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={colors.text} />
          </TouchableOpacity>
          <MaterialCommunityIcons name="rocket-launch" size={20} color={colors.accent} style={{ marginRight: 8 }} />
          <Text style={s.headerTitle}>System Booster</Text>
        </View>

        {/* Main Content */}
        <ScrollView
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Ring + Button */}
          <View style={s.ringArea}>
            <RippleRing active={phase !== 'idle' && phase !== 'done'} />

            <View style={{ width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={RING_SIZE} height={RING_SIZE}>
                <Defs>
                  <LinearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
                    <Stop offset="0" stopColor={phaseColor} />
                    <Stop offset="1" stopColor={colors.accent} />
                  </LinearGradient>
                </Defs>
                <Circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={radius}
                  stroke={colors.border}
                  strokeWidth={RING_STROKE}
                  fill="none"
                />
                {progress > 0 && (
                  <Circle
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={radius}
                    stroke="url(#grad)"
                    strokeWidth={RING_STROKE}
                    fill="none"
                    strokeDasharray={`${progressDash} ${circumference - progressDash}`}
                    strokeLinecap="round"
                    rotation={-90}
                    originX={RING_SIZE / 2}
                    originY={RING_SIZE / 2}
                  />
                )}
              </Svg>

              <View style={{ position: 'absolute', alignItems: 'center' }}>
                {phase === 'idle' ? (
                  <TouchableOpacity style={s.boostBtn} onPress={runBoost} activeOpacity={0.85}>
                    <Animated.View style={{ transform: [{ rotate: spin }] }}>
                      <MaterialCommunityIcons name="rocket-launch" size={36} color={colors.bg} />
                    </Animated.View>
                    <Text style={s.boostBtnText}>BOOST</Text>
                  </TouchableOpacity>
                ) : phase === 'done' ? (
                  <Animated.View style={{ alignItems: 'center', transform: [{ scale: doneScale }] }}>
                    <MaterialCommunityIcons name="check-circle" size={44} color={colors.accent} />
                    <Text style={s.doneValue}>{formatBytes(boostedBytes)}</Text>
                    <Text style={s.doneSub}>Optimized</Text>
                  </Animated.View>
                ) : (
                  <View style={{ alignItems: 'center' }}>
                    <Animated.View style={{ transform: [{ rotate: spin }] }}>
                      <MaterialCommunityIcons
                        name={(PHASES.find((p) => p.key === phase)?.icon ?? 'cog') as any}
                        size={36}
                        color={phaseColor}
                      />
                    </Animated.View>
                    <Text style={[s.progressText, { color: phaseColor }]}>
                      {Math.round(progress * 100)}%
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {showParticles && (
              <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <Particle key={i} delay={i * 50} angle={i * 30} />
                ))}
              </View>
            )}
          </View>

          {/* Status Text */}
          <Text style={s.statusText}>
            {phase === 'idle'
              ? 'Tap to optimize your device'
              : phase === 'done'
                ? 'Your device is now optimized!'
                : PHASES.find((p) => p.key === phase)?.label ?? 'Working...'}
          </Text>

          {/* Carbon badge */}
          <View style={s.carbonBadge}>
            <MaterialCommunityIcons name="leaf" size={14} color={colors.accent} />
            <Text style={s.carbonText}>
              {formatBytes(savedTodayBytes)} freed today
            </Text>
          </View>

          {/* Phase Cards */}
          <View style={s.phaseList}>
            {PHASES.map((p, i) => (
              <PhaseCard
                key={p.key}
                icon={p.icon}
                label={p.label}
                color={p.color}
                active={phase === p.key}
                completed={completedPhases.has(p.key)}
                index={i}
              />
            ))}
          </View>

          {/* Boost Again */}
          {phase === 'done' && (
            <TouchableOpacity style={s.againBtn} onPress={runBoost} activeOpacity={0.8}>
              <MaterialCommunityIcons name="refresh" size={18} color={colors.bg} />
              <Text style={s.againBtnText}>Boost Again</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  root: { flex: 1, backgroundColor: colors.bg },
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
  content: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 120,
  },
  ringArea: {
    width: RING_SIZE + 60,
    height: RING_SIZE + 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  boostBtn: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  boostBtnText: {
    color: colors.bg,
    fontSize: 13,
    fontFamily: fonts.bold,
    letterSpacing: 2,
    marginTop: 2,
  },
  progressText: {
    fontSize: 22,
    fontFamily: fonts.bold,
    marginTop: 4,
  },
  doneValue: {
    color: colors.accent,
    fontSize: 20,
    fontFamily: fonts.bold,
    marginTop: 4,
  },
  doneSub: {
    color: colors.textSec,
    fontSize: 12,
    fontFamily: fonts.medium,
  },
  statusText: {
    color: colors.textSec,
    fontSize: 14,
    fontFamily: fonts.medium,
    marginTop: 8,
    textAlign: 'center',
  },
  carbonBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accentBg,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.accentDim,
  },
  carbonText: {
    color: colors.accent,
    fontSize: 12,
    fontFamily: fonts.semiBold,
  },
  phaseList: {
    width: '100%',
    marginTop: 20,
    gap: 8,
  },
  phaseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  phaseIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  phaseLabel: {
    color: colors.textSec,
    fontSize: 14,
    fontFamily: fonts.semiBold,
  },
  phaseSub: {
    color: colors.textDim,
    fontSize: 11,
    fontFamily: fonts.regular,
    marginTop: 1,
  },
  activeIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  againBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.accent,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 16,
    marginTop: 20,
    elevation: 4,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  againBtnText: {
    color: colors.bg,
    fontSize: 15,
    fontFamily: fonts.semiBold,
  },
});
