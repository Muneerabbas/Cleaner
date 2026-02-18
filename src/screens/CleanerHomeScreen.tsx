import React, { useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Platform, Animated, Dimensions, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors, fonts } from './styles';
import { useDashboard } from './DashboardContext';

const { width: SCREEN_W } = Dimensions.get('window');
const TILE_GAP = 10;
const TILE_W = (SCREEN_W - 40 - TILE_GAP) / 2;

export type CleanerMode = 'junk' | 'large' | 'duplicates' | 'trash' | 'empty' | 'compress';

type TileConfig = {
  key: CleanerMode;
  title: string;
  subtitle: string;
  icon: string;
  iconBg: string;
  iconColor: string;
};

const TILES: TileConfig[] = [
  { key: 'junk', title: 'Junk Files', subtitle: 'Cache & temp files', icon: 'delete-sweep', iconBg: 'rgba(255, 171, 64, 0.12)', iconColor: '#ffab40' },
  { key: 'large', title: 'Large Files', subtitle: '100 MB+ files', icon: 'file-alert', iconBg: 'rgba(92, 235, 107, 0.12)', iconColor: colors.accent },
  { key: 'duplicates', title: 'Duplicates', subtitle: 'Same content, copies', icon: 'content-copy', iconBg: 'rgba(130, 177, 255, 0.12)', iconColor: '#82b1ff' },
  { key: 'trash', title: 'Trash', subtitle: 'Restore or delete', icon: 'delete-restore', iconBg: 'rgba(255, 107, 107, 0.12)', iconColor: colors.danger },
  { key: 'empty', title: 'Empty Folders', subtitle: 'Remove clutter', icon: 'folder-off-outline', iconBg: 'rgba(178, 160, 255, 0.12)', iconColor: '#b2a0ff' },
  { key: 'compress', title: 'Compressor', subtitle: 'Zip large files', icon: 'folder-zip-outline', iconBg: 'rgba(124, 179, 66, 0.12)', iconColor: '#7cb342' },
];

type SocialApp = { key: string; name: string; icon: string; color: string; bgColor: string };

const SOCIAL_APPS: SocialApp[] = [
  { key: 'whatsapp', name: 'WhatsApp', icon: 'whatsapp', color: '#25D366', bgColor: 'rgba(37, 211, 102, 0.12)' },
  { key: 'facebook', name: 'Facebook', icon: 'facebook', color: '#1877F2', bgColor: 'rgba(24, 119, 242, 0.12)' },
  { key: 'instagram', name: 'Instagram', icon: 'instagram', color: '#E4405F', bgColor: 'rgba(228, 64, 95, 0.12)' },
];

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

function AnimatedTile({ children, index }: { children: React.ReactNode; index: number }) {
  const scale = useRef(new Animated.Value(0.85)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 6, tension: 60, delay: 300 + index * 70, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 350, delay: 300 + index * 70, useNativeDriver: true }),
    ]).start();
  }, [scale, opacity, index]);

  return <Animated.View style={{ transform: [{ scale }], opacity }}>{children}</Animated.View>;
}

