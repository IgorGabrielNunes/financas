import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  // true = TLS com verificação de certificado (Neon, Supabase: CA pública); no-verify = TLS sem verificar (último recurso)
  DATABASE_SSL: z.enum(['true', 'false', 'no-verify']).default('false'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  PUBLIC_API_URL: z.string().default('http://localhost:3333'),
  PORT: z.coerce.number().default(3333),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./uploads'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  // avisos (opcionais): robô do Telegram e gatilho externo do disparo
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),     // sem @, ex.: VidaIgorBot
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
  AVISOS_TOKEN: z.string().min(24).optional(),      // Bearer do POST /interno/avisos/disparar
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Variáveis de ambiente inválidas:', parsed.error.issues);
  process.exit(1);
}
export const env = parsed.data;

if (env.STORAGE_DRIVER === 's3' && !(env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY)) {
  console.error('STORAGE_DRIVER=s3 exige S3_BUCKET, S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY');
  process.exit(1);
}
