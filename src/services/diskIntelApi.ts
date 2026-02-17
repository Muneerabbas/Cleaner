import { Platform } from 'react-native';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export type ApiEnvelope<T> = {
  status: 'ok' | 'error';
  timestamp: string;
  data?: T;
  meta?: Record<string, unknown>;
  warnings?: string[];
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

// Use your laptop LAN IP on physical phone, e.g. http://192.168.1.42:8001
const LAN_BASE_URL = 'http://127.0.0.1:8001';

function getDefaultBaseUrl(): string {
  if (Platform.OS === 'android') {
    // Android emulator localhost bridge
    return 'http://10.0.2.2:8001';
  }
  return LAN_BASE_URL;
}

let baseUrl = getDefaultBaseUrl();

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${baseUrl}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Network request failed for ${url}. ${message}`);
  }

  const json = (await res.json()) as ApiEnvelope<T>;

  if (!res.ok || json.status !== 'ok' || !json.data) {
    const message = json.error?.message || `HTTP ${res.status}`;
    throw new Error(`${message} (${url})`);
  }

  return json.data;
}

export const diskIntelApi = {
  getBaseUrl(): string {
    return baseUrl;
  },

  setBaseUrl(url: string): void {
    baseUrl = normalizeBaseUrl(url);
  },

  health(): Promise<{ service: string; healthy: boolean }> {
    return request('/healthz');
  },

  startScan(payload: {
    roots: string[];
    follow_symlinks?: boolean;
    include_hidden?: boolean;
  }): Promise<{ job_id: string; status: JobStatus }> {
    return request('/api/v1/analysis/scans/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  latestSnapshot(): Promise<{ has_snapshot: boolean; snapshot?: Record<string, unknown> }> {
    return request('/api/v1/analysis/scans/latest');
  },

  getJob(jobId: string): Promise<{
    job_id: string;
    status: JobStatus;
    progress: Record<string, unknown>;
    result?: Record<string, unknown>;
    error?: Record<string, unknown>;
  }> {
    return request(`/api/v1/jobs/${encodeURIComponent(jobId)}`);
  },

  getJobResult(jobId: string): Promise<Record<string, unknown>> {
    return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/result`);
  },

  runAnalysis(payload: {
    snapshot_id?: number;
    top_n?: number;
    include_duplicates?: boolean;
  }): Promise<{ job_id: string }> {
    return request('/api/v1/analysis/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  runDuplicates(payload: { snapshot_id?: number }): Promise<{ job_id: string }> {
    return request('/api/v1/analysis/duplicates/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  filterLargeOld(payload: {
    snapshot_id?: number;
    min_size?: string;
    older_than_days?: number;
    limit?: number;
  }): Promise<Record<string, unknown>> {
    return request('/api/v1/analysis/filters/large-old', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  largestFiles(snapshotId: number, topN = 50): Promise<Record<string, unknown>> {
    return request(`/api/v1/analysis/snapshots/${snapshotId}/largest-files?top_n=${topN}`);
  },

  folderAggregation(snapshotId: number, topN = 50): Promise<Record<string, unknown>> {
    return request(`/api/v1/analysis/snapshots/${snapshotId}/folders?top_n=${topN}`);
  },

  typeDistribution(snapshotId: number): Promise<Record<string, unknown>> {
    return request(`/api/v1/analysis/snapshots/${snapshotId}/types`);
  },

  extensionFrequency(snapshotId: number, topN = 100): Promise<Record<string, unknown>> {
    return request(`/api/v1/analysis/snapshots/${snapshotId}/extensions?top_n=${topN}`);
  },

  pareto(snapshotId: number): Promise<Record<string, unknown>> {
    return request(`/api/v1/analysis/snapshots/${snapshotId}/pareto`);
  },

  histogram(snapshotId: number): Promise<Record<string, unknown>> {
    return request(`/api/v1/analysis/snapshots/${snapshotId}/histogram`);
  },

  runCleanup(payload: {
    snapshot_id?: number;
    mode?: 'duplicates' | 'large-old' | 'logs-temp' | 'paths';
    roots: string[];
    min_size?: string;
    older_than_days?: number;
    limit?: number;
    paths?: string[];
    execute?: boolean;
    force_high_risk?: boolean;
    quarantine_mode?: boolean;
    confirm?: boolean;
  }): Promise<{ job_id: string }> {
    return request('/api/v1/cleanup/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  undoCleanup(actionId: string): Promise<{ job_id: string }> {
    return request('/api/v1/cleanup/undo', {
      method: 'POST',
      body: JSON.stringify({ action_id: actionId }),
    });
  },

};
