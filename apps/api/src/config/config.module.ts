import { Global, Module } from "@nestjs/common";
import { ConfigModule as NestConfigModule } from "@nestjs/config";
import { APP_CONFIG } from "./app-config";
import { loadConfig } from "./env.schema";

/**
 * Loads `.env` (via @nestjs/config) and exposes a validated, frozen
 * {@link AppConfig} under the {@link APP_CONFIG} token. Validation runs when
 * the provider is constructed, so an invalid environment fails app startup.
 */
@Global()
@Module({
  imports: [NestConfigModule.forRoot({ isGlobal: true, cache: true })],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => loadConfig(process.env),
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
