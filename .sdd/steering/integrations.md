# Integrations & Provider Abstraction

PayPilot talks to external systems (WhatsApp now; bank/email/SMS possible later). These are always accessed through an **interface owned by PayPilot**, never via direct SDK calls from domain or use-case code. This is invariant R7 in [[financial-rules]].

## Pattern

For each integration kind, define:

1. An **interface** describing what PayPilot needs (intent-revealing, provider-agnostic).
2. One or more **implementations** selected by configuration/DI.
3. A **fake/log implementation** that is the default in development and tests.

```typescript
// The contract PayPilot depends on
interface NotificationProvider {
  send(message: OutboundNotification): Promise<NotificationResult>;
}

// Development / test default — records, never calls a real API
class LogNotificationProvider implements NotificationProvider {
  /* logs + returns success */
}

// Real provider — only wired up when configured with credentials
class WhatsAppNotificationProvider implements NotificationProvider {
  /* ... */
}
```

## Rules

- **Depend on the interface.** Features (e.g. reminders) inject `NotificationProvider`, never a concrete class. Swapping providers must not touch domain code.
- **Fake/log provider is the dev default.** No real WhatsApp messages are sent in development or automated tests. Provider selection is driven by environment/config, defaulting to the fake.
- **Provider errors are wrapped**, not leaked. Map external failures to PayPilot's error model and decide retry/fallback at the use-case layer; reminder sending must stay idempotent under retries (R2).
- **Credentials come from config/env**, validated at startup, never committed ([[security]]).
- **The interface models PayPilot's needs, not the vendor's API.** Avoid leaking provider-specific request/response shapes into the domain.

## Where it lives

`apps/api/src/integrations/<kind>/` — interface + implementations co-located. See [[structure]].

---

_Add new providers by implementing an existing interface; the pattern shouldn't need re-documenting._
