import 'reflect-metadata';
import { ValidationPipe, type DynamicModule, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { EVIDENCE_ARCHIVE_LIMITS } from '@archgauge/evidence/application';
import { AppModule } from './app.module.js';
import { bodyParserProblem } from './http/body-parser-problem.middleware.js';
import { evidenceUploadPreauth } from './http/evidence-upload-preauth.middleware.js';
import { ProblemDetailsFilter } from './http/problem-details.filter.js';
import { requestContextMiddleware } from './http/request-context.middleware.js';
import { ResolveSession } from './modules/identity/application/resolve-session.use-case.js';
import { EVIDENCE_WORKSPACE_AUTHORIZATION } from './modules/evidence/http/evidence.tokens.js';
import type { WorkspaceEvidenceAuthorizationPort } from '@archgauge/evidence/application';

export async function createApiApp(rootModule: Type<unknown> | DynamicModule = AppModule) {
  const app = await NestFactory.create(rootModule, { bufferLogs: true, bodyParser: false });
  app.setGlobalPrefix('v1');
  app.use(requestContextMiddleware);
  app.use('/v1/workspaces/:workspaceId/evidence/archives', evidenceUploadPreauth(
    app.get(ResolveSession),
    app.get<WorkspaceEvidenceAuthorizationPort>(EVIDENCE_WORKSPACE_AUTHORIZATION),
  ));
  const evidenceZipParser = express.raw({
    type: 'application/zip',
    limit: EVIDENCE_ARCHIVE_LIMITS.maxCompressedBytes,
  });
  app.use('/v1/workspaces/:workspaceId/evidence/archives', (request: Request, response: Response, next: NextFunction) => {
    if (request.method !== 'POST' || request.path !== '/') {
      next();
      return;
    }
    evidenceZipParser(request, response, next);
  });
  app.use(express.json({ limit: '32kb' }));
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use(bodyParserProblem);
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: true,
  }));

  const config = new DocumentBuilder()
    .setTitle('ArchGauge API')
    .setDescription('ArchGauge public API')
    .setVersion('1.0.0')
    .setOpenAPIVersion('3.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'Opaque session token' }, 'bearer')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: '/openapi.json',
    yamlDocumentUrl: '/openapi.yaml',
  });
  app.enableShutdownHooks();
  return app;
}
