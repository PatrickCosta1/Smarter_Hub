import { ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';
import { detectRoleByUsername, initialProfileData } from './data';
import { ProfileData, UserRole } from './types';

type PortalContextValue = {
  isAuthenticated: boolean;
  userRole: UserRole;
  unreadNotifications: number;
  profile: ProfileData;
  login: (username: string) => void;
  logout: () => void;
  markAllNotificationsRead: () => void;
  setProfile: (profile: ProfileData) => void;
};

const PortalContext = createContext<PortalContextValue | null>(null);

export function PortalProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState<UserRole>('colaborador');
  const [unreadNotifications, setUnreadNotifications] = useState(3);
  const [profile, setProfileState] = useState<ProfileData>(initialProfileData);

  const login = useCallback((username: string) => {
    setUserRole(detectRoleByUsername(username));
    setUnreadNotifications(3);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    setIsAuthenticated(false);
  }, []);

  const setProfile = useCallback((profileData: ProfileData) => {
    setProfileState(profileData);
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setUnreadNotifications(0);
  }, []);

  const value = useMemo(
    () => ({
      isAuthenticated,
      userRole,
      unreadNotifications,
      profile,
      login,
      logout,
      markAllNotificationsRead,
      setProfile,
    }),
    [isAuthenticated, login, logout, markAllNotificationsRead, profile, setProfile, unreadNotifications, userRole],
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
