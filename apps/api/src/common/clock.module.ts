import { Global, Module } from "@nestjs/common";
import { BusinessCalendar } from "./business-calendar";
import { CLOCK, SystemClock } from "./clock";

/**
 * Global module providing the {@link Clock} port (system time in production)
 * and the {@link BusinessCalendar} derived from it.
 */
@Global()
@Module({
  providers: [{ provide: CLOCK, useClass: SystemClock }, BusinessCalendar],
  exports: [CLOCK, BusinessCalendar],
})
export class ClockModule {}
