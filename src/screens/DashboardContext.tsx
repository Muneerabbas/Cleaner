import React, { createContext, useContext, useEffect, useState } from 'react';
import { requestStoragePermission } from '../utils/permissions';
import {
  getAppsStorage,
  getStorageStats,
  getUnusedApps,
  hasUsageAccess,
  openAppInfo,
  openAppUninstall,
  openUsageAccessSettings,
  StorageStats,
} from '../native/deviceStats';
import { clearAppJunk } from '../utils/cache';
import { addSavedTodayBytes, updateSavedTodayFromStorage } from '../utils/savedToday';

type AppStorage = {
  appName: string;
  packageName: string;
  appBytes: number;
  dataBytes: number;
  cacheBytes: number;
  iconBase64?: string;
};

type DashboardState = {
  storage: StorageStats | null;
  usageAccess: boolean;
  unusedCount: number | null;
  unusedApps: { appName: string; packageName: string; lastTimeUsed: number }[];
  savedTodayBytes: number;
  clearing: boolean;
  clearProgress: number;
  appsStorage: AppStorage[];
  appsLoading: boolean;
  refreshing: boolean;
  refreshAll: () => Promise<void>;
  refreshAppsStorage: () => Promise<void>;
  clearJunk: () => Promise<void>;
  addSavedBytes: (bytes: number) => Promise<void>;
  recheckUsageAccess: () => Promise<void>;
  openUsageAccessSettings: () => void;
  openAppInfo: (pkg: string) => void;
  openAppUninstall: (pkg: string) => void;
};

const DashboardContext = createContext<DashboardState | null>(null);

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) {
    throw new Error('DashboardContext missing');
  }
  return ctx;
}

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const [usageAccess, setUsageAccess] = useState(false);
  const [unusedCount, setUnusedCount] = useState<number | null>(null);
  const [unusedApps, setUnusedApps] = useState<
    { appName: string; packageName: string; lastTimeUsed: number }[]
  >([]);
  const [savedTodayBytes, setSavedTodayBytes] = useState(0);
  const [clearing, setClearing] = useState(false);
  const [clearProgress, setClearProgress] = useState(0);
  const [appsStorage, setAppsStorage] = useState<AppStorage[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await requestStoragePermission();
      const stats = await getStorageStats();
      const hasAccess = await hasUsageAccess();
      const saved = await updateSavedTodayFromStorage(stats.usedBytes);

      setStorage(stats);
      setUsageAccess(hasAccess);
      setSavedTodayBytes(saved);

      if (hasAccess) {
        const apps = await getUnusedApps(30);
        setUnusedCount(apps.length);
        setUnusedApps(apps.slice(0, 5));
      } else {
        setUnusedCount(null);
        setUnusedApps([]);
      }
    } finally {
      setRefreshing(false);
    }
  };

  const refreshAppsStorage = async () => {
    if (!usageAccess) return;
    setAppsLoading(true);
    try {
      const list = await getAppsStorage();
      const sorted = [...list].sort(
        (a, b) =>
          b.appBytes + b.dataBytes + b.cacheBytes -
          (a.appBytes + a.dataBytes + a.cacheBytes),
      );
      setAppsStorage(sorted);
    } finally {
      setAppsLoading(false);
    }
  };

  const clearJunk = async () => {
    if (clearing) return;
    setClearing(true);
    setClearProgress(0);
    try {
      const result = await clearAppJunk((p) => {
        setClearProgress(p);
      });
      const next = await addSavedTodayBytes(result.deletedBytes);
      setSavedTodayBytes(next);
      const stats = await getStorageStats();
      setStorage(stats);
      const recomputed = await updateSavedTodayFromStorage(stats.usedBytes);
      setSavedTodayBytes(recomputed);
    } finally {
      setClearing(false);
    }
  };

  const addSavedBytes = async (bytes: number) => {
    const next = await addSavedTodayBytes(bytes);
    setSavedTodayBytes(next);
  };

  const recheckUsageAccess = async () => {
    try {
      const hasAccess = await hasUsageAccess();
      setUsageAccess(hasAccess);
      if (hasAccess) {
        const apps = await getUnusedApps(30);
        setUnusedCount(apps.length);
        setUnusedApps(apps.slice(0, 5));
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refreshAll().catch(() => {});
  }, []);

  const value: DashboardState = {
    storage,
    usageAccess,
    unusedCount,
    unusedApps,
    savedTodayBytes,
    clearing,
    clearProgress,
    appsStorage,
    appsLoading,
    refreshing,
    refreshAll,
    refreshAppsStorage,
    clearJunk,
    addSavedBytes,
    recheckUsageAccess,
    openUsageAccessSettings,
    openAppInfo,
    openAppUninstall,
  };

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
}
