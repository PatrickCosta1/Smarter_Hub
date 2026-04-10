import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { initialProfileData } from './data';
import { apiRequest, apiRequestCached, authHeaders, clearApiCache } from './api';
import { AuthUser, PortalNotification, ProfileData, UserRole } from './types';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

const profileKeys: Array<keyof ProfileData> = [
  'primeiroNome',
  'apelido',
  'nomeAbreviado',
  'dataNascimento',
  'genero',
  'estadoCivil',
  'habilitacoesLiterarias',
  'curso',
  'faculdade',
  'emailPessoal',
  'telemovel',
  'moradaFiscal',
  'endereco',
  'localidade',
  'codigoPostal',
  'matriculaCarro',
  'cartaoCidadao',
  'nif',
  'niss',
  'iban',
  'situacaoIrs',
  'numeroDependentes',
  'irsJovem',
  'anoPrimeiroDesconto',
  'numeroCartaoContinente',
  'voucherNosData',
  'comprovativoMoradaFiscal',
  'comprovativoCartaoCidadao',
  'comprovativoIban',
  'comprovativoCartaoContinente',
  'contactoEmergenciaNome',
  'contactoEmergenciaParentesco',
  'contactoEmergenciaNumero',
  'cargo',
  'funcao',
  'dataInicioContrato',
  'dataFimContrato',
  'remuneracao',
  'tipoContrato',
  'regimeHorario',
  'workCountry',
];

function normalizeProfileData(input: unknown): ProfileData {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const normalized = { ...initialProfileData } as ProfileData;

  profileKeys.forEach((key) => {
    const value = source[key];
    if (key === 'workCountry') {
      normalized.workCountry = value === 'BR' ? 'BR' : 'PT';
      return;
    }

    normalized[key] = typeof value === 'string' ? value : '';
  });

  return normalized;
}

