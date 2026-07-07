// Token persistence: localStorage + in-memory mirror with change notification.
// Framework-free by design — no React, no navigation; AuthProvider subscribes
// and owns every redirect. The token is written only to the storage key below,
// never to logs or URLs. localStorage is an MVP decision with a residual XSS
// risk (see design.md Security Considerations); the API stays the boundary.

export const SESSION_STORAGE_KEY = "paypilot.accessToken";

type Listener = () => void;

const listeners = new Set<Listener>();
let memoryToken: string | null = null;
let hydrated = false;

function storage(): Storage | null {
  if (typeof window === "undefined") {
    return null; // SSR: no session on the server, ever.
  }
  try {
    return window.localStorage;
  } catch {
    return null; // storage disabled (privacy mode) → memory-only session
  }
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export const sessionStore = {
  get(): string | null {
    if (!hydrated) {
      memoryToken = storage()?.getItem(SESSION_STORAGE_KEY) ?? null;
      hydrated = true;
    }
    return memoryToken;
  },

  set(token: string): void {
    memoryToken = token;
    hydrated = true;
    storage()?.setItem(SESSION_STORAGE_KEY, token);
    notify();
  },

  clear(): void {
    memoryToken = null;
    hydrated = true;
    storage()?.removeItem(SESSION_STORAGE_KEY);
    notify();
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export type SessionStore = typeof sessionStore;
