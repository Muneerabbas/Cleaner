import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { styles, colors } from "./styles";

const API_KEY = "AIzaSyA_eLAxRVPyYxRfudCg1dQWha6iQan8ZzE";

function extractFolderId(input) {
  if (!input || !input.trim()) return null;
  const clean = input.trim();
  // Direct folder ID (no slashes, no dots)
  if (/^[a-zA-Z0-9_-]{10,}$/.test(clean)) return clean;
  // https://drive.google.com/drive/folders/FOLDER_ID...
  const m1 = clean.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];
  // https://drive.google.com/open?id=FOLDER_ID
  const m2 = clean.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2) return m2[1];
  return null;
}

function categorize(file) {
  const size = Number(file.size || 0);
  const name = (file.name || "").toLowerCase();
  const mime = (file.mimeType || "").toLowerCase();

  const junkExts = [".tmp", ".log", ".bak", ".old", ".cache", ".ds_store", "thumbs.db"];
  const isJunk = junkExts.some((e) => name.endsWith(e));
  const isLarge = size >= 100 * 1024 * 1024; // 100 MB
  return { isJunk, isLarge };
}

export default function DriveScreen() {
  const [link, setLink] = useState("");
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all"); // all | large | junk

  const analyze = async () => {
    const folderId = extractFolderId(link);
    if (!folderId) {
      Alert.alert("Invalid Link", "Paste a public Google Drive folder link or folder ID.");
      return;
    }
    setLoading(true);
    setError(null);
    setFiles([]);
    setScanned(false);
    try {
      let allFiles = [];
      let pageToken = null;
      // Fetch all pages (up to 500 files)
      do {
        const url =
          `https://www.googleapis.com/drive/v3/files` +
          `?q='${folderId}'+in+parents+and+trashed=false` +
          `&fields=nextPageToken,files(id,name,size,mimeType,modifiedTime)` +
          `&pageSize=100&orderBy=quotaBytesUsed+desc` +
          `&key=${API_KEY}` +
          (pageToken ? `&pageToken=${pageToken}` : "");

        const res = await fetch(url);
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          const msg = errData?.error?.message || `HTTP ${res.status}`;
          throw new Error(msg);
        }
        const data = await res.json();
        allFiles = allFiles.concat(data.files || []);
        pageToken = data.nextPageToken;
      } while (pageToken && allFiles.length < 500);

      // Sort by size descending
      allFiles.sort((a, b) => Number(b.size || 0) - Number(a.size || 0));
      setFiles(allFiles);
      setScanned(true);
    } catch (e) {
      setError(e.message || "Failed to fetch files");
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes) return "—";
    const n = Number(bytes);
    if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
    if (n >= 1024 * 1024) return `${Math.round(n / 1024 / 1024)} MB`;
    if (n >= 1024) return `${Math.round(n / 1024)} KB`;
    return `${n} B`;
  };

  const getFileIcon = (mimeType) => {
    if (!mimeType) return "file-outline";
    if (mimeType.includes("folder")) return "folder-outline";
    if (mimeType.includes("image")) return "image-outline";
    if (mimeType.includes("video")) return "video-outline";
    if (mimeType.includes("audio")) return "music-note-outline";
    if (mimeType.includes("pdf")) return "file-pdf-box";
    if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return "file-excel-outline";
    if (mimeType.includes("document") || mimeType.includes("word")) return "file-word-outline";
    if (mimeType.includes("presentation")) return "file-powerpoint-outline";
    if (mimeType.includes("zip") || mimeType.includes("compressed")) return "zip-box-outline";
    return "file-outline";
  };

  // Filter + stats
  const analyzed = files.map((f) => ({ ...f, ...categorize(f) }));
  const largeFiles = analyzed.filter((f) => f.isLarge);
  const junkFiles = analyzed.filter((f) => f.isJunk);
  const totalSize = analyzed.reduce((s, f) => s + Number(f.size || 0), 0);
  const largeSize = largeFiles.reduce((s, f) => s + Number(f.size || 0), 0);
  const junkSize = junkFiles.reduce((s, f) => s + Number(f.size || 0), 0);

  const displayed =
    filter === "large" ? largeFiles : filter === "junk" ? junkFiles : analyzed;

  const FILTERS = [
    { key: "all", label: `All (${analyzed.length})`, icon: "format-list-bulleted" },
    { key: "large", label: `Large (${largeFiles.length})`, icon: "file-alert" },
    { key: "junk", label: `Junk (${junkFiles.length})`, icon: "delete-sweep" },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={[styles.avatar, { backgroundColor: "rgba(66, 133, 244, 0.15)" }]}>
            <MaterialCommunityIcons name="google-drive" size={18} color="#4285F4" />
          </View>
          <Text style={styles.brand}>Drive Analyzer</Text>
          <View style={styles.headerIcons}>
            <MaterialCommunityIcons name="cloud-search-outline" size={18} color={colors.textSec} />
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Input Card */}
          <View style={[styles.statsCard, { gap: 12 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <MaterialCommunityIcons name="link-variant" size={18} color={colors.accent} />
              <Text style={styles.listTitle}>Public Drive Folder</Text>
            </View>
            <Text style={styles.listSubtitle}>
              Paste a public Google Drive folder link to analyze its contents.
            </Text>
            <TextInput
              style={{
                backgroundColor: colors.bg,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.border,
                color: colors.text,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 13,
                fontFamily: "Poppins-Regular",
              }}
              placeholder="https://drive.google.com/drive/folders/..."
              placeholderTextColor={colors.textDim}
              value={link}
              onChangeText={setLink}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.scanButton, { marginBottom: 0, backgroundColor: "#4285F4" }]}
              onPress={analyze}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <MaterialCommunityIcons name="magnify" size={18} color="#fff" />
                  <Text style={[styles.scanButtonText, { color: "#fff" }]}>
                    {scanned ? "Re-analyze" : "Analyze Folder"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Error */}
          {error && (
            <View style={[styles.statsCard, { borderColor: colors.dangerDim, marginTop: 10 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <MaterialCommunityIcons name="alert-circle" size={18} color={colors.danger} />
                <Text style={{ color: colors.danger, fontSize: 13, flex: 1, fontFamily: "Poppins-Regular" }}>
                  {error}
                </Text>
              </View>
            </View>
          )}

          {/* Loading */}
          {loading && (
            <View style={styles.emptyState}>
              <ActivityIndicator color="#4285F4" size="large" />
              <Text style={[styles.emptyText, { marginTop: 12 }]}>
                Fetching files from Drive...
              </Text>
            </View>
          )}

          {/* Results */}
          {scanned && !loading && (
            <>
              {/* Stats Cards */}
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                <View style={[styles.statsCard, { flex: 1, alignItems: "center", marginTop: 0 }]}>
                  <Text style={[styles.statBigValue, { fontSize: 20, color: "#4285F4" }]}>
                    {analyzed.length}
                  </Text>
                  <Text style={styles.listSubtitle}>Files</Text>
                </View>
                <View style={[styles.statsCard, { flex: 1, alignItems: "center", marginTop: 0 }]}>
                  <Text style={[styles.statBigValue, { fontSize: 20, color: colors.warn }]}>
                    {formatBytes(totalSize)}
                  </Text>
                  <Text style={styles.listSubtitle}>Total</Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <View style={[styles.statsCard, { flex: 1, alignItems: "center", marginTop: 0 }]}>
                  <Text style={[styles.statBigValue, { fontSize: 20, color: colors.danger }]}>
                    {largeFiles.length}
                  </Text>
                  <Text style={styles.listSubtitle}>Large ({formatBytes(largeSize)})</Text>
                </View>
                <View style={[styles.statsCard, { flex: 1, alignItems: "center", marginTop: 0 }]}>
                  <Text style={[styles.statBigValue, { fontSize: 20, color: "#ffab40" }]}>
                    {junkFiles.length}
                  </Text>
                  <Text style={styles.listSubtitle}>Junk ({formatBytes(junkSize)})</Text>
                </View>
              </View>

              {/* Filter Tabs */}
              <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
                {FILTERS.map((f) => (
                  <TouchableOpacity
                    key={f.key}
                    onPress={() => setFilter(f.key)}
                    activeOpacity={0.7}
                    style={{
                      flex: 1,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                      paddingVertical: 10,
                      borderRadius: 12,
                      backgroundColor: filter === f.key ? colors.accent : colors.card,
                      borderWidth: 1,
                      borderColor: filter === f.key ? colors.accent : colors.border,
                    }}
                  >
                    <MaterialCommunityIcons
                      name={f.icon}
                      size={14}
                      color={filter === f.key ? colors.bg : colors.textSec}
                    />
                    <Text
                      style={{
                        color: filter === f.key ? colors.bg : colors.textSec,
                        fontSize: 11,
                        fontFamily: "Poppins-SemiBold",
                      }}
                    >
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* File List */}
              {displayed.length === 0 ? (
                <View style={styles.emptyState}>
                  <MaterialCommunityIcons
                    name="check-circle-outline"
                    size={48}
                    color={colors.accent}
                  />
                  <Text style={styles.emptyText}>
                    {filter === "large"
                      ? "No large files found (100 MB+)"
                      : filter === "junk"
                        ? "No junk files found"
                        : "No files in this folder"}
                  </Text>
                </View>
              ) : (
                displayed.map((file) => (
                  <View key={file.id} style={[styles.fileCard, { marginTop: 6 }]}>
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        backgroundColor: file.isJunk
                          ? "rgba(255, 171, 64, 0.1)"
                          : file.isLarge
                            ? "rgba(255, 107, 107, 0.1)"
                            : "rgba(66, 133, 244, 0.1)",
                        alignItems: "center",
                        justifyContent: "center",
                        marginRight: 12,
                      }}
                    >
                      <MaterialCommunityIcons
                        name={getFileIcon(file.mimeType)}
                        size={20}
                        color={file.isJunk ? "#ffab40" : file.isLarge ? colors.danger : "#4285F4"}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.miniName, { fontSize: 13 }]} numberOfLines={1}>
                        {file.name}
                      </Text>
                      <Text style={styles.miniPkg}>{formatBytes(file.size)}</Text>
                    </View>
                    {(file.isLarge || file.isJunk) && (
                      <View
                        style={{
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                          borderRadius: 6,
                          backgroundColor: file.isLarge
                            ? "rgba(255, 107, 107, 0.12)"
                            : "rgba(255, 171, 64, 0.12)",
                          marginLeft: 8,
                        }}
                      >
                        <Text
                          style={{
                            color: file.isLarge ? colors.danger : "#ffab40",
                            fontSize: 9,
                            fontFamily: "Poppins-SemiBold",
                          }}
                        >
                          {file.isLarge ? "LARGE" : "JUNK"}
                        </Text>
                      </View>
                    )}
                  </View>
                ))
              )}
            </>
          )}

          {/* Empty state before scan */}
          {!scanned && !loading && !error && (
            <View style={[styles.emptyState, { marginTop: 20 }]}>
              <MaterialCommunityIcons name="cloud-search-outline" size={56} color={colors.textDim} />
              <Text style={styles.emptyText}>
                Paste a public Drive folder link above{"\n"}to find large and junk files.
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
