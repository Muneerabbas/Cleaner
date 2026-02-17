import { NativeModules, Platform } from 'react-native';

const { CleanerModule } = NativeModules;

if (Platform.OS === 'android' && !CleanerModule) {
  console.warn(
    'CleanerModule native module is not available. Did you rebuild the Android app?'
  );
}

export type FileEntry = {
  path: string;
  size: number;
  modified: number;
};

export type CleanupResult =
  | { status: 'success'; deletedCount: number; failedPaths: string[] }
  | { status: 'rejected'; reason: string; rejectedPaths: string[] }
  | { status: 'error'; message: string };

function toFileEntry(raw: {
  path: string;
  size: number;
  modified: number;
}): FileEntry {
  return {
    path: String(raw.path),
    size: Number(raw.size) || 0,
    modified: Number(raw.modified) || 0,
  };
}

function toFileEntryList(
  raw: ReadonlyArray<{ path: string; size: number; modified: number }>
): FileEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(toFileEntry);
}

async function invoke<T>(fn: () => Promise<T>): Promise<T> {
  if (Platform.OS !== 'android' || !CleanerModule) {
    throw new Error('Storage cleaner is only available on Android.');
  }
  try {
    return await fn();
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const code =
      e && typeof e === 'object' && 'code' in e
        ? String((e as { code: string }).code)
        : 'UNKNOWN';
    throw new Error(`[${code}] ${message}`);
  }
}

export const storageCleaner = {
  /** Check if the app has storage permission (MANAGE_EXTERNAL_STORAGE on 11+, READ on older). */
  async hasStoragePermission(): Promise<boolean> {
    return invoke(async () => {
      return await CleanerModule.hasStoragePermission();
    });
  },

  /** Open the system settings page to grant all-files access (Android 11+) or app settings. */
  async openManageStorageSettings(): Promise<void> {
    return invoke(async () => {
      await CleanerModule.openManageStorageSettings();
    });
  },

  async scanAllFiles(): Promise<FileEntry[]> {
    return invoke(async () => {
      const raw = await CleanerModule.scanAllFiles();
      return toFileEntryList(raw ?? []);
    });
  },

  async scanLargeFiles(
    minSizeBytes: number = 100 * 1024 * 1024,
    limit: number | null = null
  ): Promise<FileEntry[]> {
    return invoke(async () => {
      // Pass limit as number; 0 or negative means "no limit" on native side
      const raw = await CleanerModule.scanLargeFiles(
        minSizeBytes,
        limit ?? 0
      );
      return toFileEntryList(raw ?? []);
    });
  },

  async detectDuplicates(): Promise<FileEntry[][]> {
    return invoke(async () => {
      const raw = await CleanerModule.detectDuplicates();
      if (!Array.isArray(raw)) return [];
      return raw.map(
        (
          group: ReadonlyArray<{
            path: string;
            size: number;
            modified: number;
          }>
        ) => toFileEntryList(group ?? [])
      );
    });
  },

  async scanJunk(): Promise<FileEntry[]> {
    return invoke(async () => {
      const raw = await CleanerModule.scanJunk();
      return toFileEntryList(raw ?? []);
    });
  },

  async scanEmptyFolders(): Promise<string[]> {
    return invoke(async () => {
      const raw = await CleanerModule.scanEmptyFolders();
      return Array.isArray(raw) ? raw.map(String) : [];
    });
  },

  async getTrashFiles(): Promise<FileEntry[]> {
    return invoke(async () => {
      const raw = await CleanerModule.getTrashFiles();
      return toFileEntryList(raw ?? []);
    });
  },

  async cleanup(
    paths: string[],
    options: { dryRun?: boolean; moveToTrash?: boolean } = {}
  ): Promise<CleanupResult> {
    const { dryRun = false, moveToTrash = false } = options;
    return invoke(async () => {
      const result = await CleanerModule.cleanup(
        paths,
        !!dryRun,
        !!moveToTrash
      );
      if (!result || typeof result !== 'object') {
        return {
          status: 'error' as const,
          message: 'Invalid response from native module.',
        };
      }
      switch (result.status) {
        case 'success':
          return {
            status: 'success' as const,
            deletedCount: Number(result.deletedCount) ?? 0,
            failedPaths: Array.isArray(result.failedPaths)
              ? result.failedPaths.map(String)
              : [],
          };
        case 'rejected':
          return {
            status: 'rejected' as const,
            reason: String(result.reason ?? ''),
            rejectedPaths: Array.isArray(result.rejectedPaths)
              ? result.rejectedPaths.map(String)
              : [],
          };
        case 'error':
          return {
            status: 'error' as const,
            message: String(result.message ?? 'Unknown error'),
          };
        default:
          return { status: 'error' as const, message: 'Unknown result status.' };
      }
    });
  },

  async restoreFromTrash(paths: string[]): Promise<string[]> {
    return invoke(async () => {
      const raw = await CleanerModule.restoreFromTrash(paths);
      return Array.isArray(raw) ? raw.map(String) : [];
    });
  },
};
