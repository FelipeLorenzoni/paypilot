import { ServiceUnavailableException } from "@nestjs/common";
import { HealthController } from "./health.controller";
import type { PrismaService } from "../prisma/prisma.service";

function controllerWith(databaseUp: boolean): HealthController {
  const prisma = {
    isHealthy: async () => databaseUp,
  } as unknown as PrismaService;
  return new HealthController(prisma);
}

describe("HealthController", () => {
  it("live returns up without checking dependencies", () => {
    expect(controllerWith(false).live()).toEqual({ status: "up" });
  });

  it("ready returns up when the database is reachable", async () => {
    await expect(controllerWith(true).ready()).resolves.toEqual({
      status: "up",
      checks: { database: "up" },
    });
  });

  it("ready throws ServiceUnavailable (503) when the database is down", async () => {
    await expect(controllerWith(false).ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
