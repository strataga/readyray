import { createApiApp } from './api-app.js';

async function bootstrap(): Promise<void> {
  const app = await createApiApp();

  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be a valid TCP port');
  }
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
