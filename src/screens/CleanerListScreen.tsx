import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { storageCleaner, FileEntry } from '../services/storageCleaner';
import { useDashboard } from './DashboardContext';
import { styles } from './styles';
import { CleanerMode } from './CleanerHomeScreen';

type CleanerListParams = { mode: CleanerMode };

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function shortPath(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts.length > 3
    ? `.../${parts.slice(-3).join('/')}`
    : path;
}

export default function CleanerListScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<{ params: CleanerListParams }, 'params'>>();
  const mode = route.params?.mode ?? 'junk';
  const { refreshAll, addSavedBytes } = useDashboard();

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<FileEntry[]>([]);
  const [emptyPaths, setEmptyPaths] = useState<string[]>([]);
  const [duplicateGroups, setDuplicateGroups] = useState<FileEntry[][]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);

  const isTrash = mode === 'trash';
  const isDuplicates = mode === 'duplicates';
  const isEmpty = mode === 'empty';

  // Check permission on mount and when returning from settings
  const checkPermission = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setHasPermission(false);
      return false;
    }
    try {
      const granted = await storageCleaner.hasStoragePermission();
      setHasPermission(granted);
      return granted;
    } catch {
      setHasPermission(false);
      return false;
    }
  }, []);

  useEffect(() => {
    checkPermission();
  }, [checkPermission]);

  // Re-check when app comes back to foreground (user may have granted in settings)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        checkPermission().then((granted) => {
          if (granted && !scanned) {
            runScan();
          }
        });
      }
    });
    return () => sub.remove();
  }, [checkPermission, scanned]);

  const openSettings = useCallback(async () => {
    try {
      await storageCleaner.openManageStorageSettings();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : String(e));
    }
  }, []);

  const runScan = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    setLoading(true);
    setError(null);
    try {
      switch (mode) {
        case 'junk': {
          const result = await storageCleaner.scanJunk();
          setItems(result);
          setDuplicateGroups([]);
          setEmptyPaths([]);
          break;
        }
        case 'large': {
          const result = await storageCleaner.scanLargeFiles(
            100 * 1024 * 1024,
            500
          );
          setItems(result);
          setDuplicateGroups([]);
          setEmptyPaths([]);
          break;
        }
        case 'duplicates': {
          const groups = await storageCleaner.detectDuplicates();
          setDuplicateGroups(groups);
          setItems(groups.flat());
          setEmptyPaths([]);
          break;
        }
        case 'trash': {
          const result = await storageCleaner.getTrashFiles();
          setItems(result);
          setDuplicateGroups([]);
          setEmptyPaths([]);
          break;
        }
        case 'empty': {
          const result = await storageCleaner.scanEmptyFolders();
          setEmptyPaths(result);
          setItems([]);
          setDuplicateGroups([]);
          break;
        }
        default:
          setItems([]);
      }
      setSelected(new Set());
      setScanned(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setItems([]);
      setEmptyPaths([]);
      setDuplicateGroups([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [mode]);

  // Auto-scan trash on mount if we have permission
  useEffect(() => {
    if (hasPermission && isTrash && !scanned) {
      runScan();
    }
  }, [hasPermission, isTrash, scanned, runScan]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    runScan();
  }, [runScan]);

  const displayList: FileEntry[] = isEmpty ? [] : items;
  const totalSize = displayList.reduce((s, f) => s + f.size, 0);
  const selectedCount = isEmpty
    ? selected.size
    : displayList.filter((f) => selected.has(f.path)).length;
  const selectedSize = displayList
    .filter((f) => selected.has(f.path))
    .reduce((s, f) => s + f.size, 0);

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectAll = () => {
    if (isEmpty) {
      setSelected(new Set(emptyPaths));
    } else {
      setSelected(new Set(displayList.map((f) => f.path)));
    }
  };

  const selectNone = () => setSelected(new Set());

  const getPathsToClean = (): string[] => {
    if (isEmpty) return emptyPaths.filter((p) => selected.has(p));
    return displayList.filter((f) => selected.has(f.path)).map((f) => f.path);
  };

  const handleClean = useCallback(async () => {
    const paths = getPathsToClean();
    if (paths.length === 0) {
      Alert.alert('Nothing selected', 'Select items to clean.');
      return;
    }
    Alert.alert(
      'Confirm',
      isEmpty
        ? `Delete ${paths.length} empty folder(s)?`
        : isTrash
          ? `Permanently delete ${paths.length} item(s)? They cannot be restored.`
          : `Delete ${paths.length} item(s) and free about ${formatBytes(selectedSize)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setCleaning(true);
            setError(null);
            try {
              const result = await storageCleaner.cleanup(paths, {
                dryRun: false,
                moveToTrash: false,
              });
              if (result.status === 'success') {
                Alert.alert(
                  'Done',
                  `Deleted ${result.deletedCount} item(s).${result.failedPaths.length ? ` ${result.failedPaths.length} failed.` : ''}`
                );
                await addSavedBytes(selectedSize);
                await refreshAll();
                runScan();
              } else if (result.status === 'rejected') {
                Alert.alert('Rejected', result.reason);
              } else {
                Alert.alert('Error', result.message);
              }
            } catch (e) {
              Alert.alert(
                'Error',
                e instanceof Error ? e.message : String(e)
              );
            } finally {
              setCleaning(false);
            }
          },
        },
      ]
    );
  }, [
    isEmpty,
    isTrash,
    selectedSize,
    runScan,
    refreshAll,
    emptyPaths,
    displayList,
    selected,
  ]);

  const handleRestore = useCallback(async () => {
    const paths = getPathsToClean();
    if (paths.length === 0) {
      Alert.alert('Nothing selected', 'Select items to restore.');
      return;
    }
    setCleaning(true);
    setError(null);
    try {
      const restored = await storageCleaner.restoreFromTrash(paths);
      Alert.alert('Done', `Restored ${restored.length} item(s).`);
      runScan();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : String(e));
    } finally {
      setCleaning(false);
    }
  }, [runScan, emptyPaths, displayList, selected, isEmpty]);

  const titles: Record<CleanerMode, string> = {
    junk: 'Junk Files',
    large: 'Large Files',
    duplicates: 'Duplicates',
    trash: 'Trash',
    empty: 'Empty Folders',
  };

  if (Platform.OS !== 'android') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.root}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <Text style={styles.listChevron}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.brand}>{titles[mode]}</Text>
            <View style={styles.headerIcons} />
          </View>
          <View style={{ padding: 20 }}>
            <Text style={styles.listSubtitle}>
              Available on Android only.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Permission not yet checked
  if (hasPermission === null) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.root}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={{ padding: 8 }}
            >
              <Text style={[styles.listChevron, { fontSize: 28 }]}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.brand}>{titles[mode]}</Text>
            <View style={styles.headerIcons} />
          </View>
          <View style={{ padding: 20, alignItems: 'center' }}>
            <ActivityIndicator color="#9fe6a6" size="large" />
            <Text style={[styles.listSubtitle, { marginTop: 12 }]}>
              Checking permissions…
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // No permission — show grant UI
  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.root}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={{ padding: 8 }}
            >
              <Text style={[styles.listChevron, { fontSize: 28 }]}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.brand}>{titles[mode]}</Text>
            <View style={styles.headerIcons} />
          </View>
          <View style={{ padding: 20 }}>
            <View style={styles.accessCard}>
              <Text style={styles.accessTitle}>Storage Access Required</Text>
              <Text style={[styles.accessSub, { marginTop: 8 }]}>
                To scan and clean files, the app needs access to your device
                storage.{'\n\n'}
                Tap the button below, then enable "Allow access to manage all
                files" in the settings screen that opens.{'\n\n'}
                After granting, come back to this screen.
              </Text>
              <TouchableOpacity
                style={[styles.accessButton, { marginTop: 16 }]}
                onPress={openSettings}
              >
                <Text style={styles.accessButtonText}>
                  Grant Storage Access
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.accessButton,
                  { marginTop: 10, backgroundColor: '#1e2c23' },
                ]}
                onPress={checkPermission}
              >
                <Text style={styles.accessButtonText}>
                  I've granted it — check again
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Has permission — show scan UI
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{ padding: 8 }}
          >
            <Text style={[styles.listChevron, { fontSize: 28 }]}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.brand}>{titles[mode]}</Text>
          <View style={styles.headerIcons} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#9fe6a6"
            />
          }
        >
          {/* Scan button (not for trash, which auto-scans) */}
          {mode !== 'trash' && (
            <TouchableOpacity
              style={[styles.accessButton, { marginBottom: 12 }]}
              onPress={runScan}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#0b1c11" />
              ) : (
                <Text style={styles.accessButtonText}>
                  {scanned ? 'Re-scan' : 'Scan Now'}
                </Text>
              )}
            </TouchableOpacity>
          )}

          {/* Error display */}
          {error ? (
            <View style={styles.accessCard}>
              <Text style={[styles.accessTitle, { color: '#ffb5b5' }]}>
                {error}
              </Text>
            </View>
          ) : null}

          {/* Loading spinner */}
          {loading && !refreshing ? (
            <View style={[styles.statsCard, { alignItems: 'center' }]}>
              <ActivityIndicator color="#9fe6a6" size="large" />
              <Text style={[styles.listSubtitle, { marginTop: 8 }]}>
                Scanning your storage…
              </Text>
            </View>
          ) : !scanned && !isTrash ? (
            <View style={[styles.statsCard, { alignItems: 'center' }]}>
              <Text style={styles.listSubtitle}>
                Tap "Scan Now" to analyze your storage.
              </Text>
            </View>
          ) : isEmpty ? (
            <>
              <Text style={styles.sectionTitle}>
                {emptyPaths.length} empty folder(s) found
              </Text>
              {emptyPaths.length === 0 && (
                <Text style={styles.listSubtitle}>
                  No empty folders found.
                </Text>
              )}
              {emptyPaths.map((path) => (
                <TouchableOpacity
                  key={path}
                  style={styles.miniRow}
                  onPress={() => toggle(path)}
                >
                  <Text style={[styles.listChevron, { marginRight: 8 }]}>
                    {selected.has(path) ? '☑' : '☐'}
                  </Text>
                  <Text
                    style={styles.miniPkg}
                    numberOfLines={1}
                  >
                    {shortPath(path)}
                  </Text>
                </TouchableOpacity>
              ))}
            </>
          ) : (
            <>
              {/* Summary bar */}
              <View
                style={[
                  styles.statsCard,
                  {
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                  },
                ]}
              >
                <Text style={styles.listSubtitle}>
                  {displayList.length} item(s) · {formatBytes(totalSize)}
                </Text>
                {displayList.length > 0 && (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity onPress={selectAll}>
                      <Text style={[styles.featureValue, { fontSize: 14 }]}>
                        Select all
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={selectNone}>
                      <Text style={styles.listSubtitle}>Clear</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {displayList.length === 0 && scanned && (
                <View style={[styles.statsCard, { alignItems: 'center' }]}>
                  <Text style={styles.listSubtitle}>
                    {isTrash ? 'Trash is empty.' : 'Nothing found — your storage is clean!'}
                  </Text>
                </View>
              )}

              {/* Duplicate groups */}
              {isDuplicates && duplicateGroups.length > 0
                ? duplicateGroups.map((group, idx) => (
                    <View key={idx} style={styles.miniList}>
                      <Text style={styles.miniTitle}>
                        Group {idx + 1} ({group.length} files ·{' '}
                        {formatBytes(group[0]?.size ?? 0)} each)
                      </Text>
                      {group.map((f) => (
                        <TouchableOpacity
                          key={f.path}
                          style={styles.miniRow}
                          onPress={() => toggle(f.path)}
                        >
                          <Text
                            style={[styles.listChevron, { marginRight: 8 }]}
                          >
                            {selected.has(f.path) ? '☑' : '☐'}
                          </Text>
                          <View style={styles.miniText}>
                            <Text style={styles.miniPkg} numberOfLines={1}>
                              {shortPath(f.path)}
                            </Text>
                            <Text style={styles.miniName}>
                              {formatBytes(f.size)}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ))
                : displayList.map((f) => (
                    <TouchableOpacity
                      key={f.path}
                      style={styles.miniRow}
                      onPress={() => toggle(f.path)}
                    >
                      <Text style={[styles.listChevron, { marginRight: 8 }]}>
                        {selected.has(f.path) ? '☑' : '☐'}
                      </Text>
                      <View style={styles.miniText}>
                        <Text style={styles.miniPkg} numberOfLines={1}>
                          {shortPath(f.path)}
                        </Text>
                        <Text style={styles.miniName}>
                          {formatBytes(f.size)}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
            </>
          )}

          {/* Action buttons */}
          {selectedCount > 0 && !loading && (
            <View style={{ marginTop: 24, gap: 12, paddingBottom: 40 }}>
              {isTrash && (
                <TouchableOpacity
                  style={[styles.accessButton, { backgroundColor: '#2b4a36' }]}
                  onPress={handleRestore}
                  disabled={cleaning}
                >
                  <Text style={styles.accessButtonText}>
                    {cleaning
                      ? 'Restoring…'
                      : `Restore ${selectedCount} item(s)`}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.accessButton, { backgroundColor: '#8b2a2a' }]}
                onPress={handleClean}
                disabled={cleaning}
              >
                <Text style={styles.accessButtonText}>
                  {cleaning
                    ? 'Deleting…'
                    : `Delete ${selectedCount} item(s) (${formatBytes(selectedSize)})`}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
