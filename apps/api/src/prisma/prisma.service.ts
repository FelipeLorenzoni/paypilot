import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { APP_CONFIG, type AppConfig } from "../config/app-config";
import { PrismaClient } from "../generated/prisma/client";

/**
 * Owns the Prisma client lifecycle and exposes a readiness ping. All data
 * access goes through this service. The connection is supplied via the
 * @prisma/adapter-pg driver adapter (Prisma 7 model).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      adapter: new PrismaPg({ connectionString: config.databaseUrl }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Readiness probe: returns true when the database answers a trivial query. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error(
        "Database readiness check failed",
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }
}
