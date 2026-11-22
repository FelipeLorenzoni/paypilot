import { Test } from "@nestjs/testing";
import { APP_CONFIG, type AppConfig } from "../config/app-config";
import { BusinessCalendar, calendarParts } from "./business-calendar";
import { CLOCK, FixedClock } from "./clock";

const SP = "America/Sao_Paulo";
const NY = "America/New_York";

function calendarAt(iso: string, timeZone: string): BusinessCalendar {
  return new BusinessCalendar(new FixedClock(new Date(iso)), {
    timeZone,
  } as AppConfig);
}

describe("calendarParts", () => {
  it.each([
    ["2026-11-22T01:30:00Z", "2026-11-21", 22], // 22:30 local, UTC is tomorrow
    ["2026-11-22T02:59:59Z", "2026-11-21", 23],
    ["2026-11-22T03:00:00Z", "2026-11-22", 0], // local midnight
    ["2026-11-22T12:00:00Z", "2026-11-22", 9],
  ])("São Paulo: %s → %s, hour %i", (iso, date, hour) => {
    expect(calendarParts(new Date(iso), SP)).toEqual({
      date,
      month: date.slice(0, 7),
      hour,
    });
  });

  it("keeps the previous business month until local midnight on the 1st", () => {
    expect(calendarParts(new Date("2026-12-01T02:00:00Z"), SP).month).toBe(
      "2026-11",
    );
    expect(calendarParts(new Date("2026-12-01T03:00:00Z"), SP).month).toBe(
      "2026-12",
    );
    expect(calendarParts(new Date("2027-01-01T02:59:00Z"), SP)).toMatchObject({
      date: "2026-12-31",
      month: "2026-12",
    });
  });

  it.each([
    "2026-11-22T01:30:00Z",
    "2026-12-31T23:59:59.999Z",
    "2026-01-01T00:00:00Z",
  ])("UTC reproduces the UTC calendar date of %s", (iso) => {
    const instant = new Date(iso);
    expect(calendarParts(instant, "UTC")).toEqual({
      date: instant.toISOString().slice(0, 10),
      month: instant.toISOString().slice(0, 7),
      hour: instant.getUTCHours(),
    });
  });

  it("follows DST on both 2026 transitions", () => {
    // Spring forward 2026-03-08 07:00Z (EST → EDT): 01:59 EST then 03:00 EDT.
    expect(calendarParts(new Date("2026-03-08T06:59:00Z"), NY)).toMatchObject({
      date: "2026-03-08",
      hour: 1,
    });
    expect(calendarParts(new Date("2026-03-08T07:00:00Z"), NY)).toMatchObject({
      date: "2026-03-08",
      hour: 3,
    });
    // Local midnight is 04:00Z under EDT and 05:00Z under EST.
    expect(calendarParts(new Date("2026-03-09T03:59:00Z"), NY).date).toBe(
      "2026-03-08",
    );
    expect(calendarParts(new Date("2026-03-09T04:00:00Z"), NY).date).toBe(
      "2026-03-09",
    );
    // Fall back 2026-11-01 06:00Z (EDT → EST).
    expect(calendarParts(new Date("2026-11-02T04:59:00Z"), NY).date).toBe(
      "2026-11-01",
    );
    expect(calendarParts(new Date("2026-11-02T05:00:00Z"), NY).date).toBe(
      "2026-11-02",
    );
  });

  it("does not depend on the process timezone", () => {
    const original = process.env.TZ;
    const instant = new Date("2026-11-22T01:30:00Z");
    try {
      const results = ["UTC", "Asia/Tokyo", "America/Los_Angeles"].map((tz) => {
        process.env.TZ = tz;
        return calendarParts(instant, SP);
      });
      for (const result of results) {
        expect(result).toEqual({
          date: "2026-11-21",
          month: "2026-11",
          hour: 22,
        });
      }
    } finally {
      process.env.TZ = original;
    }
  });

  it("rejects an invalid instant", () => {
    expect(() => calendarParts(new Date("not a date"), SP)).toThrow(
      /Invalid instant/,
    );
  });
});

describe("BusinessCalendar", () => {
  it("derives today, month and hour from the injected clock and zone", () => {
    const calendar = calendarAt("2026-12-01T02:00:00Z", SP);
    expect(calendar.today()).toBe("2026-11-30");
    expect(calendar.month()).toBe("2026-11");
    expect(calendar.hour()).toBe(23);
  });

  it("reads the clock on every call", () => {
    let instant = new Date("2026-11-22T02:59:00Z");
    const calendar = new BusinessCalendar({ now: () => instant }, {
      timeZone: SP,
    } as AppConfig);
    expect(calendar.today()).toBe("2026-11-21");
    instant = new Date("2026-11-22T03:00:00Z");
    expect(calendar.today()).toBe("2026-11-22");
  });

  it("is driven by an overridden CLOCK provider", async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BusinessCalendar,
        {
          provide: CLOCK,
          useValue: new FixedClock(new Date("2026-11-22T01:30:00Z")),
        },
        { provide: APP_CONFIG, useValue: { timeZone: SP } },
      ],
    }).compile();
    expect(moduleRef.get(BusinessCalendar).today()).toBe("2026-11-21");
  });
});
