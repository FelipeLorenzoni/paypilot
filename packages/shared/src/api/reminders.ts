/** Reminder settings returned by `GET`/`PUT /reminders/settings`. */
export interface ReminderSettingsView {
  phoneE164: string | null;
  enabled: boolean;
}

/** `PUT /reminders/settings` body; `phoneE164: null` clears the destination. */
export interface ReminderSettingsUpdate {
  phoneE164?: string | null;
  enabled: boolean;
}
