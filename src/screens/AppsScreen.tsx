import React, { useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useDashboard } from './DashboardContext';
import { styles, colors } from './styles';

export default function AppsScreen() {
  const {
    usageAccess,
    appsStorage,
    appsLoading,
    refreshing,
    refreshAll,
    refreshAppsStorage,
    recheckUsageAccess,
    openUsageAccessSettings,
    openAppUninstall,
  } = useDashboard();

  useFocusEffect(
    React.useCallback(() => {
      recheckUsageAccess().catch(() => {});
      refreshAppsStorage().catch(() => {});
    }, [recheckUsageAccess, refreshAppsStorage]),
  );

  useEffect(() => {
    if (usageAccess) refreshAppsStorage().catch(() => {});
  }, [usageAccess, refreshAppsStorage]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        recheckUsageAccess().then(() => refreshAppsStorage().catch(() => {})).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [recheckUsageAccess, refreshAppsStorage]);

  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024)
      return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
    return `${Math.max(0, Math.round(bytes / 1024 / 1024))} MB`;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={[styles.avatar, { backgroundColor: colors.accentDim }]}>
            <MaterialCommunityIcons name="apps" size={18} color={colors.accent} />
          </View>
          <Text style={styles.brand}>App Manager</Text>
          <TouchableOpacity style={styles.headerIcons}>
            <MaterialCommunityIcons name="refresh" size={18} color={colors.textSec} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => { await refreshAll(); await refreshAppsStorage(); }}
              tintColor={colors.accent}
            />
          }
        >
          {!usageAccess && (
            <View style={styles.accessCard}>
              <MaterialCommunityIcons name="shield-lock-outline" size={40} color={colors.accent} />
              <Text style={[styles.accessTitle, { marginTop: 12 }]}>Enable Usage Access</Text>
              <Text style={styles.accessSub}>
                Required to show which apps are using storage and which are unused.
              </Text>
              <TouchableOpacity style={styles.accessButton} onPress={openUsageAccessSettings}>
                <Text style={styles.accessButtonText}>Open Settings</Text>
              </TouchableOpacity>
            </View>
          )}

          {usageAccess && (
            <View style={styles.appsCard}>
              <View style={[styles.appsHeader, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                <MaterialCommunityIcons name="apps" size={18} color={colors.accent} />
                <Text style={[styles.sectionTitle, { marginTop: 0 }]}>
                  Installed Apps ({appsStorage.length})
                </Text>
              </View>

              {appsLoading ? (
                <View style={styles.emptyState}>
                  <ActivityIndicator color={colors.accent} size="large" />
                  <Text style={[styles.emptyText, { marginTop: 12 }]}>Loading apps...</Text>
                </View>
              ) : appsStorage.length === 0 ? (
                <View style={styles.emptyState}>
                  <MaterialCommunityIcons name="package-variant" size={40} color={colors.textDim} />
                  <Text style={styles.emptyText}>No apps found. Pull to refresh.</Text>
                </View>
              ) : (
                appsStorage.map(app => {
                  const totalBytes = app.appBytes + app.dataBytes + app.cacheBytes;
                  return (
                    <View key={app.packageName} style={styles.appRow}>
                      <View style={styles.appIconWrap}>
                        {app.iconBase64 ? (
                          <Image
                            source={{ uri: `data:image/png;base64,${app.iconBase64}` }}
                            style={styles.appIcon}
                          />
                        ) : (
                          <MaterialCommunityIcons name="package-variant" size={20} color={colors.textDim} />
                        )}
                      </View>
                      <View style={styles.appText}>
                        <Text style={styles.appName}>{app.appName}</Text>
                        <Text style={styles.appPkg} numberOfLines={1}>{app.packageName}</Text>
                      </View>
                      <View style={styles.appRight}>
                        <Text style={styles.appSize}>{formatBytes(totalBytes)}</Text>
                        <TouchableOpacity
                          style={styles.appUninstallButton}
                          onPress={() => openAppUninstall(app.packageName)}
                        >
                          <Text style={styles.appUninstallText}>Uninstall</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
