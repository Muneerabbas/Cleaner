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
  lastTimeUsed?: number;
  isSystem?: boolean;
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

export type BatteryInfo = {
  level: number;
  isCharging: boolean;
  health: string;
  temperature: number;
  plugType: string;
};

export type MemoryInfo = {
  totalRam: number;
  availableRam: number;
  usedRam: number;
  lowMemory: boolean;
};

export type DataUsage = {
  mobileReceived: number;
  mobileSent: number;
  mobileTotal: number;
  wifiReceived: number;
  wifiSent: number;
  wifiTotal: number;
  totalReceived: number;
  totalSent: number;
  totalData: number;
};

export const getBatteryInfo = (): Promise<BatteryInfo> => {
  if (!DeviceStats?.getBatteryInfo) {
    return Promise.reject(new Error('getBatteryInfo not available on native module'));
  }
  return DeviceStats.getBatteryInfo();
};

export const getMemoryInfo = (): Promise<MemoryInfo> => {
  if (!DeviceStats?.getMemoryInfo) {
    return Promise.reject(new Error('getMemoryInfo not available on native module'));
  }
  return DeviceStats.getMemoryInfo();
};

export const getDataUsage = (): Promise<DataUsage> => {
  if (!DeviceStats?.getDataUsage) {
    return Promise.reject(new Error('getDataUsage not available on native module'));
  }
  return DeviceStats.getDataUsage();
};
