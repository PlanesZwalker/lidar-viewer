import { useState, useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as DocumentPicker from 'expo-document-picker';
import { StatusBar } from 'expo-status-bar';

// ─── Config ──────────────────────────────────────────────────────────────────
// Replace with your LAN IP when running `pnpm dev` in packages/web.
// On Android emulator, 10.0.2.2 maps to the host machine's localhost.
const DEV_VIEWER_URL =
  Platform.OS === 'android' ? 'http://10.0.2.2:5173' : 'http://localhost:5173';

const VIEWER_URL = process.env.EXPO_PUBLIC_VIEWER_URL ?? DEV_VIEWER_URL;

// ─── Types ───────────────────────────────────────────────────────────────────
interface MeasurementMessage {
  type: 'measurement';
  payload: {
    id: string;
    kind: string;
    result: number | null;
    unit: string;
  };
}

// ─── Screen ──────────────────────────────────────────────────────────────────
export default function ViewerScreen() {
  const webviewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [measurements, setMeasurements] = useState<MeasurementMessage['payload'][]>([]);

  // ── Open local LAS/LAZ file and post its data to the WebView ──────────────
  const pickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*', // LAZ has no official MIME type
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset) return;

      const name = asset.name.toLowerCase();
      if (!name.endsWith('.laz') && !name.endsWith('.las') && !name.endsWith('.copc.laz')) {
        Alert.alert('Unsupported file', 'Please pick a .laz, .las, or .copc.laz file.');
        return;
      }

      // Send the file URI to the web viewer via postMessage
      webviewRef.current?.postMessage(
        JSON.stringify({ type: 'loadFile', uri: asset.uri, name: asset.name }),
      );
    } catch (err) {
      Alert.alert('Error', String(err));
    }
  }, []);

  // ── Receive measurement data from the WebView ─────────────────────────────
  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as MeasurementMessage;
      if (msg.type === 'measurement') {
        setMeasurements((prev) => {
          const idx = prev.findIndex((m) => m.id === msg.payload.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = msg.payload;
            return next;
          }
          return [...prev, msg.payload];
        });
      }
    } catch {
      // ignore malformed messages
    }
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Viewer */}
      <WebView
        ref={webviewRef}
        source={{ uri: VIEWER_URL }}
        style={styles.webview}
        onLoadEnd={() => setLoading(false)}
        onMessage={onMessage}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        // Required for SharedArrayBuffer (LAZ WASM decoders)
        originWhitelist={['*']}
        mixedContentMode="always"
      />

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#4299e1" />
          <Text style={styles.loadingText}>Loading viewer…</Text>
        </View>
      )}

      {/* Bottom toolbar */}
      <View style={styles.toolbar}>
        <Pressable style={styles.toolBtn} onPress={pickFile}>
          <Text style={styles.toolBtnText}>📁 Open File</Text>
        </Pressable>

        {measurements.length > 0 && (
          <View style={styles.measureList}>
            {measurements.slice(-3).map((m) => (
              <Text key={m.id} style={styles.measureText}>
                {m.kind}: {m.result != null ? `${m.result.toFixed(3)} ${m.unit}` : '…'}
              </Text>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a14',
  },
  webview: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0a14',
    gap: 12,
  },
  loadingText: {
    color: '#888',
    fontSize: 15,
  },
  toolbar: {
    backgroundColor: 'rgba(10,10,20,0.95)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  toolBtn: {
    backgroundColor: '#2b6cb0',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  toolBtnText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  measureList: {
    flex: 1,
    gap: 2,
  },
  measureText: {
    color: '#a0c4ff',
    fontSize: 12,
  },
});
