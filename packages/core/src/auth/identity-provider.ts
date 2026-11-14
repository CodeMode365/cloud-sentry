export interface IdpTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  userSub: string;
}

export interface VerifiedAccessToken {
  userSub: string;
  expiresAt: number;
}

/** Port over the identity provider (Cognito in deployed environments). */
export interface IdentityProvider {
  signUp(input: {
    email: string;
    password: string;
    name: string;
  }): Promise<{ userSub: string; confirmed: boolean }>;
  confirmSignUp(email: string, code: string): Promise<void>;
  resendConfirmationCode(email: string): Promise<void>;
  login(email: string, password: string): Promise<IdpTokens>;
  /** `userSub` is required by Cognito to compute SECRET_HASH for refresh. */
  refresh(refreshToken: string, userSub: string): Promise<{ accessToken: string; expiresIn: number }>;
  revoke(refreshToken: string): Promise<void>;
  verifyAccessToken(token: string): Promise<VerifiedAccessToken>;
}
