import ms from "ms";

// Per-route throttle limits for @Throttle decorators. Decorators evaluate at
// import time, so these read process.env directly — the SAME variables the
// validated env schema checks at boot (so values are guaranteed valid there).
const msToNumber = ms as unknown as (value: string) => number | undefined;

function points(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function windowMs(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? msToNumber(raw) : undefined;
  return typeof parsed === "number" && parsed > 0 ? parsed : fallback;
}

export const LOGIN_THROTTLE = {
  limit: points("AUTH_LOGIN_RATE_LIMIT_POINTS", 5),
  ttl: windowMs("AUTH_LOGIN_RATE_LIMIT_WINDOW", 60_000),
};

export const REGISTER_THROTTLE = {
  limit: points("AUTH_REGISTER_RATE_LIMIT_POINTS", 3),
  ttl: windowMs("AUTH_REGISTER_RATE_LIMIT_WINDOW", 60_000),
};
