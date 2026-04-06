import { Role } from "@prisma/client";

export type AuthUser = {
  id: string;
  username: string;
  email: string;
  role: Role;
};

export type JwtPayload = {
  sub: string;
  username: string;
  role: Role;
};
