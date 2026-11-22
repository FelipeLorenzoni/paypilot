import { BusinessCalendar } from "../common/business-calendar";
import { FixedClock } from "../common/clock";
import type { AppConfig } from "../config/app-config";
import type { ReminderEvaluationService } from "./reminder-evaluation.service";
import { REMINDER_LOCAL_HOUR } from "./reminder.constants";
import { RemindersScheduler } from "./reminders.scheduler";

function build(now: string) {
  const evaluation = { evaluate: jest.fn().mockResolvedValue({}) };
  const scheduler = new RemindersScheduler(
    new BusinessCalendar(new FixedClock(new Date(now)), {
      timeZone: "America/Sao_Paulo",
    } as AppConfig),
    evaluation as unknown as ReminderEvaluationService,
  );
  return { scheduler, evaluation };
}

describe("RemindersScheduler", () => {
  it("runs at the local reminder hour", () => {
    expect(REMINDER_LOCAL_HOUR).toBe(9);
  });

  it("evaluates business today on the tick inside the local reminder hour", async () => {
    // 12:15Z is 09:15 in São Paulo.
    const { scheduler, evaluation } = build("2026-11-22T12:15:00Z");

    await scheduler.runScheduledEvaluation();

    expect(evaluation.evaluate).toHaveBeenCalledTimes(1);
    expect(evaluation.evaluate).toHaveBeenCalledWith("2026-11-22");
  });

  it.each([
    "2026-11-22T11:15:00Z", // 08:15 local
    "2026-11-22T13:15:00Z", // 10:15 local
    "2026-11-23T02:15:00Z", // 23:15 local, already the next UTC day
  ])("does nothing on the %s tick", async (now) => {
    const { scheduler, evaluation } = build(now);

    await scheduler.runScheduledEvaluation();

    expect(evaluation.evaluate).not.toHaveBeenCalled();
  });
});
