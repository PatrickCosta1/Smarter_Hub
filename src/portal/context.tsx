import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { initialProfileData } from './data';
import { apiRequest, authHeaders } from './api';
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
];

function normalizeProfileData(input: unknown): ProfileData {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const normalized = { ...initialProfileData } as ProfileData;

  profileKeys.forEach((key) => {
    const value = source[key];
    normalized[key] = typeof value === 'string' ? value : '';
  });

  return normalized;
}

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
  saveProfile: (profile: ProfileData) => Promise<{ success: boolean; message?: string }>;
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

    setProfileState(normalizeProfileData(profileData));
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
    setProfileState(normalizeProfileData(profileData));
  }, []);

  const saveProfile = useCallback(async (profileData: ProfileData) => {
    if (!authToken) {
      return { success: false, message: 'Sessão inválida. Faça login novamente.' };
    }

    const normalizedProfile = normalizeProfileData(profileData);

    try {
      await apiRequest<ProfileData>('/profile/me', {
        method: 'PUT',
        headers: authHeaders(authToken),
        body: JSON.stringify(normalizedProfile),
      });

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
      saveProfile,
    }),
    [isAuthenticated, isLoadingSession, login, logout, markAllNotificationsRead, markNotificationRead, notifications, profile, saveProfile, setProfile, unreadNotifications, userRole],
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
