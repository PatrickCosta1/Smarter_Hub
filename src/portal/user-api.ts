import { apiRequest, apiRequestCached, authHeaders } from './api';
import { getStoredAuthToken } from './auth-storage';

function getAuthHeaders() {
  const token = getStoredAuthToken();
  if (!token) {
    throw new Error('Autenticação não encontrada. Faz login novamente.');
  }
  return authHeaders(token);
}

function jsonRequest<T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method,
    headers: getAuthHeaders(),
    body: body == null ? undefined : JSON.stringify(body),
  });
}

const userEndpoints = {
  active: (id: string) => `/users/${id}/active`,
  permissions: (id: string) => `/users/${id}/permissions`,
  permission: (userId: string, permissionId: string) => `/users/${userId}/permissions/${permissionId}`,
  accessTotal: (id: string) => `/users/${id}/access-total`,
  credentials: (id: string) => `/admin/users/${id}/credentials`,
  user: (id: string) => `/admin/users/${id}`,
} as const;

const profileEndpoints = {
  options: '/profile/options',
  history: '/profile/requests/history',
} as const;

const teamEndpoints = {
  adminTeams: '/admin/teams',
  teams: '/teams',
} as const;

export async function toggleUserActive(userId: string, isActive: boolean): Promise<void> {
  await jsonRequest<void>(userEndpoints.active(userId), 'PATCH', { isActive });
}

export async function loadUserPermissions<T = unknown>(userId: string): Promise<T> {
  return apiRequest<T>(userEndpoints.permissions(userId), { headers: getAuthHeaders() });
}

export type UserUpdatePayload = Record<string, unknown>;

export async function updateUser<T = unknown>(userId: string, payload: UserUpdatePayload): Promise<T> {
  return jsonRequest<T>(userEndpoints.user(userId), 'PATCH', payload);
}

export async function revokeUserPermission(userId: string, permissionId: string): Promise<void> {
  await jsonRequest<void>(userEndpoints.permission(userId, permissionId), 'DELETE');
}

export async function createUserPermission(userId: string, payload: unknown): Promise<void> {
  await jsonRequest<void>(userEndpoints.permissions(userId), 'POST', payload);
}

export async function updateUserPermission(userId: string, permissionId: string, payload: unknown): Promise<void> {
  await jsonRequest<void>(userEndpoints.permission(userId, permissionId), 'PATCH', payload);
}

export async function setUserAccessTotal(userId: string, isEnabled: boolean, reason?: string): Promise<{ success: boolean; accessTotal: boolean }> {
  return jsonRequest<{ success: boolean; accessTotal: boolean }>(userEndpoints.accessTotal(userId), 'PATCH', {
    isEnabled,
    reason: reason?.trim() || undefined,
  });
}

export async function loadProfileOptions<T = unknown>(signal?: AbortSignal): Promise<T> {
  return apiRequestCached<T>(profileEndpoints.options, { headers: getAuthHeaders(), signal }, 8000, true);
}

export type ProfileOptionPayload = { type: 'CARGO' | 'FUNCAO'; label: string; groupLabel?: string };

export async function createProfileOption<T = unknown>(payload: ProfileOptionPayload): Promise<T> {
  return jsonRequest<T>(profileEndpoints.options, 'POST', payload);
}

export async function loadProfileHistory<T = unknown>(limit = 500, signal?: AbortSignal): Promise<T> {
  return apiRequestCached<T>(`${profileEndpoints.history}?limit=${limit}`, { headers: getAuthHeaders(), signal }, 8000, true);
}

export async function loadAdminTeams<T = unknown>(signal?: AbortSignal): Promise<T> {
  return apiRequestCached<T>(teamEndpoints.adminTeams, { headers: getAuthHeaders(), signal }, 8000, true);
}

export async function loadTeams<T = unknown>(signal?: AbortSignal): Promise<T> {
  return apiRequestCached<T>(teamEndpoints.teams, { headers: getAuthHeaders(), signal }, 8000, true);
}

export async function updateUserCredentials<T = unknown>(userId: string, payload: unknown): Promise<T> {
  return jsonRequest<T>(userEndpoints.credentials(userId), 'PATCH', payload);
}
