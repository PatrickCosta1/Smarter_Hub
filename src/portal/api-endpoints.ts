import { authHeaders, apiRequest } from './api';
import { getStoredAuthToken } from './auth-storage';

function getAuthHeaders() {
  return authHeaders(getStoredAuthToken());
}

export const admissionEndpoints = {
  settings: '/users/admissions/settings',
  list: '/users/admissions/list',
  detail: (id: string) => `/users/admissions/${id}`,
  approvePersonal: (id: string) => `/users/admissions/${id}/approve-personal`,
  requestCorrection: (id: string) => `/users/admissions/${id}/request-correction`,
  complete: (id: string) => `/users/admissions/${id}/complete`,
  create: '/users/admissions',
} as const;

export async function loadAdmissionFormSettings<T = unknown>(): Promise<T> {
  return apiRequest<T>(admissionEndpoints.settings, { headers: getAuthHeaders() });
}

export async function saveAdmissionFormSettings<T = unknown>(country: 'PT' | 'BR', requiredFields: string[]): Promise<T> {
  return apiRequest<T>(admissionEndpoints.settings, {
    method: 'PUT',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ country, requiredFields }),
  });
}

export async function loadAdmissionList<T = unknown>(status?: string): Promise<T> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiRequest<T>(`${admissionEndpoints.list}${query}`, { headers: getAuthHeaders() });
}

export async function loadAdmissionDetail<T = unknown>(id: string): Promise<T> {
  return apiRequest<T>(admissionEndpoints.detail(id), { headers: getAuthHeaders() });
}

export async function approveAdmissionPersonal(id: string): Promise<void> {
  await apiRequest<void>(admissionEndpoints.approvePersonal(id), { method: 'POST', headers: getAuthHeaders() });
}

export async function requestAdmissionCorrection(id: string, reason: string): Promise<void> {
  await apiRequest<void>(admissionEndpoints.requestCorrection(id), {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
}

export async function completeAdmission<T = unknown>(id: string, contractData: unknown): Promise<T> {
  return apiRequest<T>(admissionEndpoints.complete(id), {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(contractData),
  });
}

export async function createAdmissionRequest<T = unknown>(payload: {
  fullName: string;
  personalEmail: string;
  workCountry: 'PT' | 'BR';
  brWorkState?: string;
}): Promise<T> {
  return apiRequest<T>(admissionEndpoints.create, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
