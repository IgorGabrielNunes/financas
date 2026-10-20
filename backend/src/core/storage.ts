import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env.js';

// Abstração mínima: local (dev) e S3-compatível (prod: R2/Supabase/S3).
// Comprovante nunca vai para o banco como blob: o banco guarda só a chave.
export interface Storage {
  put(key: string, body: Buffer, mime: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** URL temporária (5 min) para visualizar o arquivo sem header de auth. */
  signedUrl(key: string, comprovanteId: string, nome: string): Promise<string>;
}

const TTL_SEG = 300;

function assinar(id: string, exp: number) {
  return createHmac('sha256', env.JWT_SECRET).update(`${id}.${exp}`).digest('base64url');
}

export function validarAssinaturaLocal(id: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const a = Buffer.from(assinar(id, exp));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

class LocalStorage implements Storage {
  private base = path.resolve(env.STORAGE_LOCAL_DIR);
  private file(key: string) {
    const p = path.resolve(this.base, key);
    if (!p.startsWith(this.base + path.sep)) throw new Error('chave inválida'); // path traversal
    return p;
  }
  async put(key: string, body: Buffer) {
    const p = this.file(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  async remove(key: string) {
    await unlink(this.file(key)).catch(() => {});
  }
  async read(key: string) {
    return readFile(this.file(key));
  }
  async signedUrl(_key: string, id: string) {
    const exp = Math.floor(Date.now() / 1000) + TTL_SEG;
    return `${env.PUBLIC_API_URL}/comprovantes/${id}/arquivo?exp=${exp}&sig=${assinar(id, exp)}`;
  }
}

class S3Storage implements Storage {
  private s3 = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
  });
  async put(key: string, body: Buffer, mime: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: mime }));
  }
  async remove(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key })).catch(() => {});
  }
  async signedUrl(key: string, _id: string, nome: string) {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        ResponseContentDisposition: `inline; filename="${encodeURIComponent(nome)}"`,
      }),
      { expiresIn: TTL_SEG },
    );
  }
}

export const storage: Storage = env.STORAGE_DRIVER === 's3' ? new S3Storage() : new LocalStorage();
export const localStorageDriver = storage instanceof LocalStorage ? storage : null;
