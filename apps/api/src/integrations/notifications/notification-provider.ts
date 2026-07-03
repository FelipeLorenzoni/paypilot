/**
 * Outbound notification port (financial-rules R7). PayPilot features depend on
 * this interface — never on a vendor SDK or API shape. It models what PayPilot
 * needs (a channel, a destination, a message body), not any provider's request
 * format. Follows the `Clock` port pattern (`common/clock.ts`).
 *
 * Implementations NEVER throw: every failure is wrapped into a
 * `NotificationResult` with a stable error code, so vendor exceptions cannot
 * leak into use-case code and the caller decides retry semantics (R2).
 */

/** Delivery channel. Part of the ReminderDelivery identity (MVP: WhatsApp). */
export type NotificationChannel = "WHATSAPP";

export interface OutboundNotification {
  channel: NotificationChannel;
  /** E.164 destination. Never logged unmasked (see {@link maskDestination}). */
  destination: string;
  /** Final message text. Never logged. */
  body: string;
}

export type NotificationResult =
  { ok: true } | { ok: false; errorCode: string };

export interface NotificationProvider {
  send(notification: OutboundNotification): Promise<NotificationResult>;
}

/** DI token for {@link NotificationProvider}. */
export const NOTIFICATION_PROVIDER = Symbol("NOTIFICATION_PROVIDER");

/**
 * Mask a destination for logging: keep the 3-char prefix and last 3 digits,
 * mask everything between. Values too short to reveal anything become "****".
 */
export function maskDestination(destination: string): string {
  if (destination.length < 8) {
    return "****";
  }
  const prefix = destination.slice(0, 3);
  const suffix = destination.slice(-3);
  return `${prefix}${"*".repeat(destination.length - 6)}${suffix}`;
}
