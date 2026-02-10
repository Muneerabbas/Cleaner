import RNFS from 'react-native-fs';

type ProgressCb = (progress: number, deleted: number, total: number) => void;

async function dirSize(path: string): Promise<number> {
  try {
    const items = await RNFS.readDir(path);
    let total = 0;
    for (const item of items) {
      if (item.isFile()) {
        total += item.size;
      } else if (item.isDirectory()) {
        total += await dirSize(item.path);
      }
    }
    return total;
  } catch {
    return 0;
  }
}

async function deleteDirContents(
  path: string,
  onProgress: ProgressCb,
  state: { deleted: number; total: number },
): Promise<void> {
  let items = [];
  try {
    items = await RNFS.readDir(path);
  } catch {
    return;
  }

  for (const item of items) {
    try {
      if (item.isFile()) {
        await RNFS.unlink(item.path);
        state.deleted += item.size;
        onProgress(
          state.total === 0 ? 1 : state.deleted / state.total,
          state.deleted,
          state.total,
        );
      } else if (item.isDirectory()) {
        await deleteDirContents(item.path, onProgress, state);
        await RNFS.unlink(item.path).catch(() => {});
      }
    } catch {
      // best-effort delete
    }
  }
}

export async function clearAppJunk(onProgress: ProgressCb) {
  const dirs = [
    RNFS.CachesDirectoryPath,
    RNFS.ExternalCachesDirectoryPath,
    RNFS.TemporaryDirectoryPath,
    `${RNFS.DocumentDirectoryPath}/tmp`,
  ].filter(Boolean) as string[];

  let total = 0;
  for (const dir of dirs) {
    total += await dirSize(dir);
  }

  const state = { deleted: 0, total };
  onProgress(0, 0, total);

  for (const dir of dirs) {
    await deleteDirContents(dir, onProgress, state);
  }

  onProgress(1, state.deleted, total);
  return { deletedBytes: state.deleted, totalBytes: total };
}
