import { Injectable } from "@nestjs/common";

/**
 * Time source port. Domain/use-case code depends on this, never on `Date.now()`
 * directly, so date-sensitive logic is deterministic in tests (see steering
 * `testing.md` / `financial-rules.md`). This is also the template pattern future
 * provider ports (e.g. NotificationProvider) follow.
 */
export interface Clock {
  /** Current instant (UTC). */
  now(): Date;
}

/** DI token for {@link Clock}. */
export const CLOCK = Symbol("CLOCK");

/** Production clock backed by real system time. */
@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Test double returning a fixed instant. */
export class FixedClock implements Clock {
  constructor(private readonly fixed: Date) {}

  now(): Date {
    return this.fixed;
  }
}
