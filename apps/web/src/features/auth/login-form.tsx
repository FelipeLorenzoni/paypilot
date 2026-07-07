"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { FormError } from "../../components/ui/form-error";
import { useApiMutation } from "../../lib/api/hooks";
import { login } from "../../lib/api/auth";
import { mapApiErrorToForm } from "../../lib/api/error-mapping";
import { sessionStore } from "../../lib/session/session-store";
import { credentialsSchema, zodFieldErrors } from "./auth-schema";
import styles from "./auth-form.module.css";

const AUTH_FIELDS = ["email", "password"];

export function LoginForm(): ReactNode {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<{
    message: string;
    requestId: string | null;
  } | null>(null);
  const { run, pending } = useApiMutation(login);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setFormError(null);

    const parsed = credentialsSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(zodFieldErrors(parsed.error));
      return;
    }
    setFieldErrors({});

    const result = await run(parsed.data);
    if (result.ok) {
      sessionStore.set(result.data.accessToken);
      router.replace("/dashboard");
      return;
    }
    const mapped = mapApiErrorToForm(result.error, AUTH_FIELDS, {
      // Non-enumerating: never says whether the email exists (1.4).
      UNAUTHORIZED: "Invalid email or password.",
    });
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
      className={styles.card}
      onSubmit={(event) => void handleSubmit(event)}
      noValidate
    >
      <h1 className={styles.title}>Log in</h1>
      <FormError
        message={formError?.message ?? null}
        requestId={formError?.requestId}
      />
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        value={email}
        error={fieldErrors.email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        value={password}
        error={fieldErrors.password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Button type="submit" pending={pending}>
        Log in
      </Button>
    </form>
  );
}
