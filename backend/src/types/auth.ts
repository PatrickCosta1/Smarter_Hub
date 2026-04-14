import { Role } from "@prisma/client";

export type AuthUser = {
  id: string;
  username: string;
  email: string;
  role: Role;
  isActive: boolean;
  isRootAccess: boolean;
  hasAccessTotal?: boolean;
  team?: {
    id: string;
    name: string;
  } | null;
};

export type JwtPayload = {
  sub: string;
  username: string;
  role: Role;
  isRootAccess: boolean;
  hasAccessTotal?: boolean;
};
