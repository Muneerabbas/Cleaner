import React, { useState } from 'react';
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
import { useNavigation } from '@react-navigation/native';
import { colors, styles } from './styles';
import { diskIntelApi } from '../services/diskIntelApi';

type Device = {
  id: string;
  name: string;
  subtitle: string;
  baseUrl: string;
  icon: string;
  iconColor: string;
};

const DEVICES: Device[] = [
  {
    id: 'this-device',
    name: 'This Device',
    subtitle: 'Use current API URL',
    baseUrl: '',
    icon: 'cellphone-cog',
    iconColor: colors.accent,
  },
  {
    id: 'android-emulator',
    name: 'Android Emulator',
    subtitle: 'Use 10.0.2.2 bridge',
    baseUrl: 'http://10.0.2.2:8001',
    icon: 'laptop',
    iconColor: '#82b1ff',
  },
  {
    id: 'lan-laptop',
    name: 'LAN Laptop',
    subtitle: 'Same Wi-Fi network',
    baseUrl: 'http://192.168.1.42:8001',
    icon: 'lan-connect',
    iconColor: '#ffab40',
  },
];

export default function ConnectedDevicesScreen() {
  const navigation = useNavigation();
  const [selected, setSelected] = useState<Device>(DEVICES[0]);
  const [customUrl, setCustomUrl] = useState(diskIntelApi.getBaseUrl());
  const [rootPath, setRootPath] = useState('/home/manas/Documents/Cleaner');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Select a device and run an action.');
  const [output, setOutput] = useState('');

  const applyDevice = (device: Device) => {
    setSelected(device);
    if (device.baseUrl) {
      diskIntelApi.setBaseUrl(device.baseUrl);
      setCustomUrl(device.baseUrl);
    }
    setStatus(`Selected: ${device.name}`);
  };

  const applyCustomUrl = () => {
    const value = customUrl.trim();
    if (!value) {
      Alert.alert('Invalid URL', 'Enter an API URL like http://192.168.1.42:8001');
      return;
    }
    diskIntelApi.setBaseUrl(value);
    setStatus(`API URL set to ${diskIntelApi.getBaseUrl()}`);
  };

  const withAction = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setStatus(label);
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const hint = msg.includes('Network request failed')
        ? '\n\nTips:\n1) Start server with --host 0.0.0.0 --port 8001\n2) Use laptop LAN URL (http://192.168.x.x:8001) on phone\n3) Rebuild app after Android manifest changes.'
        : '';
      setStatus(`Failed: ${label}`);
      setOutput(msg + hint);
      Alert.alert('Action Failed', msg + hint);
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
    throw new Error(`${label} timed out`);
  };

  const runHealth = () =>
    withAction('Checking health', async () => {
      const health = await diskIntelApi.health();
      setOutput(JSON.stringify(health, null, 2));
      setStatus('Device reachable');
    });

  const runScan = () =>
    withAction('Running scan', async () => {
      const started = await diskIntelApi.startScan({
        roots: [rootPath],
        include_hidden: true,
        follow_symlinks: false,
      });
      await pollJob(started.job_id, 'Scan');
    });

  const runAnalysis = () =>
    withAction('Running analysis', async () => {
      const started = await diskIntelApi.runAnalysis({ include_duplicates: false, top_n: 50 });
      await pollJob(started.job_id, 'Analysis');
    });

  const runCleanupDry = () =>
    withAction('Running cleanup dry-run', async () => {
      const started = await diskIntelApi.runCleanup({
        mode: 'large-old',
        roots: [rootPath],
        min_size: '500MB',
        older_than_days: 180,
        execute: false,
        confirm: false,
      });
      await pollJob(started.job_id, 'Cleanup Dry-Run');
    });

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
          <Text style={styles.sectionTitle}>Choose Device</Text>
          {DEVICES.map((d) => {
            const active = d.id === selected.id;
            return (
              <TouchableOpacity
                key={d.id}
                style={[
                  styles.listItem,
                  active ? { borderColor: colors.accent, backgroundColor: colors.cardLight } : null,
                ]}
                onPress={() => applyDevice(d)}
                activeOpacity={0.8}
              >
                <View style={styles.listIcon}>
                  <MaterialCommunityIcons name={d.icon as any} size={22} color={d.iconColor} />
                </View>
                <View style={styles.listText}>
                  <Text style={styles.listTitle}>{d.name}</Text>
                  <Text style={styles.listSubtitle}>
                    {d.subtitle} {d.baseUrl ? `• ${d.baseUrl}` : ''}
                  </Text>
                </View>
                {active ? (
                  <MaterialCommunityIcons name="check-circle" size={22} color={colors.accent} />
                ) : (
                  <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textDim} />
                )}
              </TouchableOpacity>
            );
          })}

          <View style={styles.statsCard}>
            <Text style={styles.statLabel}>Custom API URL (Phone: use laptop LAN IP)</Text>
            <TextInput
              value={customUrl}
              onChangeText={setCustomUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="http://192.168.1.42:8001"
              placeholderTextColor={colors.textDim}
              style={{
                marginTop: 8,
                backgroundColor: colors.cardLight,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: 12,
                color: colors.text,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            />
            <TouchableOpacity
              style={[styles.scanButton, { marginTop: 10, marginBottom: 0 }]}
              onPress={applyCustomUrl}
              disabled={busy}
            >
              <Text style={styles.scanButtonText}>Apply URL</Text>
            </TouchableOpacity>
            <Text style={[styles.statLabel, { marginTop: 12 }]}>Scan Root Path (on laptop/server)</Text>
            <TextInput
              value={rootPath}
              onChangeText={setRootPath}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="/home/your-user"
              placeholderTextColor={colors.textDim}
              style={{
                marginTop: 8,
                backgroundColor: colors.cardLight,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: 12,
                color: colors.text,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            />
          </View>

          <Text style={styles.sectionTitle}>Available Actions</Text>
          <View style={styles.tileContainer}>
            <TouchableOpacity style={styles.tile} onPress={runHealth} disabled={busy}>
              <View style={[styles.tileIconWrap, { backgroundColor: 'rgba(130,177,255,0.12)' }]}>
                <MaterialCommunityIcons name="heart-pulse" size={22} color="#82b1ff" />
              </View>
              <Text style={styles.tileTitle}>Health Check</Text>
              <Text style={styles.tileSub}>Verify connectivity</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.tile} onPress={runScan} disabled={busy}>
              <View style={[styles.tileIconWrap, { backgroundColor: colors.accentBg }]}>
                <MaterialCommunityIcons name="magnify-scan" size={22} color={colors.accent} />
              </View>
              <Text style={styles.tileTitle}>Start Scan</Text>
              <Text style={styles.tileSub}>Create snapshot</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.tile} onPress={runAnalysis} disabled={busy}>
              <View style={[styles.tileIconWrap, { backgroundColor: 'rgba(255,201,92,0.12)' }]}>
                <MaterialCommunityIcons name="chart-box-outline" size={22} color={colors.warn} />
              </View>
              <Text style={styles.tileTitle}>Run Analysis</Text>
              <Text style={styles.tileSub}>Largest, types, Pareto</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.tile} onPress={runCleanupDry} disabled={busy}>
              <View style={[styles.tileIconWrap, { backgroundColor: 'rgba(255,107,107,0.12)' }]}>
                <MaterialCommunityIcons name="broom" size={22} color={colors.danger} />
              </View>
              <Text style={styles.tileTitle}>Cleanup Dry-Run</Text>
              <Text style={styles.tileSub}>Safe preview only</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.statsCard}>
            <Text style={styles.statLabel}>Status</Text>
            <Text style={[styles.statValue, { marginTop: 6 }]}>{status}</Text>
            <Text style={[styles.statLabel, { marginTop: 10, marginBottom: 6 }]}>Output</Text>
            <Text style={{ color: colors.textSec, fontSize: 12, lineHeight: 18 }}>{output || 'No output yet.'}</Text>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
