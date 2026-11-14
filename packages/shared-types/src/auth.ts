import type { UserRole } from './enums';

export interface Tenant {
  tenantId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  /** Identity-provider subject (Cognito `sub`). */
  userId: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
  lastLoginAt: string | null;
}

/** Authenticated caller resolved on every API request. Tenant is resolved server-side, never from client input. */
export interface AuthContext {
  userId: string;
  tenantId: string;
  role: UserRole;
  email: string;
}

export interface SessionTokens {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface LoginResponse extends SessionTokens {
  user: UserProfile;
  tenant: Tenant;
}

export interface MeResponse {
  user: UserProfile;
  tenant: Tenant;
}
