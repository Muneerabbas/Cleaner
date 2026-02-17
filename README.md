# EcoCleaner - Smart Storage & Carbon Footprint Analyzer

A React Native mobile app that helps users free up storage space on their Android devices while tracking the environmental impact of digital hoarding. Built with a native Kotlin engine for safe, high-performance file operations.

---

## What It Does

EcoCleaner scans your phone storage, finds wasted space (junk files, duplicates, large unused files), and lets you clean them up safely. Every file you delete is converted into an estimated CO2 saving based on the energy cost of storing digital data — making cleanup feel meaningful.

---

## App Workflow (Simple)

```
Open App
   |
   v
Dashboard (Home Tab)
   - See storage usage ring (used / total)
   - See CO2 saved today
   - Quick links to Cleaner, Apps, Connected Devices
   |
   v
Clean Tab --> Pick a category:
   - Junk Files (cache, temp, .log, .bak)
   - Large Files (100 MB+)
   - Duplicates (same content, different locations)
   - Trash (restore or permanently delete)
   - Empty Folders (remove clutter)
   - Compressor (zip large files)
   |
   v
Scan --> Select files --> Delete / Compress / Restore
   |
   v
CO2 savings update on Dashboard & Stats
```

---

## Screens & Tabs

| Tab | Screen | What It Does |
|-----|--------|-------------|
| Home | Dashboard | Storage ring, CO2 card, quick actions, unused apps list |
| Clean | Cleaner Home | 6 cleaning modes in a tile grid + Disk Intelligence API |
| Clean > [mode] | Cleaner List | Scan, select, delete/restore/compress files |
| Apps | App Manager | Lists all installed apps with size, cache, last used. Sort, uninstall, clean cache |
| Drive | Drive Analyzer | Paste a public Google Drive folder link to find large/junk files in the cloud |
| Stats | Statistics | Storage breakdown, CO2 from used storage, CO2 saved today, unused app count |

### Additional Screens (via navigation)

- **Connected Devices** — Connect to a Python-based Disk Intelligence server (local network) for cross-device scanning and cleanup
- **Device Action** — Run scan, analysis, duplicates detection, and safe cleanup on a connected device
- **QR Scanner** — Scan a QR code to quickly connect to a Disk Intelligence server

---

## How Carbon Tracking Works

Every time you delete files, the app calculates:

```
CO2 saved (kg) = (freed bytes / 1 GB) x 0.02
```

- **0.02 kg CO2 per GB** is the estimated yearly carbon footprint of storing 1 GB of data (based on data center energy studies)
- Deleting 1 GB saves roughly **20 grams of CO2**
- The app auto-scales display: shows grams for small values, kilograms for larger

The CO2 value is:
- Persisted per day (resets at midnight)
- Synced across Home and Stats screens via shared context
- Updated immediately after every cleanup action

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | React Native 0.81 + Expo modules |
| Navigation | React Navigation (bottom tabs + stack) |
| Icons | MaterialCommunityIcons (@expo/vector-icons) |
| Fonts | Poppins (Light, Regular, Medium, SemiBold, Bold, Italic) |
| Native Engine | Kotlin (Android) |
| File Operations | Custom Kotlin modules (CleanerModule, DeviceStatsModule) |
| Storage Compliance | Android Scoped Storage, MANAGE_EXTERNAL_STORAGE |
| State Management | React Context (DashboardContext) |
| Persistence | react-native-fs (JSON file for daily savings) |
| Drive Analysis | Google Drive API v3 (API key, public folders only) |
| Cross-device | Python Disk Intelligence server + REST API |

---

## Architecture

```
React Native UI (JS/TS)
        |
        v
  DashboardContext (shared state)
        |
        v
  JS Service Wrappers (storageCleaner.ts, deviceStats.ts)
        |
        v
  Native Modules (Kotlin bridge)
    - CleanerModule  --> StorageCleanerService --> FileScanner, DuplicateDetector, JunkAnalyzer, CleanupExecutor
    - DeviceStatsModule --> Android StatFs, UsageStatsManager, PackageManager
```

**Key principle:** All file scanning, hashing, and deletion runs in native Kotlin on background threads (Dispatchers.IO). The React Native UI never touches the filesystem directly.

---

## How to Run

### Prerequisites

