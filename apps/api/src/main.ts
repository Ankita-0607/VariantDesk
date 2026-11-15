import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';
import { assertConfig, config } from './common/config';

async function bootstrap() {
  assertConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true });
  app.useBodyParser('json', { limit: '2mb' });
  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.corsOrigin.split(','), credentials: false });
  app.enableShutdownHooks();

  // Serve the built web app (single-container deployment) when present.
  const web = [process.env.WEB_DIST, join(process.cwd(), '../web/dist'), join(process.cwd(), 'public')].find((p) => p && existsSync(join(p, 'index.html')));
  if (web) {
    app.useStaticAssets(web);
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.get(/^\/(?!api\/).*/, (_req: unknown, res: { sendFile: (p: string) => void }) => res.sendFile(join(web, 'index.html')));
  }
  await app.listen(config.port);
  Logger.log(`VariantDesk API on http://localhost:${config.port}/api  (AI: ${config.ai.provider})`, 'Bootstrap');
}
void bootstrap();
