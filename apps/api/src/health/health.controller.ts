import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** Health endpoints under /api/v1/health (liveness + readiness). */
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: dependency-free; succeeds whenever the process is running. */
  @Get("live")
  live(): { status: "up" } {
    return { status: "up" };
  }

  /** Readiness: succeeds only when required dependencies (the DB) are reachable. */
  @Get("ready")
  async ready(): Promise<{ status: "up"; checks: { database: "up" } }> {
    const databaseUp = await this.prisma.isHealthy();
    if (!databaseUp) {
      throw new ServiceUnavailableException("Database is not reachable");
    }
    return { status: "up", checks: { database: "up" } };
  }
}
