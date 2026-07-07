import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionStore, SESSION_STORAGE_KEY } from "./session-store";

afterEach(() => {
  sessionStore.clear();
  vi.restoreAllMocks();
});

describe("sessionStore", () => {
  it("round-trips a token", () => {
    sessionStore.set("token-abc");
    expect(sessionStore.get()).toBe("token-abc");
  });

  it("mirrors the token in localStorage and reads it back", () => {
    sessionStore.set("token-abc");
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBe("token-abc");
  });

  it("clear removes the token everywhere and is idempotent", () => {
    sessionStore.set("token-abc");
    sessionStore.clear();
    expect(sessionStore.get()).toBeNull();
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(() => sessionStore.clear()).not.toThrow();
    expect(sessionStore.get()).toBeNull();
  });

  it("notifies subscribers on set and on clear", () => {
    const listener = vi.fn();
    const unsubscribe = sessionStore.subscribe(listener);
    sessionStore.set("token-abc");
    expect(listener).toHaveBeenCalledTimes(1);
    sessionStore.clear();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = sessionStore.subscribe(listener);
    unsubscribe();
    sessionStore.set("token-abc");
    expect(listener).not.toHaveBeenCalled();
  });

  it("never passes the token to any console logger", () => {
    const spies = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "info"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "error"),
      vi.spyOn(console, "debug"),
    ];
    sessionStore.set("secret-token");
    sessionStore.get();
    sessionStore.clear();
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain("secret-token");
      }
    }
  });
});
