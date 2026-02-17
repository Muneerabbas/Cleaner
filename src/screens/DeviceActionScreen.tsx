import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { colors, fonts, styles } from './styles';
import { diskIntelApi } from '../services/diskIntelApi';

type ActionType = 'health' | 'scan' | 'analysis' | 'cleanup';

type Params = {
  params: {
    action: ActionType;
    title: string;
    baseUrl: string;
    rootPath: string;
  };
};

function toNumber(v: string): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function safeJson(value: any): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[unserializable data]';
  }
}

export default function DeviceActionScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<Params, 'params'>>();
  const { action, title, baseUrl, rootPath } = route.params;

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [visualData, setVisualData] = useState<Record<string, any> | null>(null);
  const [snapshotId, setSnapshotId] = useState('');
  const [minSize, setMinSize] = useState('500MB');
  const [olderDays, setOlderDays] = useState('180');
  const booted = useRef(false);

  const resolvedSnapshot = useMemo(() => toNumber(snapshotId), [snapshotId]);

  const withAction = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setStatus(label);
    try {
      diskIntelApi.setBaseUrl(baseUrl);
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`Failed: ${label}`);
      Alert.alert('Action Failed', msg);
    } finally {
      setBusy(false);
    }
  };

  const toHumanBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
    if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${Math.round(bytes)} B`;
  };

  const normalizeData = (raw: any): Record<string, any> => {
    if (!raw || typeof raw !== 'object') return { value: raw };
    if (raw.comprehensive) return raw.comprehensive;
    if (raw.result && typeof raw.result === 'object') {
      if (raw.result.comprehensive) return raw.result.comprehensive;
      if (raw.result.report && typeof raw.result.report === 'object') {
        return { ...raw.result.report, ...raw.result };
      }
      return raw.result;
    }
    if (raw.report && typeof raw.report === 'object') {
      return { ...raw.report, ...raw };
    }
    return raw;
  };

  const commitData = (raw: any) => {
    const normalized = normalizeData(raw);
    setVisualData(normalized);
    const txt = safeJson(raw);
    if (txt.length > 12000) {
      setStatus((prev) => `${prev} (payload truncated for safety)`);
    }
  };

  const pollJob = async (jobId: string, label: string) => {
    for (let i = 0; i < 200; i += 1) {
      const job = await diskIntelApi.getJob(jobId);
      const pct = Number(job.progress?.pct ?? 0);
      const phase = String(job.progress?.phase ?? 'running');
      setStatus(`${label}: ${phase} ${Math.round(pct)}%`);
      if (job.status === 'completed' || job.status === 'failed') {
        const result = await diskIntelApi.getJobResult(jobId);
        const sid = (result as any)?.result?.snapshot_id;
        if (sid) setSnapshotId(String(sid));
        commitData(result);
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`${label} timed out`);
  };

  const health = () =>
    withAction('Health Check', async () => {
      const data = await diskIntelApi.health();
      setStatus('Device reachable');
      commitData(data);
    });

  const startScan = () =>
    withAction('Start Scan', async () => {
      const run = await diskIntelApi.startScan({
        roots: [rootPath],
        include_hidden: true,
        follow_symlinks: false,
      });
      await pollJob(run.job_id, 'Scan');
    });

  const latest = () =>
    withAction('Load Latest Snapshot', async () => {
      const data = await diskIntelApi.latestSnapshot();
      const sid = (data as any)?.snapshot?.snapshot_id;
      if (sid) setSnapshotId(String(sid));
      commitData(data);
      setStatus('Latest snapshot loaded');
    });

  const analysis = () =>
    withAction('Run Analysis', async () => {
      const run = await diskIntelApi.runAnalysis({
        snapshot_id: resolvedSnapshot,
        include_duplicates: true,
        top_n: 50,
      });
      await pollJob(run.job_id, 'Analysis');
    });

  const duplicates = () =>
    withAction('Run Duplicates', async () => {
      const run = await diskIntelApi.runDuplicates({ snapshot_id: resolvedSnapshot });
      await pollJob(run.job_id, 'Duplicates');
    });

  const runLargeOldAction = () =>
    withAction('Large/Old Filter', async () => {
      const data = await diskIntelApi.filterLargeOld({
        snapshot_id: resolvedSnapshot,
        min_size: minSize,
        older_than_days: toNumber(olderDays) ?? 180,
        limit: 200,
      });
      commitData(data);
      setStatus('Large/old extracted');
    });

  const snapshotData = () =>
    withAction('Snapshot Data', async () => {
      if (!resolvedSnapshot) throw new Error('Set snapshot id first.');
      const [largest, folders, types, ext, pareto, hist] = await Promise.all([
        diskIntelApi.largestFiles(resolvedSnapshot, 25),
        diskIntelApi.folderAggregation(resolvedSnapshot, 25),
        diskIntelApi.typeDistribution(resolvedSnapshot),
        diskIntelApi.extensionFrequency(resolvedSnapshot, 25),
        diskIntelApi.pareto(resolvedSnapshot),
        diskIntelApi.histogram(resolvedSnapshot),
      ]);
      commitData({ largest, folders, types, extensions: ext, pareto, histogram: hist });
      setStatus('Snapshot data extracted');
    });

  const cleanupDry = () =>
    withAction('Cleanup Dry-Run', async () => {
      const run = await diskIntelApi.runCleanup({
        snapshot_id: resolvedSnapshot,
        mode: 'large-old',
        roots: [rootPath],
        min_size: minSize,
        older_than_days: toNumber(olderDays) ?? 180,
        execute: false,
        confirm: false,
      });
      await pollJob(run.job_id, 'Cleanup Dry-Run');
    });

  const completeDataBundle = () =>
    withAction('Complete data extraction', async () => {
      let sid = resolvedSnapshot;

      if (!sid) {
        const latestData = await diskIntelApi.latestSnapshot();
        sid = Number((latestData as any)?.snapshot?.snapshot_id || 0) || undefined;
      }

      if (!sid) {
        const scan = await diskIntelApi.startScan({
          roots: [rootPath],
          include_hidden: true,
          follow_symlinks: false,
        });
        await pollJob(scan.job_id, 'Scan');
        const latestData = await diskIntelApi.latestSnapshot();
        sid = Number((latestData as any)?.snapshot?.snapshot_id || 0) || undefined;
      }

      if (!sid) {
        throw new Error('No snapshot available after scan.');
      }

      setSnapshotId(String(sid));

      const analysisJob = await diskIntelApi.runAnalysis({
        snapshot_id: sid,
        include_duplicates: true,
        top_n: 100,
      });
      await pollJob(analysisJob.job_id, 'Analysis');

      const [largest, folders, types, ext, pareto, hist, largeOld] = await Promise.all([
        diskIntelApi.largestFiles(sid, 50),
        diskIntelApi.folderAggregation(sid, 50),
        diskIntelApi.typeDistribution(sid),
        diskIntelApi.extensionFrequency(sid, 50),
        diskIntelApi.pareto(sid),
        diskIntelApi.histogram(sid),
        diskIntelApi.filterLargeOld({
          snapshot_id: sid,
          min_size: minSize,
          older_than_days: toNumber(olderDays) ?? 180,
          limit: 300,
        }),
      ]);

      commitData({
        snapshot_id: sid,
        comprehensive: {
          largest,
          folders,
          types,
          extensions: ext,
          pareto,
          histogram: hist,
          large_old: largeOld,
        },
      });
      setStatus('Complete data extracted');
    });

  const primaryAction = () => {
    if (action === 'health') return health();
    if (action === 'scan') return startScan();
    if (action === 'analysis') return analysis();
    return cleanupDry();
  };

  const pick = (...values: any[]) => values.find((v) => v !== undefined && v !== null);
  const toList = (v: any): any[] => {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    if (typeof v === 'object') {
      return Object.entries(v).map(([key, value]) => {
        if (value && typeof value === 'object') {
          return { key, ...(value as any) };
        }
        return { key, value };
      });
    }
    return [];
  };

  const summary = pick((visualData as any)?.summary, (visualData as any)?.snapshot);
  const largest = pick(
    (visualData as any)?.largest_files,
    (visualData as any)?.largest?.largest_files,
    (visualData as any)?.largestFiles,
  );
  const folders = pick(
    (visualData as any)?.folder_sizes,
    (visualData as any)?.folders?.folders,
    (visualData as any)?.folders,
  );
  const types = pick(
    (visualData as any)?.type_distribution,
    (visualData as any)?.types?.types,
    (visualData as any)?.types,
  );
  const extensions = pick(
    (visualData as any)?.extension_frequency,
    (visualData as any)?.extensions?.extensions,
    (visualData as any)?.extensions,
  );
  const histogram = pick(
    (visualData as any)?.size_histogram,
    (visualData as any)?.histogram?.histogram,
    (visualData as any)?.histogram,
  );
  const largeOld = pick(
    (visualData as any)?.large_old_default,
    (visualData as any)?.large_and_old,
    (visualData as any)?.large_old?.large_and_old,
    (visualData as any)?.large_old,
  );
  const dupClusters = pick((visualData as any)?.clusters, (visualData as any)?.report?.duplicates?.clusters);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    if (action !== 'health') {
      completeDataBundle();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4, marginRight: 4 }}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={colors.text} />
          </TouchableOpacity>
          <MaterialCommunityIcons name="database-cog" size={20} color={colors.accent} style={{ marginRight: 8 }} />
          <Text style={[styles.brand, { marginLeft: 0 }]}>{title}</Text>
          {busy ? <ActivityIndicator color={colors.accent} /> : <View style={{ width: 20 }} />}
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.statsCard}>
            <Text style={styles.statLabel}>Connected API</Text>
            <Text style={styles.statValue}>{baseUrl}</Text>
            <Text style={[styles.statLabel, { marginTop: 10 }]}>Root Path</Text>
            <Text style={styles.statValue}>{rootPath}</Text>
          </View>

          <View style={styles.statsCard}>
            <Text style={styles.statLabel}>Snapshot ID</Text>
            <TextInput
              value={snapshotId}
              onChangeText={setSnapshotId}
              keyboardType="numeric"
              placeholder="auto from scan/latest"
              placeholderTextColor={colors.textDim}
              style={{
                marginTop: 8,
                backgroundColor: colors.cardLight,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: 12,
                color: colors.text,
                fontFamily: fonts.regular,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.statLabel}>Min Size</Text>
                <TextInput
                  value={minSize}
                  onChangeText={setMinSize}
                  placeholder="500MB"
                  placeholderTextColor={colors.textDim}
                  style={{
                    marginTop: 6,
                    backgroundColor: colors.cardLight,
                    borderColor: colors.border,
                    borderWidth: 1,
                    borderRadius: 12,
                    color: colors.text,
                    fontFamily: fonts.regular,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.statLabel}>Older Days</Text>
                <TextInput
                  value={olderDays}
                  onChangeText={setOlderDays}
                  keyboardType="numeric"
                  placeholder="180"
                  placeholderTextColor={colors.textDim}
                  style={{
                    marginTop: 6,
                    backgroundColor: colors.cardLight,
                    borderColor: colors.border,
                    borderWidth: 1,
                    borderRadius: 12,
                    color: colors.text,
                    fontFamily: fonts.regular,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                  }}
                />
              </View>
            </View>
          </View>

          <TouchableOpacity style={styles.scanButton} onPress={primaryAction} disabled={busy}>
            <MaterialCommunityIcons name="play-circle-outline" size={18} color={colors.bg} />
            <Text style={styles.scanButtonText}>Run Primary Action</Text>
          </TouchableOpacity>

          <Text style={styles.sectionTitle}>All Possible Actions</Text>
          <View style={styles.tileContainer}>
            <TouchableOpacity style={styles.tile} onPress={health} disabled={busy}>
              <Text style={styles.tileTitle}>Health</Text>
              <Text style={styles.tileSub}>Connectivity check</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.tile} onPress={startScan} disabled={busy}>
              <Text style={styles.tileTitle}>Start Scan</Text>
              <Text style={styles.tileSub}>Extract file metadata</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.tile} onPress={latest} disabled={busy}>
              <Text style={styles.tileTitle}>Latest Snapshot</Text>
              <Text style={styles.tileSub}>Load latest state</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.tile} onPress={analysis} disabled={busy}>
              <Text style={styles.tileTitle}>Run Analysis</Text>
              <Text style={styles.tileSub}>Aggregate stats</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.tile} onPress={duplicates} disabled={busy}>
              <Text style={styles.tileTitle}>Duplicates</Text>
              <Text style={styles.tileSub}>Duplicate clusters</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.tile} onPress={runLargeOldAction} disabled={busy}>
              <Text style={styles.tileTitle}>Large + Old</Text>
              <Text style={styles.tileSub}>Candidate extraction</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.tile} onPress={snapshotData} disabled={busy}>
              <Text style={styles.tileTitle}>Snapshot Data</Text>
              <Text style={styles.tileSub}>Largest/folders/types</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.tile} onPress={cleanupDry} disabled={busy}>
              <Text style={styles.tileTitle}>Cleanup Dry-Run</Text>
              <Text style={styles.tileSub}>Safe action preview</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.statsCard}>
            <Text style={styles.statLabel}>Status</Text>
            <Text style={[styles.statValue, { marginTop: 6 }]}>{status}</Text>
          </View>

          <Text style={styles.sectionTitle}>Visualized Data</Text>
          {!visualData ? (
            <View style={styles.statsCard}>
              <Text style={styles.statLabel}>No data yet</Text>
            </View>
          ) : (
            <>
              {summary && (
                <View style={styles.statsCard}>
                  <Text style={styles.statLabel}>Summary</Text>
                  {Object.entries(summary as Record<string, any>).map(([k, v]) => (
                    <View key={k} style={styles.statRow}>
                      <Text style={styles.statLabel}>{k}</Text>
                      <Text style={styles.statValue}>
                        {typeof v === 'number' && k.toLowerCase().includes('byte') ? toHumanBytes(v) : String(v)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {toList(largest).length > 0 && (
                <View style={styles.statsCard}>
                  <Text style={styles.statLabel}>Largest Files</Text>
                  {toList(largest)
                    .slice(0, 20)
                    .map((item, idx) => (
                      <View key={`${item.path || item.name || idx}`} style={styles.miniRow}>
                        <Text style={[styles.miniName, { flex: 1 }]} numberOfLines={1}>
                          {item.path || item.name || `item-${idx + 1}`}
                        </Text>
                        <Text style={styles.miniPkg}>{toHumanBytes(Number(item.size || 0))}</Text>
                      </View>
                    ))}
                </View>
              )}

              {toList(folders).length > 0 && (
                <View style={styles.statsCard}>
                  <Text style={styles.statLabel}>Largest Folders</Text>
                  {toList(folders)
                    .slice(0, 20)
                    .map((item, idx) => (
                      <View key={`${item.path || idx}`} style={styles.miniRow}>
                        <Text style={[styles.miniName, { flex: 1 }]} numberOfLines={1}>
                          {item.path || `folder-${idx + 1}`}
                        </Text>
                        <Text style={styles.miniPkg}>{toHumanBytes(Number(item.size || 0))}</Text>
                      </View>
                    ))}
                </View>
              )}

              {types && typeof types === 'object' && (
                <View style={styles.statsCard}>
                  <Text style={styles.statLabel}>Type Distribution</Text>
                  {Object.entries(types as Record<string, any>).map(([name, value]) => {
                    const bytes = Number((value as any)?.bytes ?? value ?? 0);
                    const total = Object.values(types as Record<string, any>).reduce(
                      (s, v) => s + Number((v as any)?.bytes ?? v ?? 0),
                      0,
                    );
                    const pct = total > 0 ? Math.max(2, Math.round((bytes / total) * 100)) : 0;
                    return (
                      <View key={name} style={{ marginTop: 8 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={styles.statLabel}>{name}</Text>
                          <Text style={styles.statValue}>{toHumanBytes(bytes)}</Text>
                        </View>
                        <View
                          style={{
                            height: 8,
                            backgroundColor: colors.border,
                            borderRadius: 999,
                            marginTop: 6,
                            overflow: 'hidden',
                          }}
                        >
                          <View
                            style={{
                              height: 8,
                              width: `${pct}%`,
                              backgroundColor: colors.accent,
                            }}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              {toList(extensions).length > 0 && (
                <View style={styles.statsCard}>
                  <Text style={styles.statLabel}>Top Extensions</Text>
                  {toList(extensions)
                    .slice(0, 20)
                    .map((item, idx) => (
                      <View key={`${item.extension || idx}`} style={styles.miniRow}>
                        <Text style={[styles.miniName, { flex: 1 }]}>{item.extension || item.key || 'no-ext'}</Text>
                        <Text style={styles.miniPkg}>
                          {item.count ?? 0} files • {toHumanBytes(Number(item.bytes ?? item.size ?? 0))}
                        </Text>
                      </View>
                    ))}
                </View>
              )}

              {toList(histogram).length > 0 && (
                <View style={styles.statsCard}>
                  <Text style={styles.statLabel}>File Size Histogram</Text>
                  {toList(histogram)
                    .slice(0, 20)
                    .map((bin, idx) => {
                      const count = Number(bin.count ?? 0);
                      const arr = toList(histogram).map((x) => Number((x as any).count ?? 0));
                      const max = Math.max(1, ...arr);
                      const pct = Math.max(2, Math.round((count / max) * 100));
                      return (
                        <View key={`${bin.label || idx}`} style={{ marginTop: 8 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                            <Text style={styles.statLabel}>{bin.label || `${bin.min || 0} - ${bin.max || 0}`}</Text>
                            <Text style={styles.statValue}>{count}</Text>
                          </View>
                          <View
                            style={{
                              height: 8,
                              backgroundColor: colors.border,
                              borderRadius: 999,
                              marginTop: 6,
                              overflow: 'hidden',
                            }}
                          >
                            <View
                              style={{
                                height: 8,
                                width: `${pct}%`,
                                backgroundColor: '#82b1ff',
                              }}
                            />
                          </View>
                        </View>
                      );
                    })}
                </View>
              )}

              {toList(largeOld).length > 0 && (
                <View style={styles.statsCard}>
                  <Text style={styles.statLabel}>Large & Old Candidates</Text>
                  {toList(largeOld)
                    .slice(0, 20)
                    .map((item, idx) => (
                      <View key={`${item.path || idx}`} style={styles.miniRow}>
                        <Text style={[styles.miniName, { flex: 1 }]} numberOfLines={1}>
                          {item.path || `candidate-${idx + 1}`}
                        </Text>
                        <Text style={styles.miniPkg}>{toHumanBytes(Number(item.size || 0))}</Text>
                      </View>
                    ))}
                </View>
              )}

              {toList(dupClusters).length > 0 && (
                <View style={styles.statsCard}>
                  <Text style={styles.statLabel}>Duplicate Clusters</Text>
                  {toList(dupClusters)
                    .slice(0, 20)
                    .map((cluster, idx) => (
                      <View key={`cluster-${idx}`} style={styles.miniRow}>
                        <Text style={[styles.miniName, { flex: 1 }]}>
                          Cluster {idx + 1} • {cluster.files?.length || cluster.duplicates?.length || 0} files
                        </Text>
                        <Text style={styles.miniPkg}>
                          Save {toHumanBytes(Number(cluster.waste_bytes || cluster.savings_bytes || 0))}
                        </Text>
                      </View>
                    ))}
                </View>
              )}
            </>
          )}

          {/* Raw JSON intentionally hidden to avoid OOM from rendering huge payload text */}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
