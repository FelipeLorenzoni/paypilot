import "reflect-metadata";
import { ValidationPipe, VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { requestIdMiddleware } from "./common/request-id";
import { APP_CONFIG, type AppConfig } from "./config/app-config";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get<AppConfig>(APP_CONFIG);

  // Correlation id must run before routing so the filter and logs can read it.
  app.use(requestIdMiddleware);

  // All endpoints live under /{prefix}/v{version}.
  app.setGlobalPrefix(config.apiPrefix);
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: config.apiVersion,
  });

  // Global request validation + canonical error envelope (no business routes).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.listen(config.port);
}

void bootstrap();
