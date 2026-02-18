import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Dimensions,
  StyleSheet,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fonts } from '../screens/styles';

const { width: SCREEN_W } = Dimensions.get('window');

interface EcoTipModalProps {
  visible: boolean;
  onClose: () => void;
  tip: string | null;
  loading: boolean;
  scanMode: string;
  itemCount: number;
  totalSize: string;
}

const MODE_ICONS: Record<string, string> = {
  junk: 'leaf',
  large: 'lightning-bolt',
  duplicates: 'recycle-variant',
  trash: 'delete-restore',
  empty: 'tree',
  compress: 'package-down',
  whatsapp: 'whatsapp',
  facebook: 'facebook',
  instagram: 'instagram',
};

const MODE_COLORS: Record<string, string> = {
  whatsapp: '#25D366',
  facebook: '#1877F2',
  instagram: '#E4405F',
};

function TypewriterText({ text, style }: { text: string; style: any }) {
  const [displayed, setDisplayed] = useState('');
  const indexRef = useRef(0);

  useEffect(() => {
    setDisplayed('');
    indexRef.current = 0;

    if (!text) return;

    const interval = setInterval(() => {
      indexRef.current += 1;
      if (indexRef.current <= text.length) {
        setDisplayed(text.slice(0, indexRef.current));
      } else {
        clearInterval(interval);
      }
    }, 18);

    return () => clearInterval(interval);
  }, [text]);

  return <Text style={style}>{displayed}</Text>;
}

function FloatingLeaf({ delay }: { delay: number }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timeout = setTimeout(() => {
      Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(opacity, { toValue: 0.3, duration: 600, useNativeDriver: true }),
            Animated.timing(translateY, { toValue: -60, duration: 3000, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
            Animated.timing(translateY, { toValue: 0, duration: 0, useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.timing(translateX, { toValue: 15, duration: 1500, useNativeDriver: true }),
            Animated.timing(translateX, { toValue: -15, duration: 1500, useNativeDriver: true }),
            Animated.timing(translateX, { toValue: 0, duration: 0, useNativeDriver: true }),
          ]),
          Animated.timing(rotate, { toValue: 1, duration: 4000, useNativeDriver: true }),
        ]),
      ).start();
    }, delay);
    return () => clearTimeout(timeout);
  }, [translateY, translateX, opacity, rotate, delay]);

  const spin = rotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        bottom: 30,
        transform: [{ translateY }, { translateX }, { rotate: spin }],
        opacity,
      }}
    >
      <MaterialCommunityIcons name="leaf" size={14} color={colors.accent} />
    </Animated.View>
  );
}

