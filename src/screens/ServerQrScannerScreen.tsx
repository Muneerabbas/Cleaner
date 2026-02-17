import React, { useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation } from '@react-navigation/native';
import { colors, styles } from './styles';
import { diskIntelApi } from '../services/diskIntelApi';

function extractUrl(payload: string): string | null {
  const trimmed = payload.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed.replace(/\/+$/, '');
  }
  try {
    const parsed = JSON.parse(trimmed);
    const url = parsed?.connect_url || parsed?.url || parsed?.server_url;
    if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
      return url.replace(/\/+$/, '');
    }
  } catch {
    // ignore parse error
  }
  return null;
}

export default function ServerQrScannerScreen() {
  const navigation = useNavigation();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  const onScan = (raw: string) => {
    if (scanned) return;
    const url = extractUrl(raw);
    if (!url) {
      Alert.alert('Invalid QR', 'QR must contain server URL (http://...:8001)');
      return;
    }
    setScanned(true);
    diskIntelApi.setBaseUrl(url);
    Alert.alert('Connected', `Server URL set to ${url}`, [
      {
        text: 'OK',
        onPress: () => navigation.goBack(),
      },
    ]);
  };

  if (!permission) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={styles.statLabel}>Loading camera permission...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.root}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4, marginRight: 4 }}>
              <MaterialCommunityIcons name="arrow-left" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.brand, { marginLeft: 0 }]}>Scan Server QR</Text>
            <View style={{ width: 20 }} />
          </View>
          <View style={styles.statsCard}>
            <Text style={styles.statLabel}>Camera permission required</Text>
            <TouchableOpacity style={[styles.scanButton, { marginTop: 12 }]} onPress={requestPermission}>
              <MaterialCommunityIcons name="camera" size={18} color={colors.bg} />
              <Text style={styles.scanButtonText}>Grant Camera Access</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4, marginRight: 4 }}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.brand, { marginLeft: 0 }]}>Scan Server QR</Text>
          <TouchableOpacity onPress={() => setScanned(false)} style={{ padding: 4 }}>
            <MaterialCommunityIcons name="refresh" size={22} color={colors.accent} />
          </TouchableOpacity>
        </View>

        <View style={{ marginHorizontal: 20, marginTop: 8, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
          <CameraView
            style={{ width: '100%', height: 420 }}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={scanned ? undefined : (e) => onScan(e.data)}
          />
        </View>

        <View style={styles.statsCard}>
          <Text style={styles.statLabel}>Point camera at server QR code shown at startup (`/connect` page).</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
