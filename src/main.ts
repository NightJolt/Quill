import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { QuillConfig } from './common/config/quill-config';
import { ApiExceptionFilter } from './common/exceptions/api-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(QuillConfig);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new ApiExceptionFilter());

  // Serialize response DTOs via class-transformer decorators (@IdField,
  // @IsoDate, @Type, @Expose, etc.). Replaces the per-service `toRes()`
  // mappers that manually called `.toISOString()` / `.toString()` on every
  // field — those collapse to `plainToInstance(MyRes, source)` because the
  // class declarations now own the conversion rules.
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
  });

  app.useWebSocketAdapter(new IoAdapter(app));

  // Two bearer schemes — paste the admin token into "admin" and an app's
  // private key into "appKey". The Authorize button on /swagger shows both.
  // WebSocket protocol isn't documented here (Swagger doesn't model it
  // natively); see src/ws/ws-events.ts for the live event shapes.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Quill')
    .setDescription(
      'Multi-tenant chat backend.\n\n' +
        '**Admin** endpoints (`/admin/**`) use `QUILL_ADMIN_TOKEN` (single root credential).\n\n' +
        '**Internal** endpoints (`/internal/**`) use an app\'s private key — created via `POST /admin/apps`.',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', description: 'QUILL_ADMIN_TOKEN' },
      'admin',
    )
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', description: 'App private key' },
      'appKey',
    )
    // Signature auth (user-facing REST): three discrete headers, validated
    // together by SignatureGuard. Paste each into the matching field of
    // Swagger's Authorize dialog.
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'X-Quill-App-Id', description: '24-char hex appId' },
      'quill-app-id',
    )
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'X-Quill-User-Id', description: '24-char hex userId' },
      'quill-user-id',
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-Quill-Signature',
        description: 'HMAC-SHA256(userId, app_privateKey) as hex',
      },
      'quill-signature',
    )
    .build();
  const doc = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('swagger', app, doc, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(config.port);
  // eslint-disable-next-line no-console
  console.log(`Quill listening on :${config.port}  •  Swagger: http://localhost:${config.port}/swagger`);
}

bootstrap();
