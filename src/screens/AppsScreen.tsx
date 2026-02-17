import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  AppState,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useDashboard } from './DashboardContext';
import { styles, colors } from './styles';

type SortKey = 'size_desc' | 'cache_desc' | 'name_asc' | 'least_used' | 'most_used';

export default function AppsScreen() {
  const {
    usageAccess,
    appsStorage,
    appsLoading,
    refreshing,
    refreshAll,
    refreshAppsStorage,
    clearJunk,
    clearing,
    clearProgress,
    recheckUsageAccess,
    openUsageAccessSettings,
    openAppInfo,
    openAppUninstall,
  } = useDashboard();
  const [sortBy, setSortBy] = useState<SortKey>('size_desc');
  const sortOptions: Array<{ key: SortKey; label: string }> = [
    { key: 'size_desc', label: 'Size' },
    { key: 'cache_desc', label: 'Cache' },
    { key: 'name_asc', label: 'A-Z' },
    { key: 'least_used', label: 'Least Used' },
    { key: 'most_used', label: 'Most Used' },
  ];

  useFocusEffect(
    React.useCallback(() => {
      let alive = true;
      (async () => {
        await recheckUsageAccess().catch(() => false);
        if (alive) {
          await refreshAppsStorage(true).catch(() => {});
        }
      })();
      return () => {
        alive = false;
      };
    }, [recheckUsageAccess, refreshAppsStorage]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        recheckUsageAccess()
          .then(() => {
            return refreshAppsStorage(true).catch(() => {});
          })
          .catch(() => {
            return refreshAppsStorage(true).catch(() => {});
          })
          .then(() => {
            return undefined;
          })
          .catch(() => {});
      }
    });
    return () => sub.remove();
  }, [recheckUsageAccess, refreshAppsStorage]);

  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024)
      return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
    return `${Math.max(0, Math.round(bytes / 1024 / 1024))} MB`;
  };

  const formatLastUsed = (lastTimeUsed?: number) => {
    const ts = Number(lastTimeUsed ?? 0);
    if (!Number.isFinite(ts) || ts <= 0) return 'Never used';
    const diff = Date.now() - ts;
    const days = Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
    if (days === 0) return 'Used today';
    if (days === 1) return 'Used yesterday';
    return `${days}d ago`;
  };

  const sortedApps = useMemo(() => {
    const list = [...appsStorage];
    list.sort((a, b) => {
      const aTotal = a.appBytes + a.dataBytes + a.cacheBytes;
      const bTotal = b.appBytes + b.dataBytes + b.cacheBytes;
      switch (sortBy) {
        case 'cache_desc':
          return b.cacheBytes - a.cacheBytes;
        case 'name_asc':
          return a.appName.localeCompare(b.appName);
        case 'least_used':
          return (a.lastTimeUsed ?? 0) - (b.lastTimeUsed ?? 0);
        case 'most_used':
          return (b.lastTimeUsed ?? 0) - (a.lastTimeUsed ?? 0);
        case 'size_desc':
        default:
          return bTotal - aTotal;
      }
    });
    return list;
  }, [appsStorage, sortBy]);

  const onCleanCache = async () => {
    try {
      await clearJunk();
      await refreshAll();
      await refreshAppsStorage(true);
    } catch (e) {
      Alert.alert('Cache Cleanup Failed', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={[styles.avatar, { backgroundColor: colors.accentDim }]}>
            <MaterialCommunityIcons name="apps" size={18} color={colors.accent} />
          </View>
          <Text style={styles.brand}>App Manager</Text>
          <TouchableOpacity
            style={styles.headerIcons}
            onPress={async () => {
              await refreshAll();
              await refreshAppsStorage(true);
            }}
          >
            <MaterialCommunityIcons name="refresh" size={18} color={colors.textSec} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => { await refreshAll(); await refreshAppsStorage(true); }}
              tintColor={colors.accent}
            />
          }
        >
          {!usageAccess && (
            <View style={styles.accessCard}>
              <MaterialCommunityIcons name="shield-lock-outline" size={40} color={colors.accent} />
              <Text style={[styles.accessTitle, { marginTop: 12 }]}>Enable Usage Access</Text>
              <Text style={styles.accessSub}>
                Optional, but recommended for accurate least-used and most-used sorting.
              </Text>
              <TouchableOpacity style={styles.accessButton} onPress={openUsageAccessSettings}>
                <Text style={styles.accessButtonText}>Open Settings</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.appsCard}>
              <TouchableOpacity
                style={[styles.scanButton, { marginBottom: 10 }]}
                onPress={onCleanCache}
                disabled={clearing}
              >
                <MaterialCommunityIcons name="broom" size={18} color={colors.bg} />
                <Text style={styles.scanButtonText}>
                  {clearing ? `Cleaning cache... ${Math.round(clearProgress * 100)}%` : 'Clean Cache'}
                </Text>
              </TouchableOpacity>

              <View style={[styles.appsHeader, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                <MaterialCommunityIcons name="apps" size={18} color={colors.accent} />
                <Text style={[styles.sectionTitle, { marginTop: 0 }]}>
                  Installed Apps ({sortedApps.length})
                </Text>
              </View>
              <Text style={styles.appPkg}>
                Sort by: size, cache, app name, least used, most used
              </Text>
              {!usageAccess && (
                <Text style={[styles.appPkg, { marginTop: 4 }]}>
                  Enable Usage Access to improve least/most-used sorting accuracy.
                </Text>
              )}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 8 }}>
                {sortOptions.map((opt) => {
                  const active = sortBy === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      onPress={() => setSortBy(opt.key)}
                      style={[
                        styles.appUninstallButton,
                        active
                          ? { backgroundColor: colors.accentBg, borderColor: colors.accentDim }
                          : { backgroundColor: colors.cardLight, borderColor: colors.border },
                      ]}
                    >
                      <Text style={[styles.appUninstallText, { color: active ? colors.accent : colors.textSec }]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {appsLoading && appsStorage.length > 0 && (
                <View style={{ paddingVertical: 8, alignItems: 'center' }}>
                  <ActivityIndicator color={colors.accent} size="small" />
                </View>
              )}

              {appsLoading && appsStorage.length === 0 ? (
                <View style={styles.emptyState}>
                  <ActivityIndicator color={colors.accent} size="large" />
                  <Text style={[styles.emptyText, { marginTop: 12 }]}>Loading apps...</Text>
                </View>
              ) : sortedApps.length === 0 ? (
                <View style={styles.emptyState}>
                  <MaterialCommunityIcons name="package-variant" size={40} color={colors.textDim} />
                  <Text style={styles.emptyText}>No apps found. Pull to refresh.</Text>
                </View>
              ) : (
                sortedApps.map(app => {
                  const totalBytes = app.appBytes + app.dataBytes + app.cacheBytes;
                  const isSystem = !!app.isSystem;
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
                        <Text style={styles.appPkg}>
                          Last used: {formatLastUsed(app.lastTimeUsed)}{isSystem ? ' • System app' : ''}
                        </Text>
                      </View>
                      <View style={styles.appRight}>
                        <Text style={styles.appSize}>{formatBytes(totalBytes)}</Text>
                        <Text style={styles.appPkg}>Cache {formatBytes(app.cacheBytes)}</Text>
                        <TouchableOpacity
                          style={styles.appUninstallButton}
                          onPress={() => {
                            if (isSystem) {
                              openAppInfo(app.packageName);
                            } else {
                              openAppUninstall(app.packageName);
                            }
                          }}
                        >
                          <Text style={styles.appUninstallText}>{isSystem ? 'App Info' : 'Uninstall'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