- Node.js 20+
- Android SDK (API 24+)
- A physical Android device or emulator
- Java 17+

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Run on Android (builds native code + starts Metro)
npm run android

# 3. Or start Metro separately
npm start
# Then press 'a' to open on Android
```

### Google Drive Analyzer Setup

To use the Drive tab, you need a Google Drive API key:

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Enable **Google Drive API**
3. Create an **API Key** under Credentials
4. Replace the key in `src/screens/DriveScreen.jsx` line 15

The folder you analyze must be **shared publicly** ("Anyone with the link") in Google Drive settings.

---

## Project Structure

```
Cleaner/
├── App.tsx                          # Tab navigator + stack navigators
├── src/
│   ├── screens/
│   │   ├── HomeScreen.tsx           # Dashboard with storage ring + CO2
│   │   ├── CleanerHomeScreen.tsx    # 6 cleaning mode tiles
│   │   ├── CleanerListScreen.tsx    # Scan + select + delete UI
│   │   ├── AppsScreen.tsx           # App manager with sort/filter
│   │   ├── DriveScreen.jsx          # Google Drive folder analyzer
│   │   ├── StatsScreen.tsx          # Statistics and CO2 breakdown
│   │   ├── ConnectedDevicesScreen   # Cross-device cleanup
│   │   ├── DeviceActionScreen       # Remote device actions
│   │   ├── ServerQrScannerScreen    # QR code server connect
│   │   ├── DiskIntelScreen.tsx      # Disk Intelligence API screen
│   │   ├── DashboardContext.tsx     # Shared state provider
│   │   └── styles.ts               # Design system (colors, fonts, styles)
│   ├── native/
│   │   └── deviceStats.ts           # JS wrapper for DeviceStatsModule
│   ├── services/
│   │   ├── storageCleaner.ts        # JS wrapper for CleanerModule
│   │   └── diskIntelApi.ts          # REST client for Disk Intelligence server
│   └── utils/
│       ├── savedToday.ts            # CO2 persistence (daily reset)
│       └── cache.ts                 # Cache cleanup utility
├── android/app/src/main/java/com/cleaner/
│   ├── cleaner/
│   │   ├── CleanerModule.kt         # Native module bridge
│   │   ├── CleanerPackage.kt        # Package registration
│   │   ├── StorageCleanerService.kt # Business logic
│   │   └── core/
│   │       ├── FileScanner.kt       # File system traversal
│   │       ├── DuplicateDetector.kt # Hash-based duplicate detection
│   │       ├── JunkAnalyzer.kt      # Junk file classification
│   │       └── CleanupExecutor.kt   # Safe file deletion
│   └── devicestats/
│       ├── DeviceStatsModule.kt     # Storage stats, usage access, app info
│       └── DeviceStatsPackage.kt    # Package registration
├── assets/fonts/                    # Poppins font files (.ttf)
└── python_scripts/
    └── disk_intelligence_server.py  # Cross-device cleanup server
```

---

## Safety Features

- **Dry-run mode** — Preview what would be deleted before committing
- **Trash system** — Deleted files go to trash first (restorable)
- **Path validation** — System directories are protected from deletion
- **Permission gating** — Storage access is requested before any scan
- **Background threading** — All heavy operations run on Kotlin coroutines (IO dispatcher)
- **Scoped Storage compliance** — Works with Android 10+ restrictions

---

## Cleaning Modes

| Mode | What It Finds | How |
|------|--------------|-----|
| Junk | .tmp, .log, .bak, cache, thumbnails | Pattern matching on filenames and directories |
| Large Files | Files over 100 MB | Size-based scan with sorting |
| Duplicates | Files with identical content | MD5 hash comparison across groups |
| Trash | Previously deleted files | Reads from app's trash directory |
| Empty Folders | Directories with no files inside | Recursive directory check |
| Compressor | Large files suitable for compression | Creates ZIP archives |

---

## Cross-Device Cleanup

The app can connect to a Python server running on another machine (laptop/desktop) to scan and clean storage remotely:

1. Start the Disk Intelligence server on your computer: `python python_scripts/disk_intelligence_server.py`
2. Scan the QR code shown by the server, or enter the URL manually
3. Run scans, view analysis, find duplicates, and clean up — all from your phone

---

## Team

Built for hackathon by the Cleaner team.

---

## License

MIT
