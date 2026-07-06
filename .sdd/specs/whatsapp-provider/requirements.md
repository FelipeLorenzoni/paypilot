# Requirements Document

## Project Description (Input)

whatsapp-provider: implement the real WhatsApp notification provider for PayPilot reminders.

Scope:

- Implement the real provider behind the existing NotificationProvider port.
- Choose and document the provider/API.
- Handle provider idempotency or delivery-confirmation strategy.
- Validate required environment variables.
- Ensure no secrets, phone numbers, or message bodies are logged.
- Add provider error mapping to PayPilot error codes.
- Keep tests using fake/mock provider only.
- Preserve due-date-reminders domain logic unchanged unless a documented provider requirement forces a minimal adapter change.

Out of scope:

- changing reminder target/domain rules
- adding new channels
- OTP phone verification
- read receipts/webhooks unless explicitly required by the selected provider
- message localization/i18n beyond current templates

Goal:
Replace the WhatsApp stub with a production-ready provider while preserving the NotificationProvider abstraction.

## Requirements

<!-- Will be generated in /sdd:spec-requirements phase -->
