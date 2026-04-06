import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { initialProfileData } from './data';
import { apiRequest, authHeaders } from './api';
import { AuthUser, PortalNotification, ProfileData, UserRole } from './types';

const STORAGE_TOKEN_KEY = 'smarter_hub_auth_token';

type PortalContextValue = {
  isAuthenticated: boolean;
  isLoadingSession: boolean;
  userRole: UserRole;
  unreadNotifications: number;
  profile: ProfileData;
  notifications: PortalNotification[];
  login: (username: string, password: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => void;
  markAllNotificationsRead: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  setProfile: (profile: ProfileData) => void;
};

const PortalContext = createContext<PortalContextValue | null>(null);

function mapBackendRole(role: AuthUser['role']): UserRole {
  if (role === 'ADMIN') {
    return 'admin';
  }

  if (role === 'RH') {
    return 'rh';
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
  const [userRole, setUserRole] = useState<UserRole>('colaborador');
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);
  const [profile, setProfileState] = useState<ProfileData>(initialProfileData);
  const profilePersistTimerRef = useRef<number | undefined>(undefined);

  const unreadNotifications = useMemo(() => notifications.filter((item) => !item.isRead).length, [notifications]);

  const loadPortalData = useCallback(async (token: string) => {
    const [profileData, notificationsData] = await Promise.all([
      apiRequest<ProfileData>('/profile/me', {
        headers: authHeaders(token),
      }),
      apiRequest<PortalNotification[]>('/notifications/me', {
        headers: authHeaders(token),
      }),
    ]);

    setProfileState(profileData);
    setNotifications(notificationsData);
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

        setUserRole(mapBackendRole(response.user.role));
        await loadPortalData(existingToken);
        setIsAuthenticated(true);
      } catch {
        window.localStorage.removeItem(STORAGE_TOKEN_KEY);
        setAuthToken('');
      } finally {
        setIsLoadingSession(false);
      }
    })();
  }, [loadPortalData]);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const response = await apiRequest<{ token: string; user: AuthUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });

      const token = response.token;
      window.localStorage.setItem(STORAGE_TOKEN_KEY, token);
      setAuthToken(token);
      setUserRole(mapBackendRole(response.user.role));
      await loadPortalData(token);
      setIsAuthenticated(true);

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro de autenticacao.';
      return { success: false, message };
    }
  }, [loadPortalData]);

  const logout = useCallback(() => {
    window.localStorage.removeItem(STORAGE_TOKEN_KEY);
    setAuthToken('');
    setIsAuthenticated(false);
    setNotifications([]);
    setProfileState(initialProfileData);
  }, []);

  const setProfile = useCallback((profileData: ProfileData) => {
    setProfileState(profileData);

    if (!authToken) {
      return;
    }

    if (profilePersistTimerRef.current) {
      window.clearTimeout(profilePersistTimerRef.current);
    }

    profilePersistTimerRef.current = window.setTimeout(async () => {
      try {
        await apiRequest<ProfileData>('/profile/me', {
          method: 'PUT',
          headers: authHeaders(authToken),
          body: JSON.stringify(profileData),
        });
      } catch {
        // A UI continua responsiva; o utilizador pode voltar a guardar ao editar novamente.
      }
    }, 400);
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

  const value = useMemo(
    () => ({
      isAuthenticated,
      isLoadingSession,
      userRole,
      unreadNotifications,
      profile,
      notifications,
      login,
      logout,
      markAllNotificationsRead,
      markNotificationRead,
      setProfile,
    }),
    [isAuthenticated, isLoadingSession, login, logout, markAllNotificationsRead, markNotificationRead, notifications, profile, setProfile, unreadNotifications, userRole],
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
