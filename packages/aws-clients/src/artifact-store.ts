import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NotFoundError, isAwsErrorNamed } from '@cloudsentry/utilities';
import { clientDefaults } from './config';

export interface DownloadUrlOptions {
  expiresInSeconds: number;
  filename: string;
  contentType: string;
}

/** Storage for scan artifacts and generated reports. */
export interface ArtifactStore {
  putJson(key: string, value: unknown): Promise<void>;
  getJson<T>(key: string): Promise<T>;
  putObject(key: string, body: Uint8Array | string, contentType: string): Promise<{ sizeBytes: number }>;
  exists(key: string): Promise<boolean>;
  getDownloadUrl(key: string, options: DownloadUrlOptions): Promise<string>;
}

export class S3ArtifactStore implements ArtifactStore {
  constructor(
    private readonly bucket: string,
    private readonly s3: S3Client = new S3Client({ region: process.env.AWS_REGION, ...clientDefaults() }),
  ) {}

  async putJson(key: string, value: unknown): Promise<void> {
    await this.putObject(key, JSON.stringify(value), 'application/json');
  }

  async getJson<T>(key: string): Promise<T> {
    try {
      const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const text = await out.Body?.transformToString('utf-8');
      if (text === undefined) throw new NotFoundError('Artifact', key);
      return JSON.parse(text) as T;
    } catch (error) {
      if (isAwsErrorNamed(error, 'NoSuchKey', 'NotFound')) throw new NotFoundError('Artifact', key);
      throw error;
    }
  }

  async putObject(
    key: string,
    body: Uint8Array | string,
    contentType: string,
  ): Promise<{ sizeBytes: number }> {
    const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
    return { sizeBytes: bytes.byteLength };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      if (isAwsErrorNamed(error, 'NotFound', 'NoSuchKey')) return false;
      throw error;
    }
  }

  async getDownloadUrl(key: string, options: DownloadUrlOptions): Promise<string> {
    const safeName = options.filename.replace(/[^\w.-]/g, '_');
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${safeName}"`,
        ResponseContentType: options.contentType,
      }),
      { expiresIn: options.expiresInSeconds },
    );
  }
}

/**
 * Local-development artifact store backed by the filesystem. Download URLs are HMAC-signed links served
 * by the local API server. Never used in deployed environments.
 */
export class FileSystemArtifactStore implements ArtifactStore {
  constructor(
    private readonly rootDir: string,
    private readonly signingSecret: string,
    private readonly publicBaseUrl: string,
  ) {}

  private pathFor(key: string): string {
    const full = normalize(join(this.rootDir, key));
    if (!full.startsWith(normalize(this.rootDir) + sep)) throw new Error('Invalid artifact key');
    return full;
  }

  async putJson(key: string, value: unknown): Promise<void> {
    await this.putObject(key, JSON.stringify(value, null, 2), 'application/json');
  }

  async getJson<T>(key: string): Promise<T> {
    try {
      return JSON.parse(await readFile(this.pathFor(key), 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError('Artifact', key);
      throw error;
    }
  }

  async putObject(
    key: string,
    body: Uint8Array | string,
    _contentType: string,
  ): Promise<{ sizeBytes: number }> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return { sizeBytes: typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  sign(key: string, expires: number): string {
    return createHmac('sha256', this.signingSecret).update(`${key}\n${expires}`).digest('base64url');
  }

  verifySignature(key: string, expires: number, signature: string): boolean {
    if (expires < Math.floor(Date.now() / 1000)) return false;
    const expected = Buffer.from(this.sign(key, expires));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  async readObject(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async getDownloadUrl(key: string, options: DownloadUrlOptions): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + options.expiresInSeconds;
    const params = new URLSearchParams({
      key,
      expires: String(expires),
      sig: this.sign(key, expires),
      filename: options.filename,
      contentType: options.contentType,
    });
    return `${this.publicBaseUrl}/api/v1/_local/artifacts?${params.toString()}`;
  }
}
