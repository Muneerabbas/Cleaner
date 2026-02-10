import React, { useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Image,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useDashboard } from './DashboardContext';
import { styles } from './styles';

export default function AppsScreen() {
  const {
    usageAccess,
    appsStorage,
    appsLoading,
    refreshing,
    refreshAll,
    refreshAppsStorage,
    openUsageAccessSettings,
    openAppUninstall,
  } = useDashboard();

  useFocusEffect(
    React.useCallback(() => {
      refreshAppsStorage().catch(() => {});
    }, [refreshAppsStorage]),
  );

  useEffect(() => {
    if (usageAccess) {
      refreshAppsStorage().catch(() => {});
    }
  }, [usageAccess, refreshAppsStorage]);

  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
    }
    return `${Math.max(0, Math.round(bytes / 1024 / 1024))}MB`;
  };

  const sizeToCo2Kg = (bytes: number) => {
    const GB = bytes / 1024 / 1024 / 1024;
    const CO2_PER_GB = 0.02;
    return GB * CO2_PER_GB;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.avatar} />
          <Text style={styles.brand}>App Manager</Text>
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
              onRefresh={async () => {
                await refreshAll();
                await refreshAppsStorage();
              }}
              tintColor="#9fe6a6"
            />
          }
        >
          {!usageAccess ? (
            <View style={styles.accessCard}>
              <Text style={styles.accessTitle}>Enable Usage Access</Text>
              <Text style={styles.accessSub}>
                Required to show app storage and usage.
              </Text>
              <TouchableOpacity
                style={styles.accessButton}
                onPress={openUsageAccessSettings}
              >
                <Text style={styles.accessButtonText}>Open Settings</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.appsCard}>
            <View style={styles.appsHeader}>
              <Text style={styles.sectionTitle}>Installed Apps</Text>
            </View>
            {appsLoading ? (
              <View>
                <ActivityIndicator color="#9fe6a6" />
                <Text style={styles.listSubtitle}>Loading apps...</Text>
              </View>
            ) : appsStorage.length === 0 ? (
              <Text style={styles.listSubtitle}>
                No apps found. Pull to refresh.
              </Text>
            ) : (
              appsStorage.map(app => (
                <View key={app.packageName} style={styles.appRow}>
                  <View style={styles.appIconWrap}>
                    {app.iconBase64 ? (
                      <Image
                        source={{
                          uri: `data:image/png;base64,${app.iconBase64}`,
                        }}
                        style={styles.appIcon}
                      />
                    ) : (
                      <View style={styles.appIconFallback} />
                    )}
                  </View>
                  <View style={styles.appText}>
                    <Text style={styles.appName}>{app.appName}</Text>
                    <Text style={styles.appPkg} numberOfLines={1}>
                      {app.packageName}
                    </Text>
                  </View>
                  <View style={styles.appRight}>
                    <Text style={styles.appSize}>
                      {formatBytes(
                        app.appBytes + app.dataBytes + app.cacheBytes,
                      )}{' '}
                      •{' '}
                      {sizeToCo2Kg(
                        app.appBytes + app.dataBytes + app.cacheBytes,
                      ).toFixed(3)}
                      kg CO2
                    </Text>
                    <TouchableOpacity
                      style={styles.appUninstallButton}
                      onPress={() => openAppUninstall(app.packageName)}
                    >
                      <Text style={styles.appUninstallText}>Uninstall</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
