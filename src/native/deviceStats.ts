import { NativeModules } from 'react-native';

const { DeviceStats } = NativeModules;

export type StorageStats = {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
};

export type UnusedApp = {
  packageName: string;
  appName: string;
  lastTimeUsed: number;
};

export type AppStorage = {
  packageName: string;
  appName: string;
  appBytes: number;
  dataBytes: number;
  cacheBytes: number;
  iconBase64?: string;
};

export const getStorageStats = (): Promise<StorageStats> => {
  return DeviceStats.getStorageStats();
};

export const hasUsageAccess = (): Promise<boolean> => {
  return DeviceStats.hasUsageAccess();
};

export const openUsageAccessSettings = (): void => {
  DeviceStats.openUsageAccessSettings();
};

export const openAppInfo = (packageName: string): void => {
  DeviceStats.openAppInfo(packageName);
};

export const openAppUninstall = (packageName: string): void => {
  DeviceStats.openAppUninstall(packageName);
};

export const getUnusedApps = (days: number): Promise<UnusedApp[]> => {
  return DeviceStats.getUnusedApps(days);
};

export const getAppsStorage = (): Promise<AppStorage[]> => {
  return DeviceStats.getAppsStorage();
};
