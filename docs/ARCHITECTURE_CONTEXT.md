# Architecture Context: React Native + Native Cleaner Engine

This document records the context and reference for building the Cleaner app: **React Native UI** backed by **native Kotlin storage/cleanup logic** extracted from **Smart-Cleaner-for-Android**.

---

## Reference Project

- **Location:** `reference/Smart-Cleaner-for-Android/`
- **Type:** Native Android app (Kotlin), package `com.d4rk.cleaner`
- **Purpose (original):** Free up storage via duplicate detection, large files, junk/temp/APK/cache cleanup, trash, WhatsApp media.

The reference app mixes UI (Activities, ViewModels, Compose) with storage logic. Our goal is **not** to rewrite the cleaner in JS, but to **extract** storage/cleanup into modular Kotlin services and **bridge** them to React Native.

---

## Target Architecture

```
React Native UI (JS/TS)
        ↓
JS Service Wrapper (thin API layer)
        ↓
Native Module (Kotlin bridge)
        ↓
StorageCleanerService (Kotlin business logic)
        ↓
Core file scanning / deletion modules
```

**Strict separation:**
- **React Native:** UI only. No file system access, no storage logic, no deletion logic.
- **Kotlin:** Storage and cleanup only. No UI, no navigation, no React references.

---

## Reference: Key Kotlin Components to Extract

### Core work pipeline (already relatively clean)
| Component | Path | Role |
|-----------|------|------|
| `FileCleanWorkEnqueuer` | `core/work/FileCleanWorkEnqueuer.kt` | Chunks paths, enqueues `FileCleanupWorker`, persists work ID |
| `FileCleaner` | `core/work/FileCleaner.kt` | UI-agnostic wrapper for enqueue + callbacks (can be adapted for RN events) |
| `FileCleanupWorker` | `clean/work/FileCleanupWorker.kt` | WorkManager worker: iterates paths, delete/trash, progress notification |
| `WorkObserver` | `core/work/WorkObserver.kt` | Observe work state (can drive RN events) |

### Low-level storage helpers (pure logic, no UI)
| Component | Path | Role |
|-----------|------|------|
| `FileDeletionHelper` | `core/utils/helpers/FileDeletionHelper.kt` | Delete via `File.deleteRecursively()` + MediaStore fallback (Android 10+) |
| `DirectoryScanner` | `core/utils/helpers/DirectoryScanner.kt` | Recursive directory scan, skip protected/hidden |
| `TrashHelper` | `core/utils/helpers/TrashHelper.kt` | Trash naming, original path resolution |
| `FileGroupingHelper`, `FileSizeFormatter` | `core/utils/helpers/` | Grouping and formatting (no UI) |

### Domain layer (to refactor into “engine” API)
| Component | Path | Role |
|-----------|------|------|
| `CleanRepository` | `clean/domain/repository/CleanRepository.kt` | Interface: getFiles, getTrash, getLargestFiles, delete, moveToTrash, restore, WhatsApp summary, etc. |
| `CleanRepositoryImpl` | `clean/data/repository/CleanRepositoryImpl.kt` | Delegates to `ScannerRepository` + `WhatsAppCleanerRepository` |
| `DeleteFilesUseCase` | `clean/domain/usecases/delete/DeleteFilesUseCase.kt` | Delete vs move-to-trash |
| `CleaningManager` | `app/clean/scanner/domain/operations/CleaningManager.kt` | Coordinates delete + trash size update |
| `ScannerRepository` | `app/clean/scanner/domain/repository/` | Implementations do real filesystem/MediaStore access |

### Feature-specific logic (scanning/detection)
- **Scanner / dashboard:** `AnalyzeFilesUseCase`, `GetLargestFilesUseCase`, storage analysis
- **Trash:** `GetTrashFilesUseCase`, `RestoreFromTrashUseCase`, `UpdateTrashSizeUseCase`
- **WhatsApp:** `GetWhatsAppMediaSummaryUseCase`, `DetectWhatsAppMediaFilesUseCase`, WhatsApp repositories
- **Duplicates:** `DetectDuplicateFilesUseCase`, `CheckDuplicateFilesUseCase`
- **Empty folders, clipboard:** See `docs/cleaner/` in reference

### Documentation in reference (for behavior and safety)
- `docs/cleaner/cleaning_features.md` – feature list and Work ID keys
- `docs/cleaner/cleanup_jobs.md` – job lifecycle, chunking, progress, process death
- `docs/cleaner/cleaner_lifecycle.md` – pipeline: FileCleaner → Enqueuer → FileCleanupWorker → CleaningManager → DeleteFilesUseCase
- `docs/cleaner/cleaning_feature_checklist.md` – job lifecycle checklist
- `docs/cleaner/trash_recovery.md`, `empty_folder_cleaner.md`, etc.

---

## Android 10+ Constraints (Scoped Storage)

- **Scoped Storage** enforced; avoid broad filesystem access where not allowed.
- **FileDeletionHelper** already uses MediaStore fallback when `File.deleteRecursively()` fails (e.g. for MediaStore-managed files).
- **Permissions:** Runtime storage/notification permissions; no UI in Kotlin, but permission checks remain in native layer or via RN bridge.
- **Safe paths:** Skip protected Android dirs (`isProtectedAndroidDir`); never freeze UI thread; heavy work in WorkManager/coroutines.

---

## Definition of Success

- Compiles and runs without blocking UI.
- Works on Android 10+ with Scoped Storage and safe deletion.
- **Clean modular structure:** storage engine in Kotlin; UI in React Native.
- **Strict separation:** no storage/deletion logic in JS; no UI in Kotlin.
- **Minimal bridge surface:** small, well-defined Native Module API.
- **Non-blocking:** heavy operations on background threads (WorkManager/coroutines).
- **Safety:** dry-run option, dangerous-path checks, production-ready.

---

## Extraction Strategy (High Level)

1. **Identify** all storage/cleanup entry points and their dependencies in `reference/Smart-Cleaner-for-Android`.
2. **Refactor** into a single “engine” or small set of Kotlin modules with clear interfaces (e.g. scan, get trash, delete, move to trash, restore).
3. **Remove** UI dependencies (ViewModel, Snackbar, Compose, Activity) from these modules; replace with callbacks/events that the bridge can forward to RN.
4. **Implement** a React Native Native Module that invokes the engine and sends progress/result events to JS.
5. **Expose** a minimal JS API (e.g. startScan, getTrash, deletePaths, moveToTrash, restoreFromTrash) that the RN UI uses.
6. **Retain** WorkManager (or equivalent) for background cleanup and progress reporting; ensure notifications and progress are handled in native or via events to RN.

This file is the single place to “remember” this context; when working on the RN app or the native module, refer to `reference/Smart-Cleaner-for-Android` and this doc.
