import { buildApp } from './app.js';
import { env } from './env.js';
import { migrate } from './migrate.js';
import { pool } from './db.js';

await migrate(); // migra no boot: no plano free do Render não há "pre-deploy command"
const app = await buildApp();
await app.listen({ port: env.PORT, host: '0.0.0.0' });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
