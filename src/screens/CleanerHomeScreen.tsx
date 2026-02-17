import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { styles } from './styles';

export type CleanerMode = 'junk' | 'large' | 'duplicates' | 'trash' | 'empty';

const TILES: { key: CleanerMode; title: string; subtitle: string; icon: string }[] = [
  { key: 'junk', title: 'Junk Files', subtitle: 'Cache & temp files', icon: '🗑' },
  { key: 'large', title: 'Large Files', subtitle: '100MB+ files', icon: '📦' },
  { key: 'duplicates', title: 'Duplicates', subtitle: 'Same content, multiple copies', icon: '📋' },
  { key: 'trash', title: 'Trash', subtitle: 'Restore or delete forever', icon: '♻' },
  { key: 'empty', title: 'Empty Folders', subtitle: 'Remove empty directories', icon: '📁' },
];

export default function CleanerHomeScreen() {
  const navigation = useNavigation();

  const isAndroid = Platform.OS === 'android';

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.avatar} />
          <Text style={styles.brand}>Storage Cleaner</Text>
          <View style={styles.headerIcons} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {!isAndroid ? (
            <View style={styles.accessCard}>
              <Text style={styles.accessTitle}>Android only</Text>
              <Text style={styles.accessSub}>
                Storage cleaning (scan, junk, large files, duplicates, trash) runs on the native Android module. Use an Android device or emulator.
              </Text>
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>Quick Clean</Text>
          {TILES.map((tile) => (
            <TouchableOpacity
              key={tile.key}
              style={styles.listItem}
              activeOpacity={0.8}
              onPress={() =>
                isAndroid &&
                navigation.navigate('CleanerList' as never, { mode: tile.key } as never)
              }
              disabled={!isAndroid}
            >
              <View style={styles.listIcon}>
                <Text style={styles.listIconText}>{tile.icon}</Text>
              </View>
              <View style={styles.listText}>
                <Text style={styles.listTitle}>{tile.title}</Text>
                <Text style={styles.listSubtitle}>{tile.subtitle}</Text>
              </View>
              {isAndroid ? (
                <Text style={styles.listChevron}>›</Text>
              ) : null}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
