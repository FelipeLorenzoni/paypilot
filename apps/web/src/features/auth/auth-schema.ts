import { z } from "zod";

// Mirrors (never widens) the auth-jwt DTO rules: email format; password
// min 12 / max 256, no composition rules.
export const credentialsSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters.")
    .max(256, "Password must be at most 256 characters."),
});

export type Credentials = z.infer<typeof credentialsSchema>;

export function zodFieldErrors(
  error: z.ZodError<Credentials>,
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    if (field && !(field in fieldErrors)) {
      fieldErrors[field] = issue.message;
    }
  }
  return fieldErrors;
}
