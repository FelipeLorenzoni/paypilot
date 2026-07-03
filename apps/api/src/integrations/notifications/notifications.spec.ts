import type { AppConfig } from "../../config/app-config";
import { LogNotificationProvider } from "./log-notification.provider";
import { maskDestination } from "./notification-provider";
import { notificationProviderFactory } from "./notifications.module";
import { WhatsAppNotificationProvider } from "./whatsapp-notification.provider";

const outbound = {
  channel: "WHATSAPP" as const,
  destination: "+5511999998888",
  body: "PayPilot: 'Internet' (R$ 120,00) vence em 3 dias (2026-03-10).",
};

describe("maskDestination", () => {
  it("keeps the prefix and last 3 digits, masking the middle", () => {
    expect(maskDestination("+5511999998888")).toBe("+55********888");
  });

  it("fully masks values too short to partially reveal", () => {
    expect(maskDestination("+551")).toBe("****");
  });
});

describe("LogNotificationProvider", () => {
  it("returns ok and never throws", async () => {
    const provider = new LogNotificationProvider();
    await expect(provider.send(outbound)).resolves.toEqual({ ok: true });
  });
});

describe("WhatsAppNotificationProvider (MVP stub)", () => {
  it("returns a wrapped failure and never fabricates success", async () => {
    const provider = new WhatsAppNotificationProvider();
    await expect(provider.send(outbound)).resolves.toEqual({
      ok: false,
      errorCode: "WHATSAPP_NOT_IMPLEMENTED",
    });
  });
});

describe("notificationProviderFactory", () => {
  it("selects the log provider by default", () => {
    const provider = notificationProviderFactory({
      notificationProvider: "log",
    } as AppConfig);
    expect(provider).toBeInstanceOf(LogNotificationProvider);
  });

  it("selects the WhatsApp provider when configured", () => {
    const provider = notificationProviderFactory({
      notificationProvider: "whatsapp",
    } as AppConfig);
    expect(provider).toBeInstanceOf(WhatsAppNotificationProvider);
  });
});
