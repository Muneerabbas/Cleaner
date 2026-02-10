import RNFS from 'react-native-fs';

const FILE = `${RNFS.DocumentDirectoryPath}/saved_today.json`;

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function getSavedTodayBytes(): Promise<number> {
  try {
    const raw = await RNFS.readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw) as {
      date: string;
      bytes: number;
      baselineUsed?: number;
    };
    if (parsed.date === todayKey()) {
      return parsed.bytes || 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

export async function addSavedTodayBytes(delta: number): Promise<number> {
  const date = todayKey();
  let current = 0;
  let baselineUsed: number | undefined;
  try {
    const raw = await RNFS.readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw) as {
      date: string;
      bytes: number;
      baselineUsed?: number;
    };
    if (parsed.date === date) {
      current = parsed.bytes || 0;
      baselineUsed = parsed.baselineUsed;
    }
  } catch {
    // ignore
  }
  const next = current + Math.max(0, delta);
  await RNFS.writeFile(
    FILE,
    JSON.stringify({ date, bytes: next, baselineUsed }),
    'utf8',
  );
  return next;
}

export async function updateSavedTodayFromStorage(
  currentUsed: number,
): Promise<number> {
  const date = todayKey();
  let bytes = 0;
  let baselineUsed = currentUsed;

  try {
    const raw = await RNFS.readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw) as {
      date: string;
      bytes: number;
      baselineUsed?: number;
    };
    if (parsed.date === date) {
      bytes = parsed.bytes || 0;
      baselineUsed =
        typeof parsed.baselineUsed === 'number'
          ? parsed.baselineUsed
          : currentUsed;
    }
  } catch {
    // ignore
  }

  const freed = Math.max(0, baselineUsed - currentUsed);
  if (freed > bytes) {
    bytes = freed;
  }

  await RNFS.writeFile(
    FILE,
    JSON.stringify({ date, bytes, baselineUsed }),
    'utf8',
  );
  return bytes;
}