export default function CleanerHomeScreen() {
  const navigation = useNavigation();
  const isAndroid = Platform.OS === 'android';
  const { savedTodayBytes } = useDashboard();

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  };

  const formatCO2 = (bytes: number) => {
    const kg = (bytes / 1024 / 1024 / 1024) * 0.02;
    if (kg >= 0.01) return `${kg.toFixed(2)} kg`;
    const g = kg * 1000;
    if (g >= 0.01) return `${g.toFixed(2)} g`;
    return '0 g';
  };

  return (
    <SafeAreaView style={cs.safe}>
      <View style={cs.root}>
        {/* Header */}
        <FadeIn delay={0}>
          <View style={cs.header}>
            <View style={cs.avatar}>
              <MaterialCommunityIcons name="broom" size={18} color={colors.accent} />
            </View>
            <Text style={cs.brand}>Storage Cleaner</Text>
           
          </View>
        </FadeIn>

        <ScrollView contentContainerStyle={cs.scroll} showsVerticalScrollIndicator={false}>
          {!isAndroid && (
            <View style={cs.accessCard}>
              <MaterialCommunityIcons name="android" size={32} color={colors.textSec} />
              <Text style={cs.accessTitle}>Android Only</Text>
              <Text style={cs.accessSub}>Storage cleaning requires the native Android module.</Text>
            </View>
          )}

          {/* Impact Banner */}
          <FadeIn delay={50}>
            <View style={cs.impactCard}>
              <View style={cs.impactIcon}>
                <MaterialCommunityIcons name="leaf" size={22} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={cs.impactLabel}>TODAY'S IMPACT</Text>
                <Text style={cs.impactValue}>
                  {savedTodayBytes > 0 ? formatSize(savedTodayBytes) : '0 B'} freed
                </Text>
              </View>
              <View style={cs.co2Pill}>
                <MaterialCommunityIcons name="molecule-co2" size={14} color="#82b1ff" />
                <Text style={cs.co2Text}>{formatCO2(savedTodayBytes)}</Text>
              </View>
            </View>
          </FadeIn>

          {/* Social Media */}
          <FadeIn delay={100}>
            <Text style={cs.sectionTitle}>Social Media</Text>
          </FadeIn>

          <FadeIn delay={160}>
            <TouchableOpacity
              style={cs.socialCard}
              activeOpacity={0.75}
              onPress={() => isAndroid && navigation.navigate('SocialCleaner' as never)}
              disabled={!isAndroid}
            >
              <View style={cs.socialHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={cs.socialTitle}>Clean Social Apps</Text>
                  <Text style={cs.socialSub}>WhatsApp, Facebook, Instagram cache & media</Text>
                </View>
                <View style={cs.socialArrow}>
                  <MaterialCommunityIcons name="chevron-right" size={18} color={colors.accent} />
                </View>
              </View>
              <View style={cs.socialRow}>
                {SOCIAL_APPS.map((app) => (
                  <View key={app.key} style={[cs.socialChip, { backgroundColor: app.bgColor }]}>
                    <MaterialCommunityIcons name={app.icon as any} size={22} color={app.color} />
                    <Text style={[cs.socialChipText, { color: app.color }]}>{app.name}</Text>
                  </View>
                ))}
              </View>
            </TouchableOpacity>
          </FadeIn>

          {/* Quick Clean */}
          <FadeIn delay={220}>
            <Text style={cs.sectionTitle}>Quick Clean</Text>
          </FadeIn>

          <FadeIn delay={260}>
            <TouchableOpacity
              style={cs.diskIntelCard}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('DiskIntel' as never)}
            >
              <View style={cs.diskIntelIcon}>
                <MaterialCommunityIcons name="api" size={22} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={cs.diskIntelTitle}>Disk Intelligence</Text>
                <Text style={cs.diskIntelSub}>Deep scan, analysis & smart cleanup</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.accent} />
            </TouchableOpacity>
          </FadeIn>

          {/* Tool Tiles */}
          <View style={cs.tileGrid}>
            {TILES.map((tile, index) => (
              <AnimatedTile key={tile.key} index={index}>
                <TouchableOpacity
                  style={cs.tile}
                  activeOpacity={0.7}
                  onPress={() =>
                    isAndroid &&
                    navigation.navigate('CleanerList' as never, { mode: tile.key } as never)
                  }
                  disabled={!isAndroid}
                >
                  <View style={[cs.tileIcon, { backgroundColor: tile.iconBg }]}>
                    <MaterialCommunityIcons name={tile.icon as any} size={24} color={tile.iconColor} />
                  </View>
                  <Text style={cs.tileTitle}>{tile.title}</Text>
                  <Text style={cs.tileSub}>{tile.subtitle}</Text>
                </TouchableOpacity>
              </AnimatedTile>
            ))}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const cs = StyleSheet.create({
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

  accessCard: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 20,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  accessTitle: {
    color: colors.text,
    fontSize: 16,
    fontFamily: fonts.semiBold,
    marginTop: 8,
  },
  accessSub: {
    color: colors.textSec,
    fontSize: 13,
    fontFamily: fonts.regular,
    marginTop: 6,
    textAlign: 'center',
  },

  impactCard: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  impactIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: 'rgba(92, 235, 107, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  impactLabel: {
    color: colors.textDim,
    fontSize: 10,
    fontFamily: fonts.semiBold,
    letterSpacing: 1,
  },
  impactValue: {
    color: colors.text,
    fontSize: 17,
    fontFamily: fonts.bold,
    marginTop: 1,
  },
  co2Pill: {
    backgroundColor: 'rgba(130, 177, 255, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  co2Text: {
    color: '#82b1ff',
    fontSize: 12,
    fontFamily: fonts.semiBold,
  },

  sectionTitle: {
    marginTop: 22,
    marginBottom: 4,
    color: colors.text,
    fontSize: 16,
    fontFamily: fonts.semiBold,
  },

  socialCard: {
    backgroundColor: colors.card,
    borderRadius: 22,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  socialHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  socialTitle: {
    color: colors.text,
    fontSize: 15,
    fontFamily: fonts.semiBold,
  },
  socialSub: {
    color: colors.textSec,
    fontSize: 12,
    fontFamily: fonts.regular,
    marginTop: 2,
  },
  socialArrow: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.accentBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialRow: { flexDirection: 'row', gap: 10 },
  socialChip: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 6,
  },
  socialChipText: {
    fontSize: 11,
    fontFamily: fonts.semiBold,
  },

  diskIntelCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 14,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  diskIntelIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: colors.accentBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accentDim,
    marginRight: 14,
  },
  diskIntelTitle: {
    color: colors.text,
    fontSize: 15,
    fontFamily: fonts.semiBold,
  },
  diskIntelSub: {
    color: colors.textSec,
    fontSize: 12,
    fontFamily: fonts.regular,
    marginTop: 2,
  },

  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: TILE_GAP,
    marginTop: 14,
  },
  tile: {
    width: TILE_W,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 125,
    justifyContent: 'space-between',
  },
  tileIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  tileTitle: {
    color: colors.text,
    fontSize: 14,
    fontFamily: fonts.semiBold,
    marginTop: 4,
  },
  tileSub: {
    color: colors.textSec,
    fontSize: 11,
    fontFamily: fonts.regular,
    marginTop: 2,
  },
});
