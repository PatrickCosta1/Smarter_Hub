const defaultApiBase = import.meta.env.DEV
  ? 'http://localhost:4000/api'
  : 'https://smarter-hub-api.onrender.com/api';

const rawApiBase = import.meta.env.VITE_API_URL ?? defaultApiBase;
const apiBase = rawApiBase.replace(/\/$/, '');

type ApiCacheEntry = {
  expiresAt: number;
  staleExpiresAt: number;
  lastAccessAt: number;
  value: unknown;
};

type ApiPerfEntry = {
  endpoint: string;
  calls: number;
  networkCalls: number;
  errorCalls: number;
  cacheFreshHits: number;
  cacheStaleHits: number;
  inFlightHits: number;
  totalNetworkMs: number;
  maxNetworkMs: number;
  lastNetworkMs: number;
  lastUpdatedAt: number;
};

type ApiPerfSnapshot = {
  endpoint: string;
  calls: number;
  networkCalls: number;
  errorCalls: number;
  cacheFreshHits: number;
  cacheStaleHits: number;
  inFlightHits: number;
  avgNetworkMs: number;
  maxNetworkMs: number;
  lastNetworkMs: number;
  lastUpdatedAt: number;
};

const apiGetCache = new Map<string, ApiCacheEntry>();
const apiGetInFlight = new Map<string, Promise<unknown>>();
const MAX_GET_CACHE_ENTRIES = 500;
const apiPerfByEndpoint = new Map<string, ApiPerfEntry>();
const apiPerfLastBudgetWarningAt = new Map<string, number>();
const API_BUDGET_LOGS_ENABLED = import.meta.env.VITE_API_BUDGET_LOGS !== 'false';
const NETWORK_BUDGET_WARNING_MS = Number(import.meta.env.VITE_API_BUDGET_WARNING_MS ?? 1800);
const NETWORK_BUDGET_CRITICAL_MS = Number(import.meta.env.VITE_API_BUDGET_CRITICAL_MS ?? 4000);
const BUDGET_WARNING_COOLDOWN_MS = Number(import.meta.env.VITE_API_BUDGET_COOLDOWN_MS ?? 180000);

function normalizeEndpointForPerf(path: string) {
  const [withoutQuery] = path.split('?');
  return withoutQuery
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/g, ':id')
    .replace(/\/(\d+)(?=\/|$)/g, '/:id');
}

function getOrCreatePerfEntry(endpoint: string) {
  const existing = apiPerfByEndpoint.get(endpoint);
  if (existing) {
    return existing;
  }

  const created: ApiPerfEntry = {
    endpoint,
    calls: 0,
    networkCalls: 0,
    errorCalls: 0,
    cacheFreshHits: 0,
    cacheStaleHits: 0,
    inFlightHits: 0,
    totalNetworkMs: 0,
    maxNetworkMs: 0,
    lastNetworkMs: 0,
    lastUpdatedAt: Date.now(),
  };

  apiPerfByEndpoint.set(endpoint, created);
  return created;
}

function maybeWarnNetworkBudget(endpoint: string, durationMs: number) {
  if (!import.meta.env.DEV || !API_BUDGET_LOGS_ENABLED || durationMs < NETWORK_BUDGET_WARNING_MS) {
    return;
  }

  const now = Date.now();
  const lastWarningAt = apiPerfLastBudgetWarningAt.get(endpoint) || 0;
  if (now - lastWarningAt < BUDGET_WARNING_COOLDOWN_MS) {
    return;
  }

  apiPerfLastBudgetWarningAt.set(endpoint, now);
  const level = durationMs >= NETWORK_BUDGET_CRITICAL_MS ? 'critico' : 'warning';
  console.warn(`[API budget ${level}] ${endpoint} demorou ${Math.round(durationMs)}ms`);
}

function recordNetworkPerf(path: string, durationMs: number, wasError: boolean) {
  const endpoint = normalizeEndpointForPerf(path);
  const entry = getOrCreatePerfEntry(endpoint);
  entry.calls += 1;
  entry.networkCalls += 1;
  if (wasError) {
    entry.errorCalls += 1;
  }
  entry.totalNetworkMs += durationMs;
  entry.lastNetworkMs = durationMs;
  entry.maxNetworkMs = Math.max(entry.maxNetworkMs, durationMs);
  entry.lastUpdatedAt = Date.now();

  maybeWarnNetworkBudget(endpoint, durationMs);
}

function recordCachePerf(path: string, source: 'fresh' | 'stale' | 'inflight') {
  const endpoint = normalizeEndpointForPerf(path);
  const entry = getOrCreatePerfEntry(endpoint);
  entry.calls += 1;
  if (source === 'fresh') {
    entry.cacheFreshHits += 1;
  } else if (source === 'stale') {
    entry.cacheStaleHits += 1;
  } else {
    entry.inFlightHits += 1;
  }
  entry.lastUpdatedAt = Date.now();
}

function touchCacheEntry(entry: ApiCacheEntry) {
  entry.lastAccessAt = Date.now();
}

function pruneGetCache() {
  if (apiGetCache.size <= MAX_GET_CACHE_ENTRIES) {
    return;
  }

  const orderedKeys = Array.from(apiGetCache.entries())
    .sort((a, b) => a[1].lastAccessAt - b[1].lastAccessAt)
    .map(([key]) => key);

  const toDelete = apiGetCache.size - MAX_GET_CACHE_ENTRIES;
  for (let index = 0; index < toDelete; index += 1) {
    apiGetCache.delete(orderedKeys[index]);
  }
}

