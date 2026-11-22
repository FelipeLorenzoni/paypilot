import { Inject, Injectable } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/app-config";
import { CLOCK, type Clock } from "./clock";

/** Wall-clock calendar values of an instant in one timezone. */
export interface CalendarParts {
  /** `"YYYY-MM-DD"` date in the zone. */
  readonly date: string;
  /** `"YYYY-MM"`. */
  readonly month: string;
  /** 0–23 hour in the zone. */
  readonly hour: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * Calendar date, month and hour of `instant` in `timeZone` (app-timezone
 * requirement 2). Uses the runtime's ICU, so DST is honoured and the result
 * never depends on the process `TZ`.
 */
export function calendarParts(instant: Date, timeZone: string): CalendarParts {
  if (Number.isNaN(instant.getTime())) {
    throw new Error("Invalid instant");
  }
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    parts[part.type] = part.value;
  }
  const month = `${parts.year}-${parts.month}`;
  return { date: `${month}-${parts.day}`, month, hour: Number(parts.hour) };
}

/**
 * The only place an instant becomes a business calendar value: "today", the
 * current month and the current hour in the configured business timezone.
 * Reads the injected clock on every call, so tests that replace `CLOCK`
 * drive it. Never returns instants — code that persists one keeps using
 * `Clock.now()`.
 */
@Injectable()
export class BusinessCalendar {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Business today, `"YYYY-MM-DD"`. */
  today(): string {
    return this.parts().date;
  }

  /** Business month, `"YYYY-MM"`. */
  month(): string {
    return this.parts().month;
  }

  /** Business wall-clock hour, 0–23. */
  hour(): number {
    return this.parts().hour;
  }

  private parts(): CalendarParts {
    return calendarParts(this.clock.now(), this.config.timeZone);
  }
}
