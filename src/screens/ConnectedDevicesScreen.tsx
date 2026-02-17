import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { colors, styles } from './styles';
import { diskIntelApi } from '../services/diskIntelApi';

function toHumanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${Math.round(bytes)} B`;
}

function toNumber(v: string): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export default function ConnectedDevicesScreen() {
  const navigation = useNavigation();
  const [rootPath, setRootPath] = useState('/home/manas/Documents/Cleaner');
  const [snapshotId, setSnapshotId] = useState('');
  const [minSize, setMinSize] = useState('500MB');
  const [olderDays, setOlderDays] = useState('180');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Select a device and run an action.');
  const [visualData, setVisualData] = useState<Record<string, any> | null>(null);
  const [lastActionId, setLastActionId] = useState('');
  const [connectedUrl, setConnectedUrl] = useState(diskIntelApi.getBaseUrl());
  const [availableActions, setAvailableActions] = useState<Array<Record<string, any>>>([]);

  useFocusEffect(
    React.useCallback(() => {
      const current = diskIntelApi.getBaseUrl();
      setConnectedUrl(current);
      setStatus(`Connected URL: ${current}`);
      return undefined;
    }, []),
  );

  const ensureConnected = () => {
    const url = (diskIntelApi.getBaseUrl() || '').trim();
    if (!url) {
      Alert.alert('Scan Required', 'Please scan server QR first.');
      return false;
    }
    return true;
  };

  const compactPayload = (value: any, depth = 0): any => {
    if (depth > 4) return '[truncated]';
    if (Array.isArray(value)) return value.slice(0, 80).map((x) => compactPayload(x, depth + 1));
    if (value && typeof value === 'object') {
      const out: Record<string, any> = {};
      let count = 0;
      for (const [k, v] of Object.entries(value)) {
        if (count >= 80) break;
        out[k] = compactPayload(v, depth + 1);
        count += 1;
      }
      return out;
    }
    if (typeof value === 'string' && value.length > 240) return `${value.slice(0, 240)}...`;
    return value;
  };

  const commitData = (raw: any) => {
    let data = raw && typeof raw === 'object' ? raw : { value: raw };
    if (data?.result && typeof data.result === 'object') {
      data = data.result;
    }
    if (data?.report && typeof data.report === 'object') {
      data = { ...data.report, ...data };
    }
    if (data?.comprehensive && typeof data.comprehensive === 'object') {
      data = { ...data.comprehensive, ...data };
    }
    setVisualData(compactPayload(data));
  };

  const withAction = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setStatus(label);
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`Failed: ${label}`);
      Alert.alert('Action Failed', msg);
    } finally {
      setBusy(false);
    }
  };

  const pollJob = async (jobId: string, label: string) => {
    for (let i = 0; i < 220; i += 1) {
      const job = await diskIntelApi.getJob(jobId);
      const pct = Number(job.progress?.pct ?? 0);
      const phase = String(job.progress?.phase ?? 'running');
      setStatus(`${label}: ${phase} ${Math.round(pct)}%`);
      if (job.status === 'completed' || job.status === 'failed') {
        const result = await diskIntelApi.getJobResult(jobId);
        if (job.status === 'failed') {
          const msg =
            String((result as any)?.error?.message || (result as any)?.error?.code || 'Job failed');
          setStatus(`Failed: ${label}`);
          throw new Error(msg);
        }
        const sid = (result as any)?.result?.snapshot_id;
        if (sid) setSnapshotId(String(sid));
        const actionId =
          (result as any)?.result?.action_id ||
          (result as any)?.result?.cleanup_action_id ||
          (result as any)?.result?.meta?.action_id;
        if (actionId) setLastActionId(String(actionId));
        commitData(result);
        return result;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`${label} timed out`);
  };

  const ensureSnapshot = async () => {
    const sid = toNumber(snapshotId);
    if (sid) return sid;

    const latest = await diskIntelApi.latestSnapshot();
    const latestId = Number((latest as any)?.snapshot?.snapshot_id || 0) || undefined;
    if (latestId) {
      setSnapshotId(String(latestId));
      return latestId;
    }

    const started = await diskIntelApi.startScan({
      roots: [rootPath],
      include_hidden: true,
      follow_symlinks: false,
    });
    await pollJob(started.job_id, 'Scan');
    const after = await diskIntelApi.latestSnapshot();
    const afterId = Number((after as any)?.snapshot?.snapshot_id || 0) || undefined;
    if (!afterId) throw new Error('No snapshot available. Run scan first.');
    setSnapshotId(String(afterId));
    return afterId;
  };

  const loadConnectedActions = () =>
    withAction('Loading connected actions', async () => {
      if (!ensureConnected()) return;
      const data = await diskIntelApi.listActions();
      const actions = Array.isArray((data as any)?.actions) ? (data as any).actions : [];
      setAvailableActions(actions);
      setStatus(`Loaded ${actions.length} actions`);
    });

  const runHealth = () =>
    withAction('Checking connectivity', async () => {
      if (!ensureConnected()) return;
      const health = await diskIntelApi.health();
      commitData(health);
      setStatus('Connected');
    });

  const runScan = () =>
    withAction('Running scan', async () => {
      if (!ensureConnected()) return;
      const started = await diskIntelApi.startScan({
        roots: [rootPath],
        include_hidden: true,
        follow_symlinks: false,
      });
      await pollJob(started.job_id, 'Scan');
    });

  const runAnalysis = () =>
    withAction('Running analysis', async () => {
      if (!ensureConnected()) return;
      const started = await diskIntelApi.runAnalysis({
        snapshot_id: toNumber(snapshotId),
        include_duplicates: true,
        top_n: 100,
      });
      await pollJob(started.job_id, 'Analysis');
    });

  const runDuplicates = () =>
    withAction('Running duplicates', async () => {
      if (!ensureConnected()) return;
      const started = await diskIntelApi.runDuplicates({ snapshot_id: toNumber(snapshotId) });
      await pollJob(started.job_id, 'Duplicates');
    });

  const runLargeOld = () =>
    withAction('Filtering large + old', async () => {
      if (!ensureConnected()) return;
      const data = await diskIntelApi.filterLargeOld({
        snapshot_id: toNumber(snapshotId),
        min_size: minSize,
        older_than_days: toNumber(olderDays) ?? 180,
        limit: 250,
      });
      commitData(data);
      setStatus('Large + old extracted');
    });

  const runSnapshotStats = () =>
    withAction('Loading snapshot stats', async () => {
      if (!ensureConnected()) return;
      const sid = toNumber(snapshotId);
      if (!sid) throw new Error('Set Snapshot ID first.');
      const [largest, folders, types, ext, pareto, hist] = await Promise.all([
        diskIntelApi.largestFiles(sid, 30),
        diskIntelApi.folderAggregation(sid, 30),
        diskIntelApi.typeDistribution(sid),
        diskIntelApi.extensionFrequency(sid, 30),
        diskIntelApi.pareto(sid),
        diskIntelApi.histogram(sid),
      ]);
      commitData({ largest, folders, types, extensions: ext, pareto, histogram: hist });
      setStatus('Snapshot stats loaded');
    });

  const runCleanupDry = () =>
    withAction('Running cleanup dry-run', async () => {
      if (!ensureConnected()) return;
      const sid = await ensureSnapshot();
      const started = await diskIntelApi.runCleanup({
        snapshot_id: sid,
        mode: 'large-old',
        roots: [rootPath],
        min_size: minSize,
        older_than_days: toNumber(olderDays) ?? 180,
        execute: false,
        confirm: false,
      });
      await pollJob(started.job_id, 'Cleanup Dry-Run');
    });

  const runDeleteDuplicates = () =>
    Alert.alert('Delete Duplicates', 'Delete duplicate files via quarantine?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          withAction('Deleting duplicates', async () => {
            if (!ensureConnected()) return;
            const sid = await ensureSnapshot();
            const started = await diskIntelApi.deleteDuplicates({
              snapshot_id: sid,
              roots: [rootPath],
              limit: 2000,
              quarantine_mode: true,
              force_high_risk: false,
              confirm: true,
            });
            await pollJob(started.job_id, 'Delete Duplicates');
          }),
      },
    ]);

  const runSmartDeleteDuplicates = () =>
    withAction('Analyzing duplicates', async () => {
      if (!ensureConnected()) return;
      const sid = await ensureSnapshot();
      const detect = await diskIntelApi.runDuplicates({ snapshot_id: sid });
      const result = await pollJob(detect.job_id, 'Duplicate Analysis');
      const clusters = toList((result as any)?.result?.clusters);
      const savings = clusters.reduce((sum, c) => sum + Number(c.waste_bytes || c.savings_bytes || 0), 0);
      const files = clusters.reduce((sum, c) => sum + Number(c.files?.length || c.duplicates?.length || 0), 0);

      Alert.alert(
        'Remove Duplicates',
        `Found ${clusters.length} clusters, ${files} files, potential savings ${toHumanBytes(savings)}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () =>
              withAction('Deleting duplicates', async () => {
                const started = await diskIntelApi.deleteDuplicates({
                  snapshot_id: sid,
                  roots: [rootPath],
                  limit: 4000,
                  quarantine_mode: true,
                  force_high_risk: false,
                  confirm: true,
                });
                await pollJob(started.job_id, 'Delete Duplicates');
              }),
          },
        ],
      );
    });

  const runDeleteLargeOld = () =>
    Alert.alert('Delete Large + Old', 'Delete large+old files via quarantine?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          withAction('Deleting large + old files', async () => {
            if (!ensureConnected()) return;
            const sid = await ensureSnapshot();
            const started = await diskIntelApi.deleteLargeOld({
              snapshot_id: sid,
              roots: [rootPath],
              min_size: minSize,
              older_than_days: toNumber(olderDays) ?? 180,
              limit: 2000,
              quarantine_mode: true,
              force_high_risk: false,
              confirm: true,
            });
            await pollJob(started.job_id, 'Delete Large + Old');
          }),
      },
    ]);

  const runCleanLogsTemp = () =>
    Alert.alert('Clean Logs/Temp', 'Delete logs/temp files via quarantine?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          withAction('Cleaning logs/temp', async () => {
            if (!ensureConnected()) return;
            const sid = await ensureSnapshot();
            const started = await diskIntelApi.cleanLogsTemp({
              snapshot_id: sid,
              roots: [rootPath],
              limit: 2000,
              quarantine_mode: true,
              force_high_risk: false,
              confirm: true,
            });
            await pollJob(started.job_id, 'Clean Logs/Temp');
          }),
      },
    ]);

  const runUndoLast = () =>
    withAction('Undo cleanup action', async () => {
      if (!ensureConnected()) return;
      const actionId = lastActionId.trim();
      if (!actionId) throw new Error('No action ID found yet. Run delete/clean action first.');
      const started = await diskIntelApi.undoCleanup(actionId);
      await pollJob(started.job_id, 'Undo Cleanup');
    });

  const pick = (...values: any[]) => values.find((v) => v !== undefined && v !== null);
  const toList = (v: any): any[] => {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    if (typeof v === 'object') {
      return Object.entries(v).map(([key, val]) => {
        if (val && typeof val === 'object') {
          return { key, ...(val as any) };
        }
        return { key, value: val };
      });
    }
    return [];
  };

  const summary = pick((visualData as any)?.summary, (visualData as any)?.snapshot);
  const largest =
    pick(
      (visualData as any)?.largest_files,
      (visualData as any)?.largest?.largest_files,
      (visualData as any)?.largestFiles,
      (visualData as any)?.largest?.items,
      (visualData as any)?.largest?.data,
    );
  const folders = pick(
    (visualData as any)?.folder_sizes,
    (visualData as any)?.folders?.folders,
    (visualData as any)?.folders,
  );
  const types =
    pick(
      (visualData as any)?.type_distribution,
      (visualData as any)?.types?.types,
      (visualData as any)?.types,
    );
  const extensions =
    pick(
      (visualData as any)?.extension_frequency,
      (visualData as any)?.extensions?.extensions,
      (visualData as any)?.extensions,
    );
  const histogram =
    pick(
      (visualData as any)?.size_histogram,
      (visualData as any)?.histogram?.histogram,
      (visualData as any)?.histogram,
    );
  const largeOld =
    pick(
      (visualData as any)?.large_old_default,
      (visualData as any)?.large_and_old,
      (visualData as any)?.large_old?.large_and_old,
      (visualData as any)?.large_old,
    );
  const dupClusters = pick(
    (visualData as any)?.clusters,
    (visualData as any)?.report?.duplicates?.clusters,
    (visualData as any)?.duplicates?.clusters,
  );
  const overviewFields = Object.entries((visualData || {}) as Record<string, any>).filter(
    ([, v]) => ['string', 'number', 'boolean'].includes(typeof v),
  );
  const collectionFields = Object.entries((visualData || {}) as Record<string, any>).filter(
    ([, v]) => Array.isArray(v) || (v && typeof v === 'object'),
  );
  const summaryObj = (summary as Record<string, any>) || {};
  const totalFiles = Number(summaryObj.total_files ?? summaryObj.file_count ?? 0);
  const totalBytes = Number(summaryObj.total_bytes ?? summaryObj.size_bytes ?? 0);
  const largestList = toList(largest);
  const largestBytes = Number((largestList[0] as any)?.size ?? 0);
  const dupList = toList(dupClusters);
  const dupClusterCount = dupList.length;
  const dupFileCount = dupList.reduce((sum, c: any) => sum + Number(c.files?.length || c.duplicates?.length || 0), 0);
  const dupSavingsBytes = dupList.reduce((sum, c: any) => sum + Number(c.waste_bytes || c.savings_bytes || 0), 0);
  const dupSavingsPct = totalBytes > 0 ? Math.min(100, Math.round((dupSavingsBytes / totalBytes) * 100)) : 0;
  const largeOldCount = toList(largeOld).length;

  const ActionCard = ({
    title,
    sub,
    icon,
    onPress,
    danger = false,
  }: {
    title: string;
    sub: string;
    icon: string;
    onPress: () => void;
    danger?: boolean;
  }) => (
    <TouchableOpacity
      style={[
        styles.tile,
        danger ? { borderColor: colors.dangerDim, backgroundColor: colors.dangerBg } : undefined,
      ]}
      onPress={onPress}
      disabled={busy}
      activeOpacity={0.85}
    >
      <View
        style={[
          styles.tileIconWrap,
          {
            backgroundColor: danger ? colors.dangerBg : colors.accentBg,
            borderWidth: 1,
            borderColor: danger ? colors.dangerDim : colors.accentDim,
          },
        ]}
      >
        <MaterialCommunityIcons
          name={icon as any}
          size={20}
          color={danger ? colors.danger : colors.accent}
        />
      </View>
      <Text style={styles.tileTitle}>{title}</Text>
      <Text style={styles.tileSub}>{sub}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4, marginRight: 4 }}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={colors.text} />
          </TouchableOpacity>
          <MaterialCommunityIcons name="devices" size={20} color={colors.accent} style={{ marginRight: 8 }} />
          <Text style={[styles.brand, { marginLeft: 0 }]}>Connected Devices</Text>
          {busy ? <ActivityIndicator color={colors.accent} /> : <View style={{ width: 20 }} />}
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionTitle}>Connect Server</Text>
          <TouchableOpacity
            style={[styles.scanButton, { marginBottom: 8 }]}
            onPress={() => navigation.navigate('ServerQrScanner' as never)}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="qrcode-scan" size={18} color={colors.bg} />
            <Text style={styles.scanButtonText}>Scan Server QR</Text>
          </TouchableOpacity>

          <View style={styles.statsCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.statLabel}>Server Connection</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: connectedUrl ? colors.accent : colors.danger,
                  }}
                />
                <Text style={styles.miniPkg}>{connectedUrl ? 'Connected' : 'Not connected'}</Text>
              </View>
            </View>

            <View
              style={{
                marginTop: 8,
                backgroundColor: colors.cardLight,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: 12,
                padding: 10,
              }}
            >
              <Text style={[styles.miniPkg, { marginTop: 0 }]} numberOfLines={2}>
                {connectedUrl}
              </Text>
            </View>

            <View style={{ marginTop: 10 }}>
              <Text style={styles.miniPkg}>For phone, run server with --host 0.0.0.0 --port 8001</Text>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              <View style={{ backgroundColor: colors.cardLight, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Text style={styles.miniPkg}>Snapshot: {snapshotId || 'auto'}</Text>
              </View>
              <View style={{ backgroundColor: colors.cardLight, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Text style={styles.miniPkg}>Min: {minSize}</Text>
              </View>
              <View style={{ backgroundColor: colors.cardLight, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Text style={styles.miniPkg}>Older: {olderDays}d</Text>
              </View>
            </View>

            <View style={{ marginTop: 10 }}>
              <Text style={styles.miniPkg} numberOfLines={1}>Root: {rootPath}</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Analysis Actions</Text>
          <View style={styles.tileContainer}>
            <ActionCard title="Health Check" sub="Connectivity" icon="heart-pulse" onPress={runHealth} />
            <ActionCard title="Start Scan" sub="Extract metadata" icon="radar" onPress={runScan} />
            <ActionCard title="Run Analysis" sub="Complete report" icon="chart-arc" onPress={runAnalysis} />
            <ActionCard title="Snapshot Stats" sub="Largest/folders/types" icon="view-dashboard" onPress={runSnapshotStats} />
            <ActionCard title="Duplicates" sub="Find duplicate clusters" icon="content-copy" onPress={runDuplicates} />
            <ActionCard title="Large + Old" sub="Candidate files" icon="file-clock-outline" onPress={runLargeOld} />
            <ActionCard title="Cleanup Dry-Run" sub="Safe preview" icon="shield-check-outline" onPress={runCleanupDry} />
          </View>

          <Text style={styles.sectionTitle}>Cleanup Actions</Text>
          <View style={styles.tileContainer}>
            <ActionCard title="Smart Remove Duplicates" sub="Analyze then confirm delete" icon="auto-fix" onPress={runSmartDeleteDuplicates} />
            <ActionCard title="Delete Duplicates" sub="Quarantine delete" icon="delete-sweep" onPress={runDeleteDuplicates} danger />
            <ActionCard title="Delete Large + Old" sub="Quarantine delete" icon="trash-can-outline" onPress={runDeleteLargeOld} danger />
            <ActionCard title="Clean Logs/Temp" sub="Quarantine delete" icon="broom" onPress={runCleanLogsTemp} danger />
            <ActionCard title="Undo Last Cleanup" sub="Restore from quarantine" icon="restore" onPress={runUndoLast} />
          </View>

          <Text style={styles.sectionTitle}>Connected Actions</Text>
          <View style={styles.statsCard}>
            <TouchableOpacity style={styles.scanButton} onPress={loadConnectedActions} disabled={busy}>
              <MaterialCommunityIcons name="link-variant" size={18} color={colors.bg} />
              <Text style={styles.scanButtonText}>Load Actions From Server</Text>
            </TouchableOpacity>
            {availableActions.length > 0 && (
              <View style={{ marginTop: 10 }}>
                {availableActions.map((a, idx) => (
                  <View key={`${a.id || idx}`} style={styles.statRow}>
                    <Text style={styles.statLabel}>{String(a.label || a.id || `action-${idx + 1}`)}</Text>
                    <Text style={styles.statValue}>
                      {String(a.kind || 'action')}
                      {(a as any)?.destructive ? ' • destructive' : ''}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.statsCard}>
            <Text style={styles.statLabel}>Status</Text>
            <Text style={[styles.statValue, { marginTop: 6 }]}>{status}</Text>
            {!!lastActionId && (
              <>
                <Text style={[styles.statLabel, { marginTop: 10 }]}>Last Action ID</Text>
                <Text style={styles.statValue}>{lastActionId}</Text>
              </>
            )}
          </View>

          <Text style={styles.sectionTitle}>Visualized Data</Text>
          {(totalFiles > 0 || totalBytes > 0 || dupClusterCount > 0) && (
            <View style={styles.statsCard}>
              <Text style={styles.statLabel}>Quick Insights</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                <View style={{ flex: 1, backgroundColor: colors.cardLight, borderRadius: 12, padding: 10 }}>
                  <Text style={styles.miniPkg}>Files</Text>
                  <Text style={styles.statValue}>{totalFiles || '-'}</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: colors.cardLight, borderRadius: 12, padding: 10 }}>
                  <Text style={styles.miniPkg}>Total Size</Text>
                  <Text style={styles.statValue}>{totalBytes > 0 ? toHumanBytes(totalBytes) : '-'}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                <View style={{ flex: 1, backgroundColor: colors.cardLight, borderRadius: 12, padding: 10 }}>
                  <Text style={styles.miniPkg}>Duplicates</Text>
                  <Text style={styles.statValue}>{dupClusterCount} clusters</Text>
                  <Text style={styles.miniPkg}>{dupFileCount} files</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: colors.cardLight, borderRadius: 12, padding: 10 }}>
                  <Text style={styles.miniPkg}>Large + Old</Text>
                  <Text style={styles.statValue}>{largeOldCount}</Text>
                  <Text style={styles.miniPkg}>candidates</Text>
                </View>
              </View>
              <View style={{ marginTop: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={styles.statLabel}>Potential Duplicate Savings</Text>
                  <Text style={styles.statValue}>{toHumanBytes(dupSavingsBytes)}</Text>
                </View>
                <View style={{ height: 8, backgroundColor: colors.border, borderRadius: 999, marginTop: 6, overflow: 'hidden' }}>
                  <View style={{ height: 8, width: `${Math.max(2, dupSavingsPct)}%`, backgroundColor: colors.warn }} />
                </View>
              </View>
              <View style={{ marginTop: 10 }}>
                <Text style={styles.miniPkg}>Largest file: {largestBytes > 0 ? toHumanBytes(largestBytes) : '-'}</Text>
              </View>
            </View>
          )}

          {!visualData && (
            <View style={styles.statsCard}>
              <Text style={styles.statLabel}>No visualization data yet.</Text>
              <Text style={[styles.miniPkg, { marginTop: 8 }]}>
                Run "Start Scan" then "Run Analysis" to populate charts and insights.
              </Text>
            </View>
          )}

          {overviewFields.length > 0 && (
            <View style={styles.statsCard}>
              <Text style={styles.statLabel}>Overview</Text>
              {overviewFields.map(([k, v]) => (
                <View key={`overview-${k}`} style={styles.statRow}>
                  <Text style={styles.statLabel}>{k}</Text>
                  <Text style={styles.statValue}>
                    {typeof v === 'number' && k.toLowerCase().includes('byte') ? toHumanBytes(v) : String(v)}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {collectionFields.length > 0 && (
            <View style={styles.statsCard}>
              <Text style={styles.statLabel}>Collections</Text>
              {collectionFields.map(([k, v]) => {
                const list = toList(v);
                const preview = list
                  .slice(0, 3)
                  .map((x: any) => x.path || x.name || x.extension || x.key || 'item')
                  .join(', ');
                return (
                  <View key={`collection-${k}`} style={styles.statRow}>
                    <Text style={styles.statLabel}>{k}</Text>
                    <Text style={styles.statValue}>{list.length} items{preview ? ` • ${preview}` : ''}</Text>
                  </View>
                );
              })}
            </View>
          )}

          {summary && (
            <View style={styles.statsCard}>
              <Text style={styles.statLabel}>Summary</Text>
              {Object.entries(summary as Record<string, any>).map(([k, v]) => (
                <View key={k} style={styles.statRow}>
                  <Text style={styles.statLabel}>{k}</Text>
                  <Text style={styles.statValue}>{typeof v === 'number' && k.toLowerCase().includes('byte') ? toHumanBytes(v) : String(v)}</Text>
                </View>
              ))}
            </View>
          )}

          {toList(largest).length > 0 && (
            <View style={styles.statsCard}>
              <Text style={styles.statLabel}>Largest Files</Text>
              {toList(largest).slice(0, 20).map((it, i) => (
                <View key={`${it.path || i}`} style={styles.miniRow}>
                  <Text style={[styles.miniName, { flex: 1 }]} numberOfLines={1}>{it.path || `file-${i + 1}`}</Text>
                  <Text style={styles.miniPkg}>{toHumanBytes(Number(it.size || 0))}</Text>
                </View>
              ))}
            </View>
          )}

          {toList(folders).length > 0 && (
            <View style={styles.statsCard}>
              <Text style={styles.statLabel}>Largest Folders</Text>
              {toList(folders).slice(0, 20).map((it, i) => (
                <View key={`${it.path || i}`} style={styles.miniRow}>
                  <Text style={[styles.miniName, { flex: 1 }]} numberOfLines={1}>{it.path || `folder-${i + 1}`}</Text>
                  <Text style={styles.miniPkg}>{toHumanBytes(Number(it.size || 0))}</Text>
                </View>
              ))}
            </View>
          )}

          {types && typeof types === 'object' && (
            <View style={styles.statsCard}>
              <Text style={styles.statLabel}>Type Distribution</Text>
              {Object.entries(types as Record<string, any>).map(([name, val]) => {
                const bytes = Number((val as any)?.bytes ?? val ?? 0);
                const total = Object.values(types as Record<string, any>).reduce((s, x) => s + Number((x as any)?.bytes ?? x ?? 0), 0);
                const pct = total > 0 ? Math.max(2, Math.round((bytes / total) * 100)) : 0;
                return (
                  <View key={name} style={{ marginTop: 8 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={styles.statLabel}>{name}</Text>
                      <Text style={styles.statValue}>{toHumanBytes(bytes)}</Text>
                    </View>
                    <View style={{ height: 8, backgroundColor: colors.border, borderRadius: 999, marginTop: 6, overflow: 'hidden' }}>
                      <View style={{ height: 8, width: `${pct}%`, backgroundColor: colors.accent }} />
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {toList(extensions).length > 0 && (
            <View style={styles.statsCard}>
              <Text style={styles.statLabel}>Top Extensions</Text>
              {toList(extensions).slice(0, 20).map((it, i) => (
                <View key={`${it.extension || i}`} style={styles.miniRow}>
                  <Text style={[styles.miniName, { flex: 1 }]}>{it.extension || it.key || 'no-ext'}</Text>
                  <Text style={styles.miniPkg}>{it.count ?? 0} files • {toHumanBytes(Number(it.bytes ?? it.size ?? 0))}</Text>
                </View>
              ))}
            </View>
          )}

          {toList(histogram).length > 0 && (
            <View style={styles.statsCard}>
              <Text style={styles.statLabel}>Histogram</Text>
              {toList(histogram).slice(0, 20).map((bin, i) => {
                const count = Number(bin.count ?? 0);
                const max = Math.max(1, ...toList(histogram).map((x) => Number((x as any).count ?? 0)));
                const pct = Math.max(2, Math.round((count / max) * 100));
                return (
                  <View key={`${bin.label || i}`} style={{ marginTop: 8 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={styles.statLabel}>{bin.label || `${bin.min || 0} - ${bin.max || 0}`}</Text>
                      <Text style={styles.statValue}>{count}</Text>
                    </View>
                    <View style={{ height: 8, backgroundColor: colors.border, borderRadius: 999, marginTop: 6, overflow: 'hidden' }}>
                      <View style={{ height: 8, width: `${pct}%`, backgroundColor: '#82b1ff' }} />
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {toList(largeOld).length > 0 && (
            <View style={styles.statsCard}>
              <Text style={styles.statLabel}>Large + Old Candidates</Text>
              {toList(largeOld).slice(0, 20).map((it, i) => (
                <View key={`${it.path || i}`} style={styles.miniRow}>
                  <Text style={[styles.miniName, { flex: 1 }]} numberOfLines={1}>{it.path || `candidate-${i + 1}`}</Text>
                  <Text style={styles.miniPkg}>{toHumanBytes(Number(it.size || 0))}</Text>
                </View>
              ))}
            </View>
          )}

          {toList(dupClusters).length > 0 && (
            <View style={styles.statsCard}>
              <Text style={styles.statLabel}>Duplicate Clusters</Text>
              {toList(dupClusters).slice(0, 20).map((c, i) => (
                <View key={`cluster-${i}`} style={styles.miniRow}>
                  <Text style={[styles.miniName, { flex: 1 }]}>Cluster {i + 1} • {c.files?.length || c.duplicates?.length || 0} files</Text>
                  <Text style={styles.miniPkg}>Save {toHumanBytes(Number(c.waste_bytes || c.savings_bytes || 0))}</Text>
                </View>
              ))}
            </View>
          )}

        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
