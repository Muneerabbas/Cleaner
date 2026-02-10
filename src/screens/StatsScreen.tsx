import React from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDashboard } from './DashboardContext';
import { styles } from './styles';

export default function StatsScreen() {
  const {
    storage,
    savedTodayBytes,
    unusedCount,
    refreshing,
    refreshAll,
  } = useDashboard();

  const formatGb = (bytes: number) =>
    `${Math.round(bytes / 1024 / 1024 / 1024)}GB`;

  const sizeToCo2Kg = (bytes: number) => {
    const GB = bytes / 1024 / 1024 / 1024;
    const CO2_PER_GB = 0.02;
    return GB * CO2_PER_GB;
  };

  const used = storage?.usedBytes ?? 0;
  const total = storage?.totalBytes ?? 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.avatar} />
          <Text style={styles.brand}>Stats</Text>
          <View style={styles.headerIcons}>
            <Text style={styles.icon}>🔔</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refreshAll}
              tintColor="#9fe6a6"
            />
          }
        >
          <View style={styles.statsCard}>
            <Text style={styles.sectionTitle}>Overview</Text>
            <Text style={styles.listSubtitle}>
              Storage used: {formatGb(used)} / {formatGb(total)} •{' '}
              {sizeToCo2Kg(used).toFixed(2)}kg CO2
            </Text>
            <Text style={styles.listSubtitle}>
              CO2 saved today: {sizeToCo2Kg(savedTodayBytes).toFixed(2)}kg
            </Text>
            <Text style={styles.listSubtitle}>
              Unused apps (30+ days): {unusedCount ?? 0}
            </Text>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
