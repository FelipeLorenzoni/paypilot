import type { PrismaService } from "../prisma/prisma.service";
import { ReminderSettingsService } from "./reminder-settings.service";

function build(
  overrides: {
    findUnique?: jest.Mock;
    upsert?: jest.Mock;
  } = {},
) {
  const findUnique = overrides.findUnique ?? jest.fn().mockResolvedValue(null);
  const upsert = overrides.upsert ?? jest.fn();
  const prisma = {
    reminderSettings: { findUnique, upsert },
  } as unknown as PrismaService;
  return { service: new ReminderSettingsService(prisma), findUnique, upsert };
}

describe("ReminderSettingsService", () => {
  it("returns opt-out defaults when the user has no settings row", async () => {
    const { service } = build();
    await expect(service.get("u1")).resolves.toEqual({
      phoneE164: null,
      enabled: false,
    });
  });

  it("returns the stored settings", async () => {
    const findUnique = jest.fn().mockResolvedValue({
      phoneE164: "+5511999998888",
      enabled: true,
    });
    const { service } = build({ findUnique });
    await expect(service.get("u1")).resolves.toEqual({
      phoneE164: "+5511999998888",
      enabled: true,
    });
  });

  it("upserts settings scoped to the user and returns the new view", async () => {
    const upsert = jest.fn().mockResolvedValue({
      phoneE164: "+5511999998888",
      enabled: true,
    });
    const { service } = build({ upsert });

    const view = await service.upsert("u1", {
      phoneE164: "+5511999998888",
      enabled: true,
    });

    expect(view).toEqual({ phoneE164: "+5511999998888", enabled: true });
    const arg = upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ userId: "u1" });
    expect(arg.create).toMatchObject({
      userId: "u1",
      phoneE164: "+5511999998888",
      enabled: true,
    });
    expect(arg.update).toMatchObject({
      phoneE164: "+5511999998888",
      enabled: true,
    });
  });

  it("allows clearing the phone with null", async () => {
    const upsert = jest
      .fn()
      .mockResolvedValue({ phoneE164: null, enabled: false });
    const { service } = build({ upsert });
    const view = await service.upsert("u1", {
      phoneE164: null,
      enabled: false,
    });
    expect(view).toEqual({ phoneE164: null, enabled: false });
  });
});
