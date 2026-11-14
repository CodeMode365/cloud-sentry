import { createHmac } from 'node:crypto';
import {
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  RevokeTokenCommand,
  SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import {
  AppError,
  ConflictError,
  ThrottledError,
  UnauthorizedError,
  UpstreamError,
  ValidationError,
  awsErrorName,
} from '@cloudsentry/utilities';
import type { IdentityProvider, IdpTokens, VerifiedAccessToken } from './identity-provider';

export interface CognitoConfig {
  userPoolId: string;
  clientId: string;
  /** Resolved lazily (Secrets Manager) and cached by the caller. */
  getClientSecret: () => Promise<string>;
  region: string;
}

function mapCognitoError(error: unknown): never {
  const name = awsErrorName(error);
  switch (name) {
    case 'UsernameExistsException':
      throw new ConflictError('An account with this email already exists');
    case 'InvalidPasswordException':
      throw new ValidationError('Password does not meet the password policy');
    case 'CodeMismatchException':
      throw new ValidationError('The confirmation code is incorrect');
    case 'ExpiredCodeException':
      throw new ValidationError('The confirmation code has expired; request a new one');
    case 'NotAuthorizedException':
      throw new UnauthorizedError('Incorrect email or password', 'INVALID_CREDENTIALS');
    case 'UserNotFoundException':
      throw new UnauthorizedError('Incorrect email or password', 'INVALID_CREDENTIALS');
    case 'UserNotConfirmedException':
      throw new AppError('USER_NOT_CONFIRMED', 'Confirm your email address before signing in', 403);
    case 'TooManyRequestsException':
    case 'LimitExceededException':
    case 'TooManyFailedAttemptsException':
      throw new ThrottledError('Too many attempts; try again later');
    case 'InvalidParameterException':
      throw new ValidationError('The request was rejected by the identity provider');
    default:
      throw new UpstreamError('Identity provider request failed', { awsError: name }, { cause: error });
  }
}

/**
 * Cognito user pool integration. Uses a confidential app client (secret held in Secrets Manager) and the
 * USER_PASSWORD_AUTH flow from the backend, so refresh tokens are only ever stored in httpOnly cookies.
 */
export class CognitoIdentityProvider implements IdentityProvider {
  private readonly client: CognitoIdentityProviderClient;
  private readonly verifier;

  constructor(private readonly config: CognitoConfig) {
    this.client = new CognitoIdentityProviderClient({ region: config.region, maxAttempts: 3 });
    this.verifier = CognitoJwtVerifier.create({
      userPoolId: config.userPoolId,
      tokenUse: 'access',
      clientId: config.clientId,
    });
  }

  private async secretHash(username: string): Promise<string> {
    const secret = await this.config.getClientSecret();
    return createHmac('sha256', secret)
      .update(username + this.config.clientId)
      .digest('base64');
  }

  async signUp(input: { email: string; password: string; name: string }) {
    try {
      const out = await this.client.send(
        new SignUpCommand({
          ClientId: this.config.clientId,
          SecretHash: await this.secretHash(input.email),
          Username: input.email,
          Password: input.password,
          UserAttributes: [
            { Name: 'email', Value: input.email },
            { Name: 'name', Value: input.name },
          ],
        }),
      );
      return { userSub: out.UserSub ?? '', confirmed: out.UserConfirmed ?? false };
    } catch (error) {
      mapCognitoError(error);
    }
  }

  async confirmSignUp(email: string, code: string): Promise<void> {
    try {
      await this.client.send(
        new ConfirmSignUpCommand({
          ClientId: this.config.clientId,
          SecretHash: await this.secretHash(email),
          Username: email,
          ConfirmationCode: code,
        }),
      );
    } catch (error) {
      mapCognitoError(error);
    }
  }

  async resendConfirmationCode(email: string): Promise<void> {
    try {
      await this.client.send(
        new ResendConfirmationCodeCommand({
          ClientId: this.config.clientId,
          SecretHash: await this.secretHash(email),
          Username: email,
        }),
      );
    } catch (error) {
      mapCognitoError(error);
    }
  }

  async login(email: string, password: string): Promise<IdpTokens> {
    let out;
    try {
      out = await this.client.send(
        new InitiateAuthCommand({
          ClientId: this.config.clientId,
          AuthFlow: 'USER_PASSWORD_AUTH',
          AuthParameters: { USERNAME: email, PASSWORD: password, SECRET_HASH: await this.secretHash(email) },
        }),
      );
    } catch (error) {
      mapCognitoError(error);
    }
    if (out.ChallengeName) {
      throw new AppError(
        'AUTH_CHALLENGE_UNSUPPORTED',
        `Sign-in requires the ${out.ChallengeName} challenge, which this version of CloudSentry does not support`,
        409,
      );
    }
    const result = out.AuthenticationResult;
    if (!result?.AccessToken || !result.RefreshToken)
      throw new UpstreamError('Identity provider returned no tokens');
    const verified = await this.verifyAccessToken(result.AccessToken);
    return {
      accessToken: result.AccessToken,
      refreshToken: result.RefreshToken,
      expiresIn: result.ExpiresIn ?? 3600,
      userSub: verified.userSub,
    };
  }

  async refresh(refreshToken: string, userSub: string): Promise<{ accessToken: string; expiresIn: number }> {
    let out;
    try {
      out = await this.client.send(
        new InitiateAuthCommand({
          ClientId: this.config.clientId,
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          // With email as the username attribute, Cognito's internal username is the user's sub.
          AuthParameters: { REFRESH_TOKEN: refreshToken, SECRET_HASH: await this.secretHash(userSub) },
        }),
      );
    } catch (error) {
      if (awsErrorName(error) === 'NotAuthorizedException') throw new UnauthorizedError('Session expired');
      mapCognitoError(error);
    }
    const token = out.AuthenticationResult?.AccessToken;
    if (!token) throw new UnauthorizedError('Session expired');
    return { accessToken: token, expiresIn: out.AuthenticationResult?.ExpiresIn ?? 3600 };
  }

  async revoke(refreshToken: string): Promise<void> {
    try {
      await this.client.send(
        new RevokeTokenCommand({
          ClientId: this.config.clientId,
          ClientSecret: await this.config.getClientSecret(),
          Token: refreshToken,
        }),
      );
    } catch (error) {
      // Revocation of an already-invalid token is not an error for logout purposes.
      if (!['UnsupportedTokenTypeException', 'NotAuthorizedException'].includes(awsErrorName(error) ?? '')) {
        mapCognitoError(error);
      }
    }
  }

  async verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
    try {
      const payload = await this.verifier.verify(token);
      return { userSub: payload.sub, expiresAt: payload.exp };
    } catch {
      throw new UnauthorizedError('Invalid or expired access token');
    }
  }
}