export default function EcoTipModal({
  visible,
  onClose,
  tip,
  loading,
  scanMode,
  itemCount,
  totalSize,
}: EcoTipModalProps) {
  const scaleAnim = useRef(new Animated.Value(0.85)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const iconBounce = useRef(new Animated.Value(0)).current;
  const glowWidth = useRef(new Animated.Value(0)).current;
  const btnScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      scaleAnim.setValue(0.85);
      opacityAnim.setValue(0);
      iconBounce.setValue(0);
      glowWidth.setValue(0);
      btnScale.setValue(0);

      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 7,
          tension: 70,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        Animated.sequence([
          Animated.spring(iconBounce, {
            toValue: 1,
            friction: 4,
            tension: 100,
            useNativeDriver: true,
          }),
          Animated.timing(glowWidth, {
            toValue: 1,
            duration: 600,
            useNativeDriver: false,
          }),
        ]).start();

        Animated.spring(btnScale, {
          toValue: 1,
          friction: 6,
          tension: 60,
          delay: 300,
          useNativeDriver: true,
        }).start();
      });
    } else {
      scaleAnim.setValue(0.85);
      opacityAnim.setValue(0);
    }
  }, [visible, scaleAnim, opacityAnim, iconBounce, glowWidth, btnScale]);

  const icon = MODE_ICONS[scanMode] || 'leaf';
  const accentColor = MODE_COLORS[scanMode] || colors.accent;

  const iconScale = iconBounce.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.3, 1.2, 1],
  });

  const glowWidthInterp = glowWidth.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={ms.backdrop}>
        <Animated.View
          style={[
            ms.card,
            { transform: [{ scale: scaleAnim }], opacity: opacityAnim },
          ]}
        >
          {/* Animated glow strip */}
          <View style={ms.glowStripTrack}>
            <Animated.View style={[ms.glowStripFill, { width: glowWidthInterp, backgroundColor: accentColor }]} />
          </View>

          {/* Floating leaves */}
          <View style={{ position: 'absolute', left: 30, top: 40 }}>
            <FloatingLeaf delay={0} />
          </View>
          <View style={{ position: 'absolute', right: 40, top: 50 }}>
            <FloatingLeaf delay={1200} />
          </View>
          <View style={{ position: 'absolute', left: 60, top: 70 }}>
            <FloatingLeaf delay={2400} />
          </View>

          {/* Icon with bounce */}
          <Animated.View style={[ms.iconCircle, { borderColor: accentColor + '40', transform: [{ scale: iconScale }] }]}>
            <View style={[ms.iconInner, { backgroundColor: accentColor + '15' }]}>
              <MaterialCommunityIcons name={icon as any} size={30} color={accentColor} />
            </View>
          </Animated.View>

          <Text style={ms.title}>Eco Insight</Text>

          {/* Scan summary pill */}
          <View style={ms.summaryPill}>
            <View style={[ms.summaryDot, { backgroundColor: accentColor }]} />
            <Text style={ms.summaryText}>
              {itemCount} item{itemCount !== 1 ? 's' : ''} \u00B7 {totalSize}
            </Text>
          </View>

          {/* Tip content */}
          <View style={ms.tipContainer}>
            {loading ? (
              <View style={ms.loadingWrap}>
                <View style={ms.loadingDots}>
                  <ActivityIndicator color={accentColor} size="small" />
                </View>
                <Text style={ms.loadingText}>Asking Gemini for an eco tip...</Text>
              </View>
            ) : tip ? (
              <TypewriterText text={tip} style={ms.tipText} />
            ) : null}
          </View>

          {/* Close button */}
          <Animated.View style={{ transform: [{ scale: btnScale }] }}>
            <TouchableOpacity
              style={[ms.closeBtn, { backgroundColor: accentColor }]}
              onPress={onClose}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="leaf-circle-outline" size={18} color={colors.bg} />
              <Text style={ms.closeBtnText}>Got it!</Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const ms = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: SCREEN_W - 48,
    backgroundColor: colors.card,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    paddingBottom: 26,
    overflow: 'hidden',
  },
  glowStripTrack: {
    width: '100%',
    height: 3,
    backgroundColor: colors.border,
  },
  glowStripFill: {
    height: '100%',
    borderRadius: 2,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  iconInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontFamily: fonts.semiBold,
    marginTop: 12,
    letterSpacing: 0.5,
  },
  summaryPill: {
    backgroundColor: colors.cardLight,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  summaryDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  summaryText: {
    color: colors.textSec,
    fontSize: 12,
    fontFamily: fonts.medium,
  },
  tipContainer: {
    paddingHorizontal: 22,
    marginTop: 18,
    minHeight: 90,
    justifyContent: 'center',
  },
  tipText: {
    color: colors.textSec,
    fontSize: 14,
    fontFamily: fonts.regular,
    lineHeight: 23,
    textAlign: 'center',
  },
  loadingWrap: {
    alignItems: 'center',
    gap: 12,
  },
  loadingDots: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  loadingText: {
    color: colors.textDim,
    fontSize: 13,
    fontFamily: fonts.regular,
  },
  closeBtn: {
    marginTop: 22,
    paddingHorizontal: 30,
    paddingVertical: 13,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  closeBtnText: {
    color: colors.bg,
    fontSize: 14,
    fontFamily: fonts.semiBold,
  },
});
