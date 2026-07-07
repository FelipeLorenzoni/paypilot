import type {
  ReminderSettingsUpdate,
  ReminderSettingsView,
} from "@paypilot/shared";
import type { ApiResult } from "./api-error";
import { request } from "./http";

export function getReminderSettings(): Promise<
  ApiResult<ReminderSettingsView>
> {
  return request("/reminders/settings");
}

export function updateReminderSettings(
  update: ReminderSettingsUpdate,
): Promise<ApiResult<ReminderSettingsView>> {
  return request("/reminders/settings", { method: "PUT", body: update });
}
