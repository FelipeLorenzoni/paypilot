import { BusinessCalendar } from "../common/business-calendar";
import { FixedClock } from "../common/clock";
import type { AppConfig } from "../config/app-config";
import {
  GENERATION_TICK_CRON_UTC,
  GenerationScheduler,
} from "./generation.scheduler";
import type { GenerationService } from "./generation.service";

function build(now: string) {
  const generation = { generateForPeriod: jest.fn().mockResolvedValue({}) };
  const scheduler = new GenerationScheduler(
    new BusinessCalendar(new FixedClock(new Date(now)), {
      timeZone: "America/Sao_Paulo",
    } as AppConfig),
    generation as unknown as GenerationService,
  );
  return { scheduler, generation };
}

describe("GenerationScheduler", () => {
  it("ticks every hour in UTC", () => {
    expect(GENERATION_TICK_CRON_UTC).toBe("0 * * * *");
  });

  it.each([
    ["2026-12-01T02:00:00Z", "2026-11"], // 23:00 Nov 30 local
    ["2026-12-01T03:00:00Z", "2026-12"], // local midnight: new month
    ["2026-11-22T12:00:00Z", "2026-11"],
  ])("at %s generates the business month %s", async (now, period) => {
    const { scheduler, generation } = build(now);

    await scheduler.runScheduledGeneration();

    expect(generation.generateForPeriod).toHaveBeenCalledWith(period);
  });
});
