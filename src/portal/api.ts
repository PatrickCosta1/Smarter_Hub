const defaultApiBase = import.meta.env.DEV
  ? 'http://localhost:4000/api'
  : 'https://smarter-hub-api.onrender.com/api';

const rawApiBase = import.meta.env.VITE_API_URL ?? defaultApiBase;
const apiBase = rawApiBase.replace(/\/$/, '');

export function getApiBase() {
  return apiBase;
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

export function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  };
}