function createAbortError() {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) {
    return promise;
  }

  if (signal.aborted) {
    return Promise.reject<T>(createAbortError());
  }

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      cleanup();
      reject(createAbortError());
    };

    const cleanup = () => {
      signal.removeEventListener('abort', handleAbort);
    };

    signal.addEventListener('abort', handleAbort, { once: true });

    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function buildCacheKey(path: string, options?: RequestInit) {
  const method = (options?.method || 'GET').toUpperCase();
  const headers = (options?.headers ?? {}) as Record<string, string>;
  const auth = headers.Authorization || headers.authorization || '';
  return `${method}|${path}|${auth}`;
}

export function getApiBase() {
  return apiBase;
}

export function getBackendBase() {
  return apiBase.replace(/\/api$/i, '');
}

export async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const start = performance.now();
  let networkError = false;
  const requestHeaders: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options?.headers ?? {}),
  };

  try {
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: requestHeaders,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({} as Record<string, unknown>));

      if (Array.isArray(payload.issues) && payload.issues.length > 0) {
        const issueText = payload.issues
          .map((issue: unknown) => {
            const entry = issue as { path?: unknown[]; message?: string };
            const field = Array.isArray(entry.path) && entry.path.length > 0 ? String(entry.path[0]) : 'campo desconhecido';
            return `${field}: ${entry.message ?? 'valor inválido'}`;
          })
          .join(' | ');

        throw new Error(`Payload inválido. ${issueText}`);
      }

      throw new Error((payload.message as string) || (payload.error as string) || 'Falha na comunicacao com a API.');
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  } catch (error) {
    networkError = true;
    throw error;
  } finally {
    recordNetworkPerf(path, performance.now() - start, networkError);
  }
}

export async function apiRequestCached<T>(
  path: string,
  options?: RequestInit,
  ttlMs = 20000,
  forceRefresh = false,
  staleTtlMs = ttlMs * 4,
): Promise<T> {
  const method = (options?.method || 'GET').toUpperCase();

  if (method !== 'GET') {
    return apiRequest<T>(path, options);
  }

  const key = buildCacheKey(path, options);
  const now = Date.now();

  if (!forceRefresh) {
    const cached = apiGetCache.get(key);
    if (cached) {
      touchCacheEntry(cached);
      if (cached.expiresAt > now) {
        recordCachePerf(path, 'fresh');
        return cached.value as T;
      }

      if (cached.staleExpiresAt > now) {
        if (!apiGetInFlight.has(key)) {
          const requestOptions: RequestInit | undefined = options
            ? { ...options, signal: undefined }
            : undefined;

          const backgroundRequest = (async () => {
            const fresh = await apiRequest<T>(path, requestOptions);
            apiGetCache.set(key, {
              expiresAt: Date.now() + ttlMs,
              staleExpiresAt: Date.now() + ttlMs + Math.max(staleTtlMs, ttlMs),
              lastAccessAt: Date.now(),
              value: fresh,
            });
            pruneGetCache();
            return fresh;
          })();

          apiGetInFlight.set(key, backgroundRequest as Promise<unknown>);
          void backgroundRequest.finally(() => {
            apiGetInFlight.delete(key);
          });
        }

        recordCachePerf(path, 'stale');
        return cached.value as T;
      }

      apiGetCache.delete(key);
    }

    const inFlight = apiGetInFlight.get(key);
    if (inFlight) {
      recordCachePerf(path, 'inflight');
      return (await raceWithAbort(inFlight as Promise<T>, options?.signal ?? undefined)) as T;
    }
  }

  const requestOptions: RequestInit | undefined = options
    ? { ...options, signal: undefined }
    : undefined;

  const requestPromise = (async () => {
    const fresh = await apiRequest<T>(path, requestOptions);
    apiGetCache.set(key, {
      expiresAt: Date.now() + ttlMs,
      staleExpiresAt: Date.now() + ttlMs + Math.max(staleTtlMs, ttlMs),
      lastAccessAt: Date.now(),
      value: fresh,
    });
    pruneGetCache();
    return fresh;
  })();

  apiGetInFlight.set(key, requestPromise as Promise<unknown>);

  try {
    return await requestPromise;
  } finally {
    apiGetInFlight.delete(key);
  }
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

export function clearApiCache(prefix?: string) {
  if (!prefix) {
    apiGetCache.clear();
    return;
  }

  for (const key of apiGetCache.keys()) {
    if (key.includes(`|${prefix}`)) {
      apiGetCache.delete(key);
    }
  }
}

export function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

export function getApiPerformanceSummary() {
  return Array.from(apiPerfByEndpoint.values())
    .map<ApiPerfSnapshot>((entry) => ({
      endpoint: entry.endpoint,
      calls: entry.calls,
      networkCalls: entry.networkCalls,
      errorCalls: entry.errorCalls,
      cacheFreshHits: entry.cacheFreshHits,
      cacheStaleHits: entry.cacheStaleHits,
      inFlightHits: entry.inFlightHits,
      avgNetworkMs: entry.networkCalls > 0 ? entry.totalNetworkMs / entry.networkCalls : 0,
      maxNetworkMs: entry.maxNetworkMs,
      lastNetworkMs: entry.lastNetworkMs,
      lastUpdatedAt: entry.lastUpdatedAt,
    }))
    .sort((a, b) => b.avgNetworkMs - a.avgNetworkMs);
}

export function clearApiPerformanceSummary() {
  apiPerfByEndpoint.clear();
  apiPerfLastBudgetWarningAt.clear();
}
