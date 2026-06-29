import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";

/** Liveness/readiness endpoints. PrismaService is provided globally. */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
