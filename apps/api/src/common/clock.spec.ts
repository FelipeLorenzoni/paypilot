import { Test } from "@nestjs/testing";
import { CLOCK, type Clock, FixedClock, SystemClock } from "./clock";

describe("Clock", () => {
  it("SystemClock returns the current time", () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
  });

  it("FixedClock returns the injected instant", () => {
    const fixed = new Date("2026-01-01T00:00:00.000Z");
    expect(new FixedClock(fixed).now()).toEqual(fixed);
  });

  it("can be substituted via the Nest testing module (overrideProvider)", async () => {
    const fixed = new Date("2030-06-15T12:00:00.000Z");
    const moduleRef = await Test.createTestingModule({
      providers: [{ provide: CLOCK, useClass: SystemClock }],
    })
      .overrideProvider(CLOCK)
      .useValue(new FixedClock(fixed))
      .compile();

    const clock = moduleRef.get<Clock>(CLOCK);
    expect(clock.now()).toEqual(fixed);
  });
});
