import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { CLOCK, type Clock } from "../common/clock";
import { deriveCurrentPeriod } from "./generation.helpers";
import { GenerationService } from "./generation.service";

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Local/ops CLI to run generation for a period. Controlled trigger for the
 * current auth model (no admin/RBAC, no public HTTP endpoint):
 *
 *   pnpm --filter @paypilot/api generate:recurring 2026-03
 *
 * With no argument it uses the current UTC period. Idempotent: safe to re-run.
 */
async function main(): Promise<void> {
  const logger = new Logger("generate-recurring");
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn", "log"],
  });
  try {
    const arg = process.argv[2];
    if (arg !== undefined && !PERIOD.test(arg)) {
      throw new Error(`Invalid period "${arg}" (expected YYYY-MM)`);
    }
    const period = arg ?? deriveCurrentPeriod(app.get<Clock>(CLOCK));
    const summary = await app.get(GenerationService).generateForPeriod(period);
    logger.log(`done ${JSON.stringify(summary)}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
