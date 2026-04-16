import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { initialProfileData } from './data';
import { apiRequest, apiRequestCached, authHeaders, clearApiCache } from './api';
import { AuthUser, PortalNotification, ProfileData, UserRole } from './types';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

const profileKeys: Array<keyof ProfileData> = [
  'nomeCompleto',
  'nomeAbreviado',
  'dataNascimento',
  'genero',
  'estadoCivil',
  'habilitacoesLiterarias',
  'curso',
  'faculdade',
  'nacionalidade',
  'emailPessoal',
  'telemovel',
  'githubUser',
  'moradaFiscal',
  'endereco',
  'localidade',
  'codigoPostal',
  'matriculaCarro',
  'cartaoCidadao',
  'validadeCartaoCidadao',
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
  'categoriaProfissional',
  'funcao',
  'dataInicioContrato',
  'dataFimContrato',
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
  loginWithPassword: (username: string, password: string) => Promise<{ success: boolean; message?: string }>;
  loginWithMicrosoft: (idToken: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => void;
  markAllNotificationsRead: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  deleteAllNotifications: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  setProfile: (profile: ProfileData) => void;
  saveProfile: (profile: ProfileData) => Promise<{ success: boolean; message?: string; pending?: boolean }>;
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
  const notificationsRefreshInFlight = useRef<{ sequence: number; promise: Promise<void> } | null>(null);
  const notificationsRefreshSequence = useRef(0);
  const notificationsSnapshotRef = useRef<PortalNotification[]>([]);
  const notificationsMutationSequence = useRef(0);

  const unreadNotifications = useMemo(() => notifications.filter((item) => !item.isRead).length, [notifications]);

  useEffect(() => {
    notificationsSnapshotRef.current = notifications;
  }, [notifications]);

  const loadPortalData = useCallback(async (token: string) => {
    setIsLoadingPortalData(true);

    try {
      const headers = authHeaders(token);

      const profilePromise = apiRequestCached<ProfileData>('/profile/me', {
        headers,
      }, 30000)
        .then((profileData) => {
          setProfileState(normalizeProfileData(profileData));
        })
        .catch(() => undefined);

      const notificationsPromise = apiRequestCached<PortalNotification[]>('/notifications/me', {
        headers,
      }, 10000)
        .then((notificationsData) => {
          setNotifications(notificationsData);
        })
        .catch(() => undefined);

      await Promise.allSettled([profilePromise, notificationsPromise]);
    } finally {
      setIsLoadingPortalData(false);
    }
  }, []);

  const refreshNotifications = useCallback(async (token = authToken, forceRefresh = false) => {
    if (!token) {
      return;
    }

    if (!forceRefresh && notificationsRefreshInFlight.current) {
      return notificationsRefreshInFlight.current.promise;
    }

    const sequence = notificationsRefreshSequence.current + 1;
    notificationsRefreshSequence.current = sequence;

    const request = (async () => {
      try {
        const data = await apiRequest<PortalNotification[]>('/notifications/me', {
          headers: authHeaders(token),
        });

        if (window.localStorage.getItem(STORAGE_TOKEN_KEY) === token && notificationsRefreshSequence.current === sequence) {
          setNotifications(data);
        }
      } catch {
        // Refresh silencioso: falhas temporárias não devem bloquear a UI.
      } finally {
        if (notificationsRefreshInFlight.current?.sequence === sequence) {
          notificationsRefreshInFlight.current = null;
        }
      }
    })();

    notificationsRefreshInFlight.current = { sequence, promise: request };
    return request;
  }, [authToken]);

  const loadAccessData = useCallback(async (token: string, user: AuthUser) => {
    const fallbackRootAccess = Boolean(user.isRootAccess);
    const fallbackAccessTotal = Boolean(user.hasAccessTotal);

    try {
      const response = await apiRequest<UserPermissionsResponse>(`/users/${user.id}/permissions`, {
        headers: authHeaders(token),
      });

      const permissionCodes = (response.permissions ?? [])
        .filter((item) => item.assignment?.isEnabled)
        .map((item) => item.code);

      setPermissions(permissionCodes);
      setIsRootAccess(Boolean(response.user?.isRootAccess ?? fallbackRootAccess));
      setIsAccessTotal(Boolean(response.accessTotal ?? fallbackAccessTotal));
    } catch {
      setPermissions([]);
      setIsRootAccess(fallbackRootAccess);
      setIsAccessTotal(fallbackAccessTotal);
    }
  }, []);

  const completeLoginSession = useCallback(async (token: string, user: AuthUser) => {
    window.localStorage.setItem(STORAGE_TOKEN_KEY, token);
    setAuthToken(token);
    setCurrentUser(user);
    setUserRole(mapBackendRole(user.role));
    await Promise.all([
      loadAccessData(token, user),
      loadPortalData(token),
    ]);
    setIsAuthenticated(true);
  }, [loadAccessData, loadPortalData]);

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
        await Promise.all([
          loadAccessData(existingToken, response.user),
          loadPortalData(existingToken),
        ]);
        setIsAuthenticated(true);
      } catch {
        window.localStorage.removeItem(STORAGE_TOKEN_KEY);
        setAuthToken('');
      } finally {
        setIsLoadingSession(false);
      }
    })();
  }, [loadAccessData, loadPortalData]);

  useEffect(() => {
    if (!isAuthenticated || !authToken) {
      return;
    }

    let disposed = false;

    const syncNotifications = () => {
      if (disposed) {
        return;
      }

      void refreshNotifications(authToken);
    };

    const visibilityHandler = () => {
      if (!document.hidden) {
        syncNotifications();
      }
    };

    syncNotifications();

    const intervalId = window.setInterval(() => {
      if (!document.hidden) {
        syncNotifications();
      }
    }, 8000);

    window.addEventListener('focus', syncNotifications);
    document.addEventListener('visibilitychange', visibilityHandler);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', syncNotifications);
      document.removeEventListener('visibilitychange', visibilityHandler);
    };
  }, [authToken, isAuthenticated, refreshNotifications]);

  const loginWithMicrosoft = useCallback(async (idToken: string) => {
    try {
      const response = await apiRequest<{ token: string; user: AuthUser }>('/auth/microsoft', {
        method: 'POST',
        body: JSON.stringify({ idToken }),
      });

      await completeLoginSession(response.token, response.user);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha na autenticacao Microsoft.';
      return { success: false, message };
    }
  }, [completeLoginSession]);

  const loginWithPassword = useCallback(async (username: string, password: string) => {
    try {
      const response = await apiRequest<{ token: string; user: AuthUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });

      await completeLoginSession(response.token, response.user);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha na autenticação por credenciais.';
      return { success: false, message };
    }
  }, [completeLoginSession]);

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
    if (isRootAccess || isAccessTotal || currentUser?.hasAccessTotal) {
      return true;
    }

    return permissions.includes(code);
  }, [isRootAccess, isAccessTotal, permissions, currentUser?.hasAccessTotal]);

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
        void refreshNotifications(authToken);
        return { success: true, pending: true, message: response.message || 'Pedido enviado para aprovação.' };
      }

      setProfileState(normalizedProfile);
      void refreshNotifications(authToken);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao guardar alterações.';
      return { success: false, message };
    }
  }, [authToken, refreshNotifications]);

  const runOptimisticNotificationMutation = useCallback(async (
    updater: (current: PortalNotification[]) => PortalNotification[],
    mutationRequest: () => Promise<void>,
  ) => {
    if (!authToken) {
      return;
    }

    const previous = notificationsSnapshotRef.current;
    const mutationSequence = notificationsMutationSequence.current + 1;
    notificationsMutationSequence.current = mutationSequence;

    setNotifications(updater(previous));

    try {
      await mutationRequest();
    } catch (error) {
      if (notificationsMutationSequence.current === mutationSequence) {
        setNotifications(previous);
      }
      throw error;
    } finally {
      void refreshNotifications(authToken, true);
    }
  }, [authToken, refreshNotifications]);

  const markAllNotificationsRead = useCallback(async () => {
    await runOptimisticNotificationMutation(
      (current) => current.map((item) => ({ ...item, isRead: true })),
      async () => {
        await apiRequest<{ updated: number }>('/notifications/read-all', {
          method: 'PATCH',
          headers: authHeaders(authToken),
        });
      },
    );
  }, [authToken, runOptimisticNotificationMutation]);

  const markNotificationRead = useCallback(async (id: string) => {
    await runOptimisticNotificationMutation(
      (current) => current.map((item) => (item.id === id ? { ...item, isRead: true } : item)),
      async () => {
        await apiRequest<{ updated: number }>(`/notifications/${id}/read`, {
          method: 'PATCH',
          headers: authHeaders(authToken),
        });
      },
    );
  }, [authToken, runOptimisticNotificationMutation]);

  const deleteNotification = useCallback(async (id: string) => {
    await runOptimisticNotificationMutation(
      (current) => current.filter((item) => item.id !== id),
      async () => {
        await apiRequest<{ deleted: number }>(`/notifications/${id}`, {
          method: 'DELETE',
          headers: authHeaders(authToken),
        });
      },
    );
  }, [authToken, runOptimisticNotificationMutation]);

  const deleteAllNotifications = useCallback(async () => {
    await runOptimisticNotificationMutation(
      () => [],
      async () => {
        await apiRequest<{ deleted: number }>('/notifications', {
          method: 'DELETE',
          headers: authHeaders(authToken),
        });
      },
    );
  }, [authToken, runOptimisticNotificationMutation]);

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
      loginWithPassword,
      loginWithMicrosoft,
      logout,
      markAllNotificationsRead,
      markNotificationRead,
      deleteNotification,
      deleteAllNotifications,
      refreshNotifications,
      setProfile,
      saveProfile,
    }),
    [currentUser, deleteAllNotifications, deleteNotification, hasPermission, isAccessTotal, isAuthenticated, isLoadingPortalData, isLoadingSession, isRootAccess, loginWithMicrosoft, loginWithPassword, logout, markAllNotificationsRead, markNotificationRead, notifications, permissions, profile, refreshNotifications, saveProfile, setProfile, unreadNotifications, userRole],
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
