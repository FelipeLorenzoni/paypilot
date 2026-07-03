import { Module } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../../config/app-config";
import { LogNotificationProvider } from "./log-notification.provider";
import {
  NOTIFICATION_PROVIDER,
  type NotificationProvider,
} from "./notification-provider";
import { WhatsAppNotificationProvider } from "./whatsapp-notification.provider";

/**
 * Selects the concrete {@link NotificationProvider} from validated config
 * (fail-fast at boot: `whatsapp` without credentials never gets here). The
 * log/fake provider is the default — no real API calls in dev or tests.
 */
export function notificationProviderFactory(
  config: AppConfig,
): NotificationProvider {
  return config.notificationProvider === "whatsapp"
    ? new WhatsAppNotificationProvider()
    : new LogNotificationProvider();
}

@Module({
  providers: [
    {
      provide: NOTIFICATION_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: notificationProviderFactory,
    },
  ],
  exports: [NOTIFICATION_PROVIDER],
})
export class NotificationsModule {}
