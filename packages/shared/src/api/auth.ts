/** Credentials accepted by `POST /auth/register` and `POST /auth/login`. */
export interface AuthCredentials {
  email: string;
  password: string;
}

/** `POST /auth/login` success body. */
export interface AuthTokenResponse {
  accessToken: string;
}

/**
 * Public-safe user profile returned by `GET /auth/me` and `POST /auth/register`
 * (the api's `SafeUser`).
 */
export interface MeResponse {
  id: string;
  email: string;
  createdAt: string; // ISO UTC
}
