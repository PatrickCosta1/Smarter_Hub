const defaultApiBase = import.meta.env.DEV
  ? 'http://localhost:4000/api'
  : 'https://smarter-hub-api.onrender.com/api';

const rawApiBase = import.meta.env.VITE_API_URL ?? defaultApiBase;
const apiBase = rawApiBase.replace(/\/$/, '');

type ApiCacheEntry = {
  expiresAt: number;
  value: unknown;
};

const apiGetCache = new Map<string, ApiCacheEntry>();
const apiGetInFlight = new Map<string, Promise<unknown>>();

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
  const requestHeaders: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options?.headers ?? {}),
  };

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

    throw new Error((payload.message as string) || 'Falha na comunicacao com a API.');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function apiRequestCached<T>(
  path: string,
  options?: RequestInit,
  ttlMs = 20000,
  forceRefresh = false,
): Promise<T> {
  const method = (options?.method || 'GET').toUpperCase();

  if (method !== 'GET') {
    return apiRequest<T>(path, options);
  }

  const key = buildCacheKey(path, options);
  const now = Date.now();

  if (!forceRefresh) {
    const cached = apiGetCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.value as T;
    }

    const inFlight = apiGetInFlight.get(key);
    if (inFlight) {
      return (await inFlight) as T;
    }
  }

  const requestPromise = (async () => {
    const fresh = await apiRequest<T>(path, options);
    apiGetCache.set(key, {
      expiresAt: Date.now() + ttlMs,
      value: fresh,
    });
    return fresh;
  })();

  apiGetInFlight.set(key, requestPromise as Promise<unknown>);

  try {
    return await requestPromise;
  } finally {
    apiGetInFlight.delete(key);
  }
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
