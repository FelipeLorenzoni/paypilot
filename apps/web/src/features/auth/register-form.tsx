"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { FormError } from "../../components/ui/form-error";
import { useApiMutation } from "../../lib/api/hooks";
import { login, register } from "../../lib/api/auth";
import { mapApiErrorToForm } from "../../lib/api/error-mapping";
import { sessionStore } from "../../lib/session/session-store";
import { credentialsSchema, zodFieldErrors } from "./auth-schema";
import styles from "./auth-form.module.css";

const AUTH_FIELDS = ["email", "password"];

export function RegisterForm(): ReactNode {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<{
    message: string;
    requestId: string | null;
  } | null>(null);
  const { run, pending } = useApiMutation(register);

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
    if (!result.ok) {
      const mapped = mapApiErrorToForm(result.error, AUTH_FIELDS, {
        CONFLICT: "This email is already registered.",
      });
      setFieldErrors(mapped.fieldErrors);
      if (mapped.formMessage) {
        setFormError({
          message: mapped.formMessage,
          requestId: mapped.requestId,
        });
      }
      return;
    }

    // Documented flow: register → auto-login → dashboard. A failure between
    // the two lands on /login with a prompt (the account exists).
    const loginResult = await login(parsed.data);
    if (loginResult.ok) {
      sessionStore.set(loginResult.data.accessToken);
      router.replace("/dashboard");
    } else {
      router.replace("/login?registered=1");
    }
  }

  return (
    <form
      className={styles.card}
      onSubmit={(event) => void handleSubmit(event)}
      noValidate
    >
      <h1 className={styles.title}>Create your account</h1>
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
        autoComplete="new-password"
        value={password}
        error={fieldErrors.password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Button type="submit" pending={pending}>
        Create account
      </Button>
    </form>
  );
}
