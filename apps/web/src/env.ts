import { z } from "zod";

/**
 * Web environment. `NEXT_PUBLIC_API_BASE_URL` is **public by design** (the
 * `NEXT_PUBLIC_` prefix inlines it into the browser bundle): it must contain
 * only a non-sensitive base URL and never secrets/tokens.
 */
const schema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default("http://localhost:3000"),
});

// Reference the var explicitly so Next can statically inline it at build time.
export const env = schema.parse({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
});
