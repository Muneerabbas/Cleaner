import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { useDashboard } from './DashboardContext';
import { useNavigation } from '@react-navigation/native';
import { styles } from './styles';

function ProgressRing({
  size,
  stroke,
  progress,
}: {
  size: number;
  stroke: number;
  progress: number;
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
        stroke={styles.ringTrack.stroke}
        strokeWidth={stroke}
        fill="none"
      />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={styles.ringProgress.stroke}
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
  const percent = total > 0 ? used / total : 0;

  const formatGb = (bytes: number) =>
    `${Math.round(bytes / 1024 / 1024 / 1024)}GB`;

  const formatCO2 = () => {
    const GB = savedTodayBytes / 1024 / 1024 / 1024;
    const CO2_PER_GB = 0.02;
    const kg = GB * CO2_PER_GB;
    if (kg >= 0.01) return `${kg.toFixed(2)}kg`;
    const g = kg * 1000;
    if (g >= 0.01) return `${g.toFixed(2)}g`;
    return '0g';
  };

  const formatFreed = () => {
    if (savedTodayBytes <= 0) return '';
    if (savedTodayBytes >= 1024 * 1024 * 1024)
      return `${(savedTodayBytes / 1024 / 1024 / 1024).toFixed(1)} GB freed`;
    if (savedTodayBytes >= 1024 * 1024)
      return `${Math.round(savedTodayBytes / 1024 / 1024)} MB freed`;
    if (savedTodayBytes >= 1024)
      return `${Math.round(savedTodayBytes / 1024)} KB freed`;
    return `${savedTodayBytes} B freed`;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.avatar} />
          <Text style={styles.brand}>EcoCleaner</Text>
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
          <View style={styles.heroCard}>
            <View style={styles.ringWrap}>
              <ProgressRing size={180} stroke={12} progress={percent} />
              <View style={styles.ringCenter}>
                <Text style={styles.ringLabel}>STORAGE</Text>
                <Text style={styles.ringValue}>
                  {Math.round(percent * 100)}%
                </Text>
                <Text style={styles.ringSub}>
                  {formatGb(used)} / {formatGb(total)}
                </Text>
              </View>
            </View>
            <View style={styles.pill}>
              <View style={styles.pillDot} />
              <Text style={styles.pillText}>DEVICE IS OPTIMIZING</Text>
            </View>
          </View>

          <View style={styles.featureCard}>
            <Image
              source={{
                uri: 'https://images.unsplash.com/photo-1501004318641-b39e6451bec6?w=800',
              }}
              style={styles.featureImage}
            />
            <View style={styles.featureOverlay} />
            <View style={styles.featureContent}>
              <Text style={styles.featureLabel}>DIGITAL FOOTPRINT</Text>
              <Text style={styles.featureValue}>
                {formatCO2()} CO2 Saved Today
              </Text>
              <Text style={styles.featureSub}>
                {formatFreed() || 'Delete files to reduce your footprint'}
              </Text>
            </View>
            <TouchableOpacity style={styles.featureAction} activeOpacity={0.8}>
              <Text style={styles.featureActionText}>›</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionTitle}>Quick Optimization</Text>

          <TouchableOpacity
            style={styles.listItem}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Clean' as never)}
          >
            <View style={styles.listIcon}>
              <Text style={styles.listIconText}>🧹</Text>
            </View>
            <View style={styles.listText}>
              <Text style={styles.listTitle}>Storage Cleaner</Text>
              <Text style={styles.listSubtitle}>
                Junk, large files, duplicates & trash
              </Text>
            </View>
            <Text style={styles.listChevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.listItem}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Apps' as never)}
          >
            <View style={styles.listIcon}>
              <Text style={styles.listIconText}>▦</Text>
            </View>
            <View style={styles.listText}>
              <Text style={styles.listTitle}>App Manager</Text>
              <Text style={styles.listSubtitle}>
                {usageAccess
                  ? `${unusedCount ?? 0} apps unused for 30+ days`
                  : 'Enable usage access to scan apps'}
              </Text>
            </View>
            <Text style={styles.listChevron}>›</Text>
          </TouchableOpacity>

          {usageAccess && unusedApps.length > 0 ? (
            <View style={styles.miniList}>
              <View style={styles.miniHeader}>
                <Text style={styles.miniTitle}>Top unused apps</Text>
              </View>
              {unusedApps.map(app => (
                <View key={app.packageName} style={styles.miniRow}>
                  <View style={styles.miniText}>
                    <Text style={styles.miniName}>{app.appName}</Text>
                    <Text style={styles.miniPkg} numberOfLines={1}>
                      {app.packageName}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.appUninstallButton}
                    onPress={() => openAppUninstall(app.packageName)}
                  >
                    <Text style={styles.appUninstallText}>Uninstall</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
