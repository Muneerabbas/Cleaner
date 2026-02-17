import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fonts, styles } from './styles';
import { diskIntelApi } from '../services/diskIntelApi';

function toNumber(value: string): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export default function DiskIntelScreen() {
  const navigation = useNavigation();

  const [baseUrl, setBaseUrl] = useState(diskIntelApi.getBaseUrl());
  const [rootPath, setRootPath] = useState('/home/manas/Documents/Cleaner');
  const [snapshotId, setSnapshotId] = useState('');
  const [minSize, setMinSize] = useState('500MB');
  const [olderDays, setOlderDays] = useState('180');
  const [actionId, setActionId] = useState('');
  const [executeCleanup, setExecuteCleanup] = useState(false);
  const [forceHighRisk, setForceHighRisk] = useState(false);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [output, setOutput] = useState('');

  const resolvedSnapshotId = useMemo(() => toNumber(snapshotId), [snapshotId]);

  const withAction = async (name: string, fn: () => Promise<void>) => {
    setBusy(true);
    setStatus(name);
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setOutput(msg);
      Alert.alert('API Error', msg);
    } finally {
      setBusy(false);
    }
  };

  const pollJob = async (jobId: string, label: string) => {
    for (let i = 0; i < 180; i += 1) {
      const job = await diskIntelApi.getJob(jobId);
      const pct = Number(job.progress?.pct ?? 0);
      const phase = String(job.progress?.phase ?? 'running');
      setStatus(`${label}: ${phase} ${Math.round(pct)}%`);
      if (job.status === 'completed' || job.status === 'failed') {
        const result = await diskIntelApi.getJobResult(jobId);
        setOutput(JSON.stringify(result, null, 2));
        return result;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`${label} timed out.`);
  };

  const applyBaseUrl = () => {
    diskIntelApi.setBaseUrl(baseUrl);
    Alert.alert('Updated', `API base URL set to ${diskIntelApi.getBaseUrl()}`);
  };

  const onHealth = () =>
    withAction('Health check', async () => {
      const health = await diskIntelApi.health();
      setOutput(JSON.stringify(health, null, 2));
      setStatus('Healthy');
    });

  const openActionScreen = (action: 'scan' | 'analysis' | 'cleanup', title: string) => {
    navigation.navigate(
      'DeviceAction' as never,
      {
        action,
        title,
        baseUrl: diskIntelApi.getBaseUrl(),
        rootPath,
      } as never,
    );
  };

  const onStartScan = () =>
    withAction('Starting scan', async () => {
      const scan = await diskIntelApi.startScan({
        roots: [rootPath],
        follow_symlinks: false,
        include_hidden: true,
      });
      const result = await pollJob(scan.job_id, 'Scan');
      const sid = (result as any)?.result?.snapshot_id;
      if (sid) setSnapshotId(String(sid));
    });

  const onLatestSnapshot = () =>
    withAction('Fetching latest snapshot', async () => {
      const latest = await diskIntelApi.latestSnapshot();
      setOutput(JSON.stringify(latest, null, 2));
      const sid = (latest as any)?.snapshot?.snapshot_id;
      if (sid) setSnapshotId(String(sid));
      setStatus('Latest snapshot loaded');
    });

  const onRunAnalysis = () =>
    withAction('Running analysis', async () => {
      const run = await diskIntelApi.runAnalysis({
        snapshot_id: resolvedSnapshotId,
        top_n: 50,
        include_duplicates: includeDuplicates,
      });
      await pollJob(run.job_id, 'Analysis');
    });

  const onDuplicates = () =>
    withAction('Finding duplicates', async () => {
      const run = await diskIntelApi.runDuplicates({ snapshot_id: resolvedSnapshotId });
      await pollJob(run.job_id, 'Duplicates');
    });

  const onLargeOld = () =>
    withAction('Filtering large/old', async () => {
      const data = await diskIntelApi.filterLargeOld({
        snapshot_id: resolvedSnapshotId,
        min_size: minSize,
        older_than_days: toNumber(olderDays) ?? 180,
        limit: 100,
      });
      setOutput(JSON.stringify(data, null, 2));
      setStatus('Large/old filter done');
    });

  const onSnapshotStats = () =>
    withAction('Snapshot analytics', async () => {
      if (!resolvedSnapshotId) throw new Error('Set snapshot ID first.');
      const [largest, folders, types, ext, pareto, hist] = await Promise.all([
        diskIntelApi.largestFiles(resolvedSnapshotId, 20),
        diskIntelApi.folderAggregation(resolvedSnapshotId, 20),
        diskIntelApi.typeDistribution(resolvedSnapshotId),
        diskIntelApi.extensionFrequency(resolvedSnapshotId, 20),
        diskIntelApi.pareto(resolvedSnapshotId),
        diskIntelApi.histogram(resolvedSnapshotId),
      ]);
      setOutput(
        JSON.stringify({ largest, folders, types, extensions: ext, pareto, histogram: hist }, null, 2),
      );
      setStatus('Snapshot analytics done');
    });

  const onCleanup = () =>
    withAction(executeCleanup ? 'Executing cleanup' : 'Dry-run cleanup', async () => {
      const run = await diskIntelApi.runCleanup({
        snapshot_id: resolvedSnapshotId,
        mode: 'large-old',
        roots: [rootPath],
        min_size: minSize,
        older_than_days: toNumber(olderDays) ?? 180,
        limit: 500,
        execute: executeCleanup,
        force_high_risk: forceHighRisk,
        quarantine_mode: true,
        confirm: executeCleanup,
      });
      await pollJob(run.job_id, 'Cleanup');
    });

  const onUndo = () =>
    withAction('Undo cleanup', async () => {
      if (!actionId.trim()) throw new Error('Enter action ID from cleanup result.');
      const run = await diskIntelApi.undoCleanup(actionId.trim());
      await pollJob(run.job_id, 'Undo');
    });

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4, marginRight: 4 }}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={colors.text} />
          </TouchableOpacity>
          <MaterialCommunityIcons name="api" size={20} color={colors.accent} style={{ marginRight: 8 }} />
          <Text style={[styles.brand, { marginLeft: 0 }]}>Disk Intelligence API</Text>
          {busy ? <ActivityIndicator color={colors.accent} /> : <View style={{ width: 20 }} />}
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.statsCard}>
            <Text style={[styles.statLabel, { marginBottom: 8 }]}>Server Base URL</Text>
            <TextInput
              value={baseUrl}
              onChangeText={setBaseUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="http://192.168.x.x:8001"
              placeholderTextColor={colors.textDim}
              style={{
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
            <TouchableOpacity style={[styles.scanButton, { marginTop: 10, marginBottom: 0 }]} onPress={applyBaseUrl}>
              <Text style={styles.scanButtonText}>Apply API URL</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.statsCard}>
            <Text style={styles.statLabel}>Root Path</Text>
            <TextInput
              value={rootPath}
              onChangeText={setRootPath}
              autoCapitalize="none"
              autoCorrect={false}
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

            <Text style={[styles.statLabel, { marginTop: 12 }]}>Snapshot ID (optional)</Text>
            <TextInput
              value={snapshotId}
              onChangeText={setSnapshotId}
              keyboardType="numeric"
              placeholder="Latest if empty"
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

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.statLabel}>Min Size</Text>
                <TextInput
                  value={minSize}
                  onChangeText={setMinSize}
                  placeholder="500MB"
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
              </View>
            </View>

            <View style={[styles.statRow, { borderBottomWidth: 0, paddingBottom: 0, marginTop: 4 }]}>
              <Text style={styles.statLabel}>Include duplicates in analysis job</Text>
              <Switch
                value={includeDuplicates}
                onValueChange={setIncludeDuplicates}
                thumbColor={includeDuplicates ? colors.accent : colors.textSec}
                trackColor={{ false: colors.border, true: colors.accentDim }}
              />
            </View>
            <View style={[styles.statRow, { borderBottomWidth: 0, paddingBottom: 0 }]}>
              <Text style={styles.statLabel}>Execute cleanup (off = dry-run)</Text>
              <Switch
                value={executeCleanup}
                onValueChange={setExecuteCleanup}
                thumbColor={executeCleanup ? colors.warn : colors.textSec}
                trackColor={{ false: colors.border, true: colors.dangerDim }}
              />
            </View>
            <View style={[styles.statRow, { borderBottomWidth: 0, paddingBottom: 0 }]}>
              <Text style={styles.statLabel}>Force high-risk delete</Text>
              <Switch
                value={forceHighRisk}
                onValueChange={setForceHighRisk}
                thumbColor={forceHighRisk ? colors.danger : colors.textSec}
                trackColor={{ false: colors.border, true: colors.dangerDim }}
              />
            </View>
          </View>

          <View style={styles.tileContainer}>
            <TouchableOpacity style={styles.tile} onPress={onHealth} disabled={busy}>
              <View style={[styles.tileIconWrap, { backgroundColor: 'rgba(130,177,255,0.12)' }]}>
                <MaterialCommunityIcons name="heart-pulse" size={22} color="#82b1ff" />
              </View>
              <Text style={styles.tileTitle}>Health</Text>
              <Text style={styles.tileSub}>Check API status</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.tile} onPress={() => openActionScreen('scan', 'Start Scan')} disabled={busy}>
              <View style={[styles.tileIconWrap, { backgroundColor: colors.accentBg }]}>
                <MaterialCommunityIcons name="magnify-scan" size={22} color={colors.accent} />
              </View>
              <Text style={styles.tileTitle}>Start Scan</Text>
              <Text style={styles.tileSub}>Open analysis screen</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.tile} onPress={() => openActionScreen('analysis', 'Latest Snapshot')} disabled={busy}>
              <View style={[styles.tileIconWrap, { backgroundColor: 'rgba(130,177,255,0.12)' }]}>
                <MaterialCommunityIcons name="clock-time-four-outline" size={22} color="#82b1ff" />
              </View>
              <Text style={styles.tileTitle}>Latest Snapshot</Text>
              <Text style={styles.tileSub}>Open analysis screen</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.tile} onPress={() => openActionScreen('analysis', 'Run Analysis')} disabled={busy}>
              <View style={[styles.tileIconWrap, { backgroundColor: 'rgba(255,201,92,0.12)' }]}>
                <MaterialCommunityIcons name="chart-box-outline" size={22} color={colors.warn} />
              </View>
              <Text style={styles.tileTitle}>Run Analysis</Text>
              <Text style={styles.tileSub}>Open analysis screen</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.tile} onPress={() => openActionScreen('analysis', 'Snapshot Stats')} disabled={busy}>
              <View style={[styles.tileIconWrap, { backgroundColor: 'rgba(178,160,255,0.12)' }]}>
                <MaterialCommunityIcons name="chart-pie" size={22} color="#b2a0ff" />
              </View>
              <Text style={styles.tileTitle}>Snapshot Stats</Text>
              <Text style={styles.tileSub}>Open analysis screen</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.tile} onPress={() => openActionScreen('analysis', 'Duplicates')} disabled={busy}>
              <View style={[styles.tileIconWrap, { backgroundColor: 'rgba(130,177,255,0.12)' }]}>
                <MaterialCommunityIcons name="content-copy" size={22} color="#82b1ff" />
              </View>
              <Text style={styles.tileTitle}>Duplicates</Text>
              <Text style={styles.tileSub}>Open analysis screen</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.tile} onPress={() => openActionScreen('analysis', 'Large + Old')} disabled={busy}>
              <View style={[styles.tileIconWrap, { backgroundColor: 'rgba(255,171,64,0.12)' }]}>
                <MaterialCommunityIcons name="file-alert-outline" size={22} color="#ffab40" />
              </View>
              <Text style={styles.tileTitle}>Large + Old</Text>
              <Text style={styles.tileSub}>Open analysis screen</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={[styles.scanButton, { marginTop: 14 }]} onPress={onCleanup} disabled={busy}>
            <MaterialCommunityIcons name="broom" size={18} color={colors.bg} />
            <Text style={styles.scanButtonText}>{executeCleanup ? 'Run Cleanup' : 'Dry-Run Cleanup'}</Text>
          </TouchableOpacity>

          <View style={styles.statsCard}>
            <Text style={styles.statLabel}>Undo Action ID</Text>
            <TextInput
              value={actionId}
              onChangeText={setActionId}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Paste cleanup action_id"
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
            <TouchableOpacity style={[styles.scanButton, { marginTop: 10, marginBottom: 0 }]} onPress={onUndo} disabled={busy}>
              <MaterialCommunityIcons name="undo-variant" size={18} color={colors.bg} />
              <Text style={styles.scanButtonText}>Undo Cleanup</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.statsCard}>
            <Text style={styles.statLabel}>Status</Text>
            <Text style={[styles.statValue, { marginTop: 6 }]}>{status}</Text>
            <Text style={[styles.statLabel, { marginTop: 10, marginBottom: 6 }]}>Response</Text>
            <Text style={{ color: colors.textSec, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 }}>
              {output || 'No response yet.'}
            </Text>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
