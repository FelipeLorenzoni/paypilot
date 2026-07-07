"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { z } from "zod";
import type { ReminderSettingsView } from "@paypilot/shared";
import { Button } from "../../components/ui/button";
import { ErrorState } from "../../components/ui/error-state";
import { Field } from "../../components/ui/field";
import { FormError } from "../../components/ui/form-error";
import { Loading } from "../../components/ui/loading";
import { useApiMutation, useApiQuery } from "../../lib/api/hooks";
import {
  getReminderSettings,
  updateReminderSettings,
} from "../../lib/api/reminders";
import { mapApiErrorToForm } from "../../lib/api/error-mapping";
import styles from "./reminders-page.module.css";

// Mirrors the backend rule (`^\+[1-9]\d{7,14}$`); empty clears the phone.
const PHONE_E164 = /^\+[1-9]\d{7,14}$/;
const phoneSchema = z
  .string()
  .trim()
  .refine((value) => value === "" || PHONE_E164.test(value), {
    message: "Enter a phone in E.164 format (e.g. +5511999998888).",
  });

const SETTINGS_FIELDS = ["phoneE164", "enabled"];

function SettingsForm({
  initial,
}: {
  initial: ReminderSettingsView;
}): ReactNode {
  const enabledId = useId();
  const [phone, setPhone] = useState(initial.phoneE164 ?? "");
  const [enabled, setEnabled] = useState(initial.enabled);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<{
    message: string;
    requestId: string | null;
  } | null>(null);
  const [saved, setSaved] = useState(false);
  const { run, pending } = useApiMutation(updateReminderSettings);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSaved(false);
    setFormError(null);

    const parsedPhone = phoneSchema.safeParse(phone);
    if (!parsedPhone.success) {
      setFieldErrors({
        phoneE164:
          parsedPhone.error.issues[0]?.message ?? "Invalid phone number.",
      });
      return;
    }
    setFieldErrors({});

    const result = await run({
      phoneE164: parsedPhone.data === "" ? null : parsedPhone.data,
      enabled,
    });
    if (result.ok) {
      setPhone(result.data.phoneE164 ?? "");
      setEnabled(result.data.enabled);
      setSaved(true);
      return;
    }
    const mapped = mapApiErrorToForm(result.error, SETTINGS_FIELDS);
    setFieldErrors(mapped.fieldErrors);
    if (mapped.formMessage) {
      setFormError({
        message: mapped.formMessage,
        requestId: mapped.requestId,
      });
    }
  }

  return (
    <form
      className={styles.form}
      onSubmit={(event) => void handleSubmit(event)}
      noValidate
    >
      <FormError
        message={formError?.message ?? null}
        requestId={formError?.requestId}
      />
      <Field
        label="WhatsApp phone (E.164)"
        name="phoneE164"
        type="tel"
        placeholder="+5511999998888"
        value={phone}
        error={fieldErrors.phoneE164}
        onChange={(event) => setPhone(event.target.value)}
      />
      <div className={styles.checkboxRow}>
        <input
          id={enabledId}
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <label htmlFor={enabledId}>Reminders enabled</label>
      </div>
      <Button type="submit" pending={pending}>
        Save settings
      </Button>
      {saved ? (
        <p className={styles.saved} role="status">
          Settings saved.
        </p>
      ) : null}
    </form>
  );
}

export function RemindersPage(): ReactNode {
  const state = useApiQuery(() => getReminderSettings(), []);

  return (
    <div>
      <h1>Reminders &amp; settings</h1>
      {state.status === "loading" ? <Loading /> : null}
      {state.status === "error" ? (
        <ErrorState
          message="Could not load your reminder settings."
          requestId={state.error.requestId}
          onRetry={state.retry}
        />
      ) : null}
      {state.status === "loaded" ? <SettingsForm initial={state.data} /> : null}
    </div>
  );
}
