import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { styles, colors } from './styles';

export type CleanerMode = 'junk' | 'large' | 'duplicates' | 'trash' | 'empty';

type TileConfig = {
  key: CleanerMode;
  title: string;
  subtitle: string;
  icon: string;
  iconBg: string;
  iconColor: string;
};

const TILES: TileConfig[] = [
  {
    key: 'junk',
    title: 'Junk Files',
    subtitle: 'Cache & temp files',
    icon: 'delete-sweep',
    iconBg: 'rgba(255, 171, 64, 0.12)',
    iconColor: '#ffab40',
  },
  {
    key: 'large',
    title: 'Large Files',
    subtitle: '100 MB+ files',
    icon: 'file-alert',
    iconBg: 'rgba(92, 235, 107, 0.12)',
    iconColor: colors.accent,
  },
  {
    key: 'duplicates',
    title: 'Duplicates',
    subtitle: 'Same content, copies',
    icon: 'content-copy',
    iconBg: 'rgba(130, 177, 255, 0.12)',
    iconColor: '#82b1ff',
  },
  {
    key: 'trash',
    title: 'Trash',
    subtitle: 'Restore or delete',
    icon: 'delete-restore',
    iconBg: 'rgba(255, 107, 107, 0.12)',
    iconColor: colors.danger,
  },
  {
    key: 'empty',
    title: 'Empty Folders',
    subtitle: 'Remove clutter',
    icon: 'folder-off-outline',
    iconBg: 'rgba(178, 160, 255, 0.12)',
    iconColor: '#b2a0ff',
  },
];

export default function CleanerHomeScreen() {
  const navigation = useNavigation();
  const isAndroid = Platform.OS === 'android';

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={[styles.avatar, { backgroundColor: colors.accentDim }]}>
            <MaterialCommunityIcons name="broom" size={18} color={colors.accent} />
          </View>
          <Text style={styles.brand}>Storage Cleaner</Text>
          <View style={styles.headerIcons}>
            <MaterialCommunityIcons name="cog-outline" size={18} color={colors.textSec} />
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {!isAndroid && (
            <View style={styles.accessCard}>
              <MaterialCommunityIcons name="android" size={32} color={colors.textSec} />
              <Text style={[styles.accessTitle, { marginTop: 8 }]}>Android Only</Text>
              <Text style={styles.accessSub}>
                Storage cleaning requires the native Android module.
              </Text>
            </View>
          )}

          <Text style={styles.sectionTitle}>Quick Clean</Text>

          <TouchableOpacity
            style={[styles.listItem, { marginTop: 8 }]}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('DiskIntel' as never)}
          >
            <View style={styles.listIcon}>
              <MaterialCommunityIcons name="api" size={22} color={colors.accent} />
            </View>
            <View style={styles.listText}>
              <Text style={styles.listTitle}>Disk Intelligence API</Text>
              <Text style={styles.listSubtitle}>Scan, analyze, duplicates, safe cleanup</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.accent} />
          </TouchableOpacity>

          <View style={styles.tileContainer}>
            {TILES.map((tile) => (
              <TouchableOpacity
                key={tile.key}
                style={styles.tile}
                activeOpacity={0.7}
                onPress={() =>
                  isAndroid &&
                  navigation.navigate('CleanerList' as never, { mode: tile.key } as never)
                }
                disabled={!isAndroid}
              >
                <View style={[styles.tileIconWrap, { backgroundColor: tile.iconBg }]}>
                  <MaterialCommunityIcons name={tile.icon as any} size={24} color={tile.iconColor} />
                </View>
                <View>
                  <Text style={styles.tileTitle}>{tile.title}</Text>
                  <Text style={styles.tileSub}>{tile.subtitle}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
