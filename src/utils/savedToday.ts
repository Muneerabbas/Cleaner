import RNFS from 'react-native-fs';

const FILE = `${RNFS.DocumentDirectoryPath}/saved_today.json`;
const HISTORY_FILE = `${RNFS.DocumentDirectoryPath}/daily_history.json`;
const HISTORY_DAYS = 7;

export type DailyEntry = {
  date: string;
  freedBytes: number;
  storageUsed: number;
};

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function readHistory(): Promise<DailyEntry[]> {
  try {
    const raw = await RNFS.readFile(HISTORY_FILE, 'utf8');
    const arr = JSON.parse(raw) as DailyEntry[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeHistory(entries: DailyEntry[]): Promise<void> {
  const trimmed = entries.slice(-HISTORY_DAYS);
  await RNFS.writeFile(HISTORY_FILE, JSON.stringify(trimmed), 'utf8');
}

export async function recordDailySnapshot(
  freedBytes: number,
  storageUsed: number,
): Promise<void> {
  const date = todayKey();
  const history = await readHistory();
  const existing = history.findIndex((e) => e.date === date);
  if (existing >= 0) {
    history[existing].freedBytes = Math.max(history[existing].freedBytes, freedBytes);
    history[existing].storageUsed = storageUsed;
  } else {
    history.push({ date, freedBytes, storageUsed });
  }
  await writeHistory(history);
}

export async function getDailyHistory(): Promise<DailyEntry[]> {
  const history = await readHistory();
  const today = new Date();
  const result: DailyEntry[] = [];
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const entry = history.find((e) => e.date === key);
    result.push(entry ?? { date: key, freedBytes: 0, storageUsed: 0 });
  }
  return result;
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
