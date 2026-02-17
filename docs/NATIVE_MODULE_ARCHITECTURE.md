# Native Cleaner Module — Architecture, Threading, Storage, Safety

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  React Native UI (JS/TS)                                         │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  services/storageCleaner.ts (typed async API, error handling)   │
│  • No direct NativeModules exposure to UI                       │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  CleanerModule.kt (ReactContextBaseJavaModule)                  │
│  • @ReactMethod + Promise                                       │
│  • All heavy work: withContext(Dispatchers.IO)                   │
│  • No direct file I/O; only calls StorageCleanerService          │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  StorageCleanerService.kt                                       │
│  • Application context only (ContentResolver, storage roots)   │
│  • All operations: withContext(Dispatchers.IO)                   │
└───────────────────────────────┬─────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌───────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│ core/          │    │ AndroidFileDeleter│    │ PathValidator       │
│ FileScanner    │    │ (ContentResolver, │    │ (allowed roots,     │
│ DuplicateDetector│  │  TrashHelper)     │    │  dangerous paths)   │
│ JunkAnalyzer   │    └──────────────────┘    └─────────────────────┘
│ CleanupExecutor│
│ DirectoryScanner│
│ TrashHelper    │
└───────────────┘
```

**Rules enforced:**
- **core/** has zero React imports, zero Android View classes, zero UI references.
- **CleanerModule** never performs file I/O; it only invokes `StorageCleanerService`.
- **storageCleaner.ts** does not expose `NativeModules` to the rest of the app; UI uses only the typed service.

---

## Threading Verification

- **Main thread:** Only used to receive React calls and to resolve/reject the Promise after work completes. No file scan, no hashing, no delete on the main thread.
- **Heavy work:** Every scan, duplicate detection, junk scan, cleanup, and restore runs inside `withContext(Dispatchers.IO)` (in the service) or in the module’s `withContext(Dispatchers.IO)` block.
- **Coroutine scope:** `CleanerModule` uses a `CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)` only to launch the coroutine that then switches to IO for work; the module’s `invalidate()` cancels this scope.
- **Blocking calls:** `DirectoryScanner.scan` and `File.partialHash()` are called only from coroutines that are already on `Dispatchers.IO`, so they do not block the main thread.

**Conclusion:** No heavy operation runs on the main thread; UI freeze from this module is avoided.

---

## Android Storage Compliance (Android 10+)

- **Scoped Storage:** The app uses:
  - `Context.getExternalFilesDir(null)` — always allowed (app-specific).
  - `Environment.getExternalStorageDirectory()` — deprecated on API 29+; used only when available and not as sole root.
- **Deletion:** `AndroidFileDeleter` uses `File.deleteRecursively()` first; on failure it falls back to `ContentResolver.delete(MediaStore.Files.getContentUri(...))` for MediaStore-managed files (Android 10+ compatible).
- **Permissions:** Manifest declares:
  - `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE` with `maxSdkVersion` for legacy.
  - `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `READ_MEDIA_AUDIO` for Android 13+.
- **MANAGE_EXTERNAL_STORAGE:** Not used. Broad access would require user grant and store justification; current design relies on app-specific storage and (when granted) legacy external storage. If full-device scan is required, the app must either request MANAGE_EXTERNAL_STORAGE (with documented risk and store policy) or use SAF (Storage Access Framework) and pass selected roots into the service.

---

## Safety Guarantees

- **Dry-run:** `cleanup(paths, { dryRun: true })` validates paths and returns without calling the deleter.
- **Explicit deletion:** Deletion only happens when `dryRun` is false and paths pass validation.
- **Path validation:** `PathValidator`:
  - Rejects paths under `Android/data` and `Android/obb`.
  - Rejects dangerous root segments (e.g. system, vendor, data, root, proc, dev).
  - Optionally restricts to `allowedRoots` (used by `CleanupExecutor`).
- **Directory restriction:** `PathValidator.filterAllowedPaths` removes any path outside allowed roots or inside protected/dangerous areas.
- **Logging:** Rejected paths can be reported via `PathValidator.filterAllowedPaths(onRejected = ...)`; production code can wire this to Android Log or analytics.
- **No silent delete:** Every delete goes through `CleanupExecutor.execute`, which validates first; the JS API requires an explicit `cleanup(paths, { dryRun: false })` to perform deletion.

---

## API Surface (JS)

- **Minimal:** The JS layer exposes only:
  - `scanAllFiles`, `scanLargeFiles`, `detectDuplicates`, `scanJunk`, `scanEmptyFolders`, `getTrashFiles`, `cleanup`, `restoreFromTrash`.
- **Typed:** All methods return typed structures (`FileEntry[]`, `CleanupResult`, etc.) and wrap native errors.
- **UI-agnostic:** The service does not reference any React component or navigation.

---

## Performance (10k file scan, large dirs, duplicates)

- **Scan:** Directory traversal is streamed (flow/iterator); memory is proportional to tree depth and batch size, not total file count. For 10k files collected into a list, memory is O(10k) for the list of `FileEntry`.
- **Duplicates:** Grouping by size is O(n); hashing is O(n) with chunked parallelism. Partial hash (first + last 1MB) keeps per-file I/O bounded. Hash cache avoids re-reading unchanged files.
- **Large files:** Single pass over scanned list with size filter and sort; O(n log n) for sort.
- **Optimization potential:** For very large trees, keep using `scanAllFiles()` as a Flow and process in chunks instead of materializing a full list; duplicate detection can then run in batches.

---

## Permission Handling Example (Runtime)

The native module does not request permissions. The React Native app should request storage permissions before calling scan/cleanup, e.g.:

```ts
import { PermissionsAndroid, Platform } from 'react-native';

async function requestStoragePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Number(Platform.Version) >= 33) {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
      PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
      PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO,
    ]);
    return Object.values(result).every((r) => r === PermissionsAndroid.RESULTS.GRANTED);
  }
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

// Before scanning:
// const ok = await requestStoragePermission();
// if (ok) { const files = await storageCleaner.scanAllFiles(); }
```
