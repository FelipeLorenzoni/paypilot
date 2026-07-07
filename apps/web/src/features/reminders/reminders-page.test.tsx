import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReminderSettingsView } from "@paypilot/shared";
import { ApiError, type ApiResult } from "../../lib/api/api-error";
import { RemindersPage } from "./reminders-page";

const getReminderSettings =
  vi.fn<() => Promise<ApiResult<ReminderSettingsView>>>();
const updateReminderSettings =
  vi.fn<(update: unknown) => Promise<ApiResult<ReminderSettingsView>>>();

vi.mock("../../lib/api/reminders", () => ({
  getReminderSettings: (): Promise<ApiResult<ReminderSettingsView>> =>
    getReminderSettings(),
  updateReminderSettings: (
    update: unknown,
  ): Promise<ApiResult<ReminderSettingsView>> => updateReminderSettings(update),
}));

beforeEach(() => {
  getReminderSettings.mockReset();
  updateReminderSettings.mockReset();
});

describe("RemindersPage", () => {
  it("shows a loading state while settings are pending", () => {
    getReminderSettings.mockReturnValue(new Promise(() => undefined));
    render(<RemindersPage />);
    expect(screen.getByRole("status")).toBeDefined();
  });

  it("shows a retryable error state when loading fails", async () => {
    getReminderSettings.mockResolvedValue({
      ok: false,
      error: new ApiError({
        code: "NETWORK_ERROR",
        message: "offline",
        requestId: null,
      }),
    });
    render(<RemindersPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });

  it("round-trips the settings: renders current values and saves updates", async () => {
    getReminderSettings.mockResolvedValue({
      ok: true,
      data: { phoneE164: "+5511999998888", enabled: false },
    });
    updateReminderSettings.mockResolvedValue({
      ok: true,
      data: { phoneE164: "+5511888887777", enabled: true },
    });
    render(<RemindersPage />);

    const phone = await screen.findByLabelText("WhatsApp phone (E.164)");
    expect((phone as HTMLInputElement).value).toBe("+5511999998888");
    const enabled = screen.getByLabelText("Reminders enabled");
    expect((enabled as HTMLInputElement).checked).toBe(false);

    const user = userEvent.setup();
    await user.clear(phone);
    await user.type(phone, "+5511888887777");
    await user.click(enabled);
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(updateReminderSettings).toHaveBeenCalledWith({
        phoneE164: "+5511888887777",
        enabled: true,
      }),
    );
    expect(await screen.findByText("Settings saved.")).toBeDefined();
  });

  it("blocks an invalid phone client-side", async () => {
    getReminderSettings.mockResolvedValue({
      ok: true,
      data: { phoneE164: null, enabled: false },
    });
    render(<RemindersPage />);

    const phone = await screen.findByLabelText("WhatsApp phone (E.164)");
    const user = userEvent.setup();
    await user.type(phone, "11 99999-8888");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(updateReminderSettings).not.toHaveBeenCalled();
    expect(screen.getByText(/E\.164 format/)).toBeDefined();
  });

  it("sends null when the phone is cleared", async () => {
    getReminderSettings.mockResolvedValue({
      ok: true,
      data: { phoneE164: "+5511999998888", enabled: true },
    });
    updateReminderSettings.mockResolvedValue({
      ok: true,
      data: { phoneE164: null, enabled: true },
    });
    render(<RemindersPage />);

    const phone = await screen.findByLabelText("WhatsApp phone (E.164)");
    const user = userEvent.setup();
    await user.clear(phone);
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(updateReminderSettings).toHaveBeenCalledWith({
        phoneE164: null,
        enabled: true,
      }),
    );
  });

  it("maps a server VALIDATION_ERROR onto the phone field", async () => {
    getReminderSettings.mockResolvedValue({
      ok: true,
      data: { phoneE164: null, enabled: false },
    });
    updateReminderSettings.mockResolvedValue({
      ok: false,
      error: new ApiError({
        code: "VALIDATION_ERROR",
        message: "validation failed",
        requestId: "req-rem-1",
        details: [{ field: "phoneE164", issue: "phoneE164 must be E.164" }],
      }),
    });
    render(<RemindersPage />);

    const phone = await screen.findByLabelText("WhatsApp phone (E.164)");
    const user = userEvent.setup();
    await user.type(phone, "+5511999998888");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(screen.getByText("phoneE164 must be E.164")).toBeDefined(),
    );
  });
});
