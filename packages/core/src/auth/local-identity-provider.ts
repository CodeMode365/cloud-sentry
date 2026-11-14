import { randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { SignJWT, jwtVerify } from 'jose';
import {
  AppError,
  ConflictError,
  UnauthorizedError,
  ValidationError,
  type Logger,
} from '@cloudsentry/utilities';
import type { IdentityProvider, IdpTokens, VerifiedAccessToken } from './identity-provider';

interface LocalUser {
  sub: string;
  email: string;
  name: string;
  passwordHash: string;
  salt: string;
  confirmed: boolean;
  confirmationCode: string | null;
}

interface LocalStore {
  users: Record<string, LocalUser>;
  refreshTokens: Record<string, { sub: string; expiresAt: number }>;
}

/**
 * LOCAL DEVELOPMENT ONLY identity provider. Users live in a JSON file, passwords are scrypt-hashed and
 * access tokens are HS256 JWTs signed with LOCAL_JWT_SECRET. Confirmation codes are written to the log.
 * The constructor refuses to run unless STAGE=local, so it can never be enabled in a deployed stage.
 */
export class LocalIdentityProvider implements IdentityProvider {
  private readonly key: Uint8Array;

  constructor(
    private readonly storePath: string,
    secret: string,
    private readonly logger: Logger,
  ) {
    if (process.env.STAGE !== 'local' || process.env.NODE_ENV === 'production') {
      throw new Error('LocalIdentityProvider may only be used with STAGE=local');
    }
    if (secret.length < 32) throw new Error('LOCAL_JWT_SECRET must be at least 32 characters');
    this.key = new TextEncoder().encode(secret);
  }

  private load(): LocalStore {
    if (!existsSync(this.storePath)) return { users: {}, refreshTokens: {} };
    return JSON.parse(readFileSync(this.storePath, 'utf8')) as LocalStore;
  }

  private save(store: LocalStore): void {
    mkdirSync(dirname(this.storePath), { recursive: true });
    writeFileSync(this.storePath, JSON.stringify(store, null, 2), { mode: 0o600 });
  }

  private hash(password: string, salt: string): string {
    return scryptSync(password, salt, 64).toString('hex');
  }

  async signUp(input: { email: string; password: string; name: string }) {
    const store = this.load();
    if (store.users[input.email]) throw new ConflictError('An account with this email already exists');
    const salt = randomBytes(16).toString('hex');
    const code = String(randomInt(100000, 999999));
    const sub = randomUUID();
    store.users[input.email] = {
      sub,
      email: input.email,
      name: input.name,
      salt,
      passwordHash: this.hash(input.password, salt),
      confirmed: false,
      confirmationCode: code,
    };
    this.save(store);
    this.logger.warn('LOCAL DEV: email confirmation code (not sent anywhere)', { email: input.email, code });
    return { userSub: sub, confirmed: false };
  }

  async confirmSignUp(email: string, code: string): Promise<void> {
    const store = this.load();
    const user = store.users[email];
    if (!user || user.confirmationCode !== code)
      throw new ValidationError('The confirmation code is incorrect');
    user.confirmed = true;
    user.confirmationCode = null;
    this.save(store);
  }

  async resendConfirmationCode(email: string): Promise<void> {
    const store = this.load();
    const user = store.users[email];
    if (!user || user.confirmed) return;
    user.confirmationCode = String(randomInt(100000, 999999));
    this.save(store);
    this.logger.warn('LOCAL DEV: email confirmation code (not sent anywhere)', {
      email,
      code: user.confirmationCode,
    });
  }

  async login(email: string, password: string): Promise<IdpTokens> {
    const store = this.load();
    const user = store.users[email];
    const candidate = user ? Buffer.from(this.hash(password, user.salt), 'hex') : Buffer.alloc(64);
    const expected = user ? Buffer.from(user.passwordHash, 'hex') : Buffer.alloc(64, 1);
    if (!user || !timingSafeEqual(candidate, expected)) {
      throw new UnauthorizedError('Incorrect email or password', 'INVALID_CREDENTIALS');
    }
    if (!user.confirmed)
      throw new AppError('USER_NOT_CONFIRMED', 'Confirm your email address before signing in', 403);
    const refreshToken = randomBytes(48).toString('base64url');
    store.refreshTokens[refreshToken] = { sub: user.sub, expiresAt: Date.now() + 30 * 86_400_000 };
    this.save(store);
    return { accessToken: await this.issue(user.sub), refreshToken, expiresIn: 3600, userSub: user.sub };
  }

  private issue(sub: string): Promise<string> {
    return new SignJWT({ token_use: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuer('cloudsentry-local')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(this.key);
  }

  async refresh(refreshToken: string, userSub: string): Promise<{ accessToken: string; expiresIn: number }> {
    const entry = this.load().refreshTokens[refreshToken];
    if (!entry || entry.sub !== userSub || entry.expiresAt < Date.now())
      throw new UnauthorizedError('Session expired');
    return { accessToken: await this.issue(entry.sub), expiresIn: 3600 };
  }

  async revoke(refreshToken: string): Promise<void> {
    const store = this.load();
    delete store.refreshTokens[refreshToken];
    this.save(store);
  }

  async verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: 'cloudsentry-local',
        algorithms: ['HS256'],
      });
      if (!payload.sub || payload.token_use !== 'access') throw new Error('bad token');
      return { userSub: payload.sub, expiresAt: payload.exp ?? 0 };
    } catch {
      throw new UnauthorizedError('Invalid or expired access token');
    }
  }
}
