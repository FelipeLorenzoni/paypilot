import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { BusinessCalendar } from "../common/business-calendar";
import { ReminderEvaluationService } from "./reminder-evaluation.service";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Local/ops CLI to run one reminder evaluation (generation-CLI precedent):
 *
 *   pnpm --filter @paypilot/api remind:run 2026-03-07
 *
 * With no argument it uses business today (app-timezone). Idempotent: safe to
 * re-run — already-claimed identities are skipped (R2).
 */
async function main(): Promise<void> {
  const logger = new Logger("remind-run");
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn", "log"],
  });
  try {
    const arg = process.argv[2];
    if (arg !== undefined && !DATE.test(arg)) {
      throw new Error(`Invalid date "${arg}" (expected YYYY-MM-DD)`);
    }
    const today = arg ?? app.get(BusinessCalendar).today();
    const summary = await app.get(ReminderEvaluationService).evaluate(today);
    logger.log(`done ${JSON.stringify(summary)}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