type PortalContextValue = {
  isAuthenticated: boolean;
  isLoadingSession: boolean;
  isLoadingPortalData: boolean;
  currentUser: AuthUser | null;
  userRole: UserRole;
  isRootAccess: boolean;
  isAccessTotal: boolean;
  permissions: string[];
  hasPermission: (code: string) => boolean;
  unreadNotifications: number;
  profile: ProfileData;
  notifications: PortalNotification[];
  login: (username: string, password: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => void;
  markAllNotificationsRead: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  deleteAllNotifications: () => Promise<void>;
  setProfile: (profile: ProfileData) => void;
  saveProfile: (profile: ProfileData) => Promise<{ success: boolean; message?: string }>;
};

const PortalContext = createContext<PortalContextValue | null>(null);

type UserPermissionsResponse = {
  user?: {
    isRootAccess?: boolean;
  };
  accessTotal?: boolean;
  permissions?: Array<{
    code: string;
    assignment?: {
      isEnabled?: boolean;
    } | null;
  }>;
};

function mapBackendRole(role: AuthUser['role']): UserRole {
  if (role === 'ADMIN') {
    return 'admin';
  }

  if (role === 'MANAGER') {
    return 'manager';
  }

  if (role === 'COORDENADOR') {
    return 'coordenador';
  }

  if (role === 'CONVIDADO') {
    return 'convidado';
  }

  return 'colaborador';
}

export function PortalProvider({ children }: { children: ReactNode }) {
  const [authToken, setAuthToken] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [isLoadingPortalData, setIsLoadingPortalData] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [userRole, setUserRole] = useState<UserRole>('colaborador');
  const [isRootAccess, setIsRootAccess] = useState(false);
  const [isAccessTotal, setIsAccessTotal] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);
  const [profile, setProfileState] = useState<ProfileData>(initialProfileData);

  const unreadNotifications = useMemo(() => notifications.filter((item) => !item.isRead).length, [notifications]);

  const loadPortalData = useCallback(async (token: string) => {
    setIsLoadingPortalData(true);

    try {
      const [profileData, notificationsData] = await Promise.all([
        apiRequestCached<ProfileData>('/profile/me', {
          headers: authHeaders(token),
        }, 30000),
        apiRequestCached<PortalNotification[]>('/notifications/me', {
          headers: authHeaders(token),
        }, 10000),
      ]);

      setProfileState(normalizeProfileData(profileData));
      setNotifications(notificationsData);
    } finally {
      setIsLoadingPortalData(false);
    }
  }, []);

  const loadAccessData = useCallback(async (token: string, user: AuthUser) => {
    const fallbackRootAccess = Boolean(user.isRootAccess);

    try {
      const response = await apiRequest<UserPermissionsResponse>(`/users/${user.id}/permissions`, {
        headers: authHeaders(token),
      });

      const permissionCodes = (response.permissions ?? [])
        .filter((item) => item.assignment?.isEnabled)
        .map((item) => item.code);

      setPermissions(permissionCodes);
      setIsRootAccess(Boolean(response.user?.isRootAccess ?? fallbackRootAccess));
      setIsAccessTotal(Boolean(response.accessTotal));
    } catch {
      setPermissions([]);
      setIsRootAccess(fallbackRootAccess);
      setIsAccessTotal(false);
    }
  }, []);

  useEffect(() => {
    const existingToken = window.localStorage.getItem(STORAGE_TOKEN_KEY);

    if (!existingToken) {
      setIsLoadingSession(false);
      return;
    }

    setAuthToken(existingToken);

    (async () => {
      try {
        const response = await apiRequest<{ user: AuthUser }>('/auth/me', {
          headers: authHeaders(existingToken),
        });

        setCurrentUser(response.user);
        setUserRole(mapBackendRole(response.user.role));
        await loadAccessData(existingToken, response.user);
        await loadPortalData(existingToken);
        setIsAuthenticated(true);
      } catch {
        window.localStorage.removeItem(STORAGE_TOKEN_KEY);
        setAuthToken('');
      } finally {
        setIsLoadingSession(false);
      }
    })();
  }, [loadAccessData, loadPortalData]);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const response = await apiRequest<{ token: string; user: AuthUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });

      const token = response.token;
      window.localStorage.setItem(STORAGE_TOKEN_KEY, token);
      setAuthToken(token);
      setCurrentUser(response.user);
      setUserRole(mapBackendRole(response.user.role));
      await loadAccessData(token, response.user);
      await loadPortalData(token);
      setIsAuthenticated(true);

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro de autenticacao.';
      return { success: false, message };
    }
  }, [loadAccessData, loadPortalData]);

  const logout = useCallback(() => {
    window.localStorage.removeItem(STORAGE_TOKEN_KEY);
    clearApiCache();
    setAuthToken('');
    setIsAuthenticated(false);
    setCurrentUser(null);
    setIsRootAccess(false);
    setIsAccessTotal(false);
    setPermissions([]);
    setNotifications([]);
    setProfileState(initialProfileData);
  }, []);

  const hasPermission = useCallback((code: string) => {
    if (isRootAccess || isAccessTotal) {
      return true;
    }

    return permissions.includes(code);
  }, [isRootAccess, isAccessTotal, permissions]);

  const setProfile = useCallback((profileData: ProfileData) => {
    setProfileState(normalizeProfileData(profileData));
  }, []);

  const saveProfile = useCallback(async (profileData: ProfileData) => {
    if (!authToken) {
      return { success: false, message: 'Sessão inválida. Faça login novamente.' };
    }

    const normalizedProfile = normalizeProfileData(profileData);

    try {
      const response = await apiRequest<{ pending?: boolean; message?: string } | ProfileData>('/profile/me', {
        method: 'PUT',
        headers: authHeaders(authToken),
        body: JSON.stringify(normalizedProfile),
      });

      if (response && typeof response === 'object' && 'pending' in response && response.pending) {
        clearApiCache('/profile/requests/me');
        clearApiCache('/profile/requests');
        clearApiCache('/notifications/me');
        return { success: true, message: response.message || 'Pedido enviado para aprovação.' };
      }

      setProfileState(normalizedProfile);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao guardar alterações.';
      return { success: false, message };
    }
  }, [authToken]);

  const markAllNotificationsRead = useCallback(async () => {
    if (!authToken) {
      return;
    }

    await apiRequest<{ updated: number }>('/notifications/read-all', {
      method: 'PATCH',
      headers: authHeaders(authToken),
    });

    setNotifications((current) => current.map((item) => ({ ...item, isRead: true })));
  }, [authToken]);

  const markNotificationRead = useCallback(async (id: string) => {
    if (!authToken) {
      return;
    }

    await apiRequest<{ updated: number }>(`/notifications/${id}/read`, {
      method: 'PATCH',
      headers: authHeaders(authToken),
    });

    setNotifications((current) => current.map((item) => (item.id === id ? { ...item, isRead: true } : item)));
  }, [authToken]);

  const deleteNotification = useCallback(async (id: string) => {
    if (!authToken) {
      return;
    }

    await apiRequest<{ deleted: number }>(`/notifications/${id}`, {
      method: 'DELETE',
      headers: authHeaders(authToken),
    });

    setNotifications((current) => current.filter((item) => item.id !== id));
  }, [authToken]);

  const deleteAllNotifications = useCallback(async () => {
    if (!authToken) {
      return;
    }

    await apiRequest<{ deleted: number }>('/notifications', {
      method: 'DELETE',
      headers: authHeaders(authToken),
    });

    setNotifications([]);
  }, [authToken]);

  const value = useMemo(
    () => ({
      isAuthenticated,
      isLoadingSession,
      isLoadingPortalData,
      currentUser,
      userRole,
      isRootAccess,
      isAccessTotal,
      permissions,
      hasPermission,
      unreadNotifications,
      profile,
      notifications,
      login,
      logout,
      markAllNotificationsRead,
      markNotificationRead,
      deleteNotification,
      deleteAllNotifications,
      setProfile,
      saveProfile,
    }),
    [currentUser, deleteAllNotifications, deleteNotification, hasPermission, isAccessTotal, isAuthenticated, isLoadingPortalData, isLoadingSession, isRootAccess, login, logout, markAllNotificationsRead, markNotificationRead, notifications, permissions, profile, saveProfile, setProfile, unreadNotifications, userRole],
  );

  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export function usePortal() {
  const context = useContext(PortalContext);

  if (!context) {
    throw new Error('usePortal deve ser usado dentro de PortalProvider.');
  }

  return context;
}
