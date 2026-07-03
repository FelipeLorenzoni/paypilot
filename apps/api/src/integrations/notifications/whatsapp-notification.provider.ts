import { Injectable, Logger } from "@nestjs/common";
import {
  maskDestination,
  type NotificationProvider,
  type NotificationResult,
  type OutboundNotification,
} from "./notification-provider";

/**
 * WhatsApp provider — **MVP stub** (per design: a DI boundary, not a real
 * integration). It is selected only when `NOTIFICATION_PROVIDER=whatsapp` and
 * the credentials passed startup validation, and it honestly reports a wrapped
 * failure instead of fabricating a success: deliveries record FAILED (with a
 * stable code) and remain safely retriable once the real Cloud-API adapter
 * lands in a follow-up spec. That future spec MUST add provider idempotency or
 * a delivery-confirmation strategy before going live (see design.md, R2
 * delivery-guarantee semantics). Swapping in the real call touches only this
 * class (R7).
 */
@Injectable()
export class WhatsAppNotificationProvider implements NotificationProvider {
  private readonly logger = new Logger(WhatsAppNotificationProvider.name);

  send(notification: OutboundNotification): Promise<NotificationResult> {
    this.logger.warn(
      `notification channel=${notification.channel} destination=${maskDestination(
        notification.destination,
      )} result=WHATSAPP_NOT_IMPLEMENTED`,
    );
    return Promise.resolve({
      ok: false,
      errorCode: "WHATSAPP_NOT_IMPLEMENTED",
    });
  }
}
