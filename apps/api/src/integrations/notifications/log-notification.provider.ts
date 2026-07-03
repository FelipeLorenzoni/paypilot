import { Injectable, Logger } from "@nestjs/common";
import {
  maskDestination,
  type NotificationProvider,
  type NotificationResult,
  type OutboundNotification,
} from "./notification-provider";

/**
 * Development/test default (steering integrations.md): records the send as a
 * log line and reports success — no real API is ever called and no credentials
 * are needed. Logs only the channel and a MASKED destination; never the body.
 */
@Injectable()
export class LogNotificationProvider implements NotificationProvider {
  private readonly logger = new Logger(LogNotificationProvider.name);

  send(notification: OutboundNotification): Promise<NotificationResult> {
    this.logger.log(
      `notification channel=${notification.channel} destination=${maskDestination(
        notification.destination,
      )} result=ok`,
    );
    return Promise.resolve({ ok: true });
  }
}
