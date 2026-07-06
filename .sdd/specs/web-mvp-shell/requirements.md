# Requirements Document

## Project Description (Input)

web-mvp-shell: build the initial authenticated web application shell for PayPilot.

Scope:

- Next.js web app foundation for the user-facing MVP.
- Login/register screens consuming the existing auth-jwt API.
- Authenticated layout with navigation/sidebar/header.
- Basic route protection on the client.
- API client layer for the existing backend.
- Error handling based on the backend canonical error envelope.
- Empty/loading/error states pattern.
- Shared UI conventions for forms, validation messages, money/date display, and request errors.
- Initial pages/routes for:
  - dashboard
  - manual expenses
  - recurring bills
  - credit cards/invoices
  - CSV imports
  - reminders/settings

Out of scope:

- complex charts
- advanced dashboard analytics
- editing every backend entity in full detail
- real payment settlement
- real WhatsApp integration
- mobile app
- full design system beyond a minimal reusable component pattern

The goal is to make the PayPilot app navigable and ready for feature-specific UI specs.

## Requirements

<!-- Will be generated in /sdd:spec-requirements phase -->
