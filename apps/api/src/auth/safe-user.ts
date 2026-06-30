/** Public-safe user profile (no passwordHash, tokens, secrets, or internal fields). */
export interface SafeUser {
  id: string;
  email: string;
  createdAt: string;
}
