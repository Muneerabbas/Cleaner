import React from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useDashboard } from './DashboardContext';
import { styles, colors } from './styles';

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

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024)
      return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024)
      return `${Math.round(bytes / 1024 / 1024)} MB`;
    if (bytes >= 1024)
      return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  };

  const formatCO2 = (bytes: number) => {
    const GB = bytes / 1024 / 1024 / 1024;
    const kg = GB * 0.02;
    if (kg >= 0.01) return `${kg.toFixed(2)} kg`;
    const g = kg * 1000;
    if (g >= 0.01) return `${g.toFixed(2)} g`;
    return '0 g';
  };

  const percent = total > 0 ? Math.round((used / total) * 100) : 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={[styles.avatar, { backgroundColor: colors.accentDim }]}>
            <MaterialCommunityIcons name="chart-arc" size={18} color={colors.accent} />
          </View>
          <Text style={styles.brand}>Statistics</Text>
          <View style={styles.headerIcons}>
            <MaterialCommunityIcons name="dots-vertical" size={18} color={colors.textSec} />
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={colors.accent} />
          }
        >
          {/* Freed Today Card */}
          <View style={[styles.statsCard, { alignItems: 'center', paddingVertical: 24 }]}>
            <MaterialCommunityIcons name="leaf" size={32} color={colors.accent} />
            <Text style={[styles.statBigValue, { marginTop: 8 }]}>
              {savedTodayBytes > 0 ? formatSize(savedTodayBytes) : '0 B'}
            </Text>
            <Text style={[styles.listSubtitle, { marginTop: 2 }]}>Freed Today</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 4 }}>
              <MaterialCommunityIcons name="molecule-co2" size={16} color={colors.textSec} />
              <Text style={styles.listSubtitle}>{formatCO2(savedTodayBytes)} CO2 saved</Text>
            </View>
          </View>

          {/* Storage Breakdown */}
          <Text style={styles.sectionTitle}>Storage</Text>
          <View style={styles.statsCard}>
            <View style={styles.statRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <MaterialCommunityIcons name="harddisk" size={20} color={colors.accent} />
                <Text style={styles.statLabel}>Total</Text>
              </View>
              <Text style={styles.statValue}>{formatSize(total)}</Text>
            </View>
            <View style={styles.statRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <MaterialCommunityIcons name="database" size={20} color={colors.warn} />
                <Text style={styles.statLabel}>Used</Text>
              </View>
              <Text style={styles.statValue}>{formatSize(used)} ({percent}%)</Text>
            </View>
            <View style={[styles.statRow, { borderBottomWidth: 0 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <MaterialCommunityIcons name="check-circle-outline" size={20} color={colors.accent} />
                <Text style={styles.statLabel}>Free</Text>
              </View>
              <Text style={[styles.statValue, { color: colors.accent }]}>{formatSize(free)}</Text>
            </View>
          </View>

          {/* Environmental Impact */}
          <Text style={styles.sectionTitle}>Environmental Impact</Text>
          <View style={styles.statsCard}>
            <View style={styles.statRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <MaterialCommunityIcons name="molecule-co2" size={20} color={colors.textSec} />
                <Text style={styles.statLabel}>CO2 from used storage</Text>
              </View>
              <Text style={styles.statValue}>{formatCO2(used)}</Text>
            </View>
            <View style={[styles.statRow, { borderBottomWidth: 0 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <MaterialCommunityIcons name="leaf" size={20} color={colors.accent} />
                <Text style={styles.statLabel}>CO2 saved today</Text>
              </View>
              <Text style={[styles.statValue, { color: colors.accent }]}>{formatCO2(savedTodayBytes)}</Text>
            </View>
          </View>

          {/* Apps */}
          <Text style={styles.sectionTitle}>Apps</Text>
          <View style={styles.statsCard}>
            <View style={[styles.statRow, { borderBottomWidth: 0 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <MaterialCommunityIcons name="apps" size={20} color={colors.textSec} />
                <Text style={styles.statLabel}>Unused apps (30+ days)</Text>
              </View>
              <Text style={styles.statValue}>
                {usageAccess ? (unusedCount ?? 0).toString() : 'N/A'}
              </Text>
            </View>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
