# Changelog

All notable changes to PennyHelm will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `/health` endpoint on the self-host server returning JSON `{status, mode, uptime}`. Returns 503 if SQLite is unreachable.
- Docker `HEALTHCHECK` directive so `docker compose ps` reports accurate container health (30s interval, 5s timeout, 10s start period).
- Unit test suite for `financial-service` and `recurring-service` — 117 tests covering net-worth math, monthly-income conversion, pay-date generation, bill expansion, financial-health score, Savings Cushion + Liquid Reserves (cash + taxable investments), configurable risk-tolerance haircut, Plaid bill-matching, merchant normalization, and recurring-transaction detection. Runs with `npm test` (Node built-in test runner, no new dependencies).
- GitHub Actions CI workflow (`.github/workflows/test.yml`) runs `npm test` on every push and pull request to `master` (Node 22 LTS).
- Dashboard Financial Health Score now lists "Add these to improve your score accuracy" when required inputs are missing — surfaces missing components (Credit Score, Payment History, etc.) with actionable tips, plus a "Partial" or "Not enough data" badge next to the grade.
- **Risk tolerance picker** in Settings → Financial Health Score. Users choose Conservative (50%), Balanced (75%, default), or Aggressive (100%) to set how much of their taxable brokerage balance counts toward Savings Cushion and Liquid Reserves. Retirement accounts remain excluded regardless of tier.
- **Mortgage-aware DTI** in Financial Health Score. The DTI component now computes lender-standard front-end (housing / income, target ≤28%) and back-end (all debt / income, target ≤36%, FHA ceiling 43%) ratios and takes the worse of the two. A user with a $500K mortgage but otherwise low debt no longer gets the same score as someone buried in credit-card payments. The component tip now shows both ratios (`Housing 24% / total 25% of income`) so users can see exactly what's being scored. When debts are recorded but no minimum payments are set, DTI is flagged as missing data instead of silently scoring zero.

### Changed
- Sidebar nav icons refreshed to the v2 custom icon set (`assets/icons/pennyhelm-v2/`). Rounded line style with disciplined negative space, 1.8px stroke, `currentColor` for theming.
- Financial Health Score now uses **conditional weighting**: components without input data (e.g., no credit score entered, no bills yet) are excluded rather than defaulting to 50. Remaining component weights renormalize so the visible score reflects only what the user has told us. Fixes the "fake 50%" problem where brand-new empty accounts showed up as mediocre-health by default.
- Bill payment history now falls back to Plaid transaction evidence — if a bill wasn't manually ticked as paid but a Plaid-synced expense exists within ±3 days and ±5% (or ±$1 floor) of the bill amount, the bill is inferred as paid. Stops penalizing users who autopay but forget to tick the checkbox.
- Health-Score emergency-fund component renamed **Cash Reserves → Liquid Reserves** and now counts taxable brokerage balances at 75% (reflecting market risk, capital-gains tax, and 1–3 day settlement). Retirement accounts are still excluded — the early-withdrawal penalty makes them unsuitable as emergency liquidity. Users who keep their emergency reserves invested in a taxable brokerage no longer show $0 reserves.
- **Savings Cushion** component now applies the same rule — taxable brokerage counts at 75% toward "months of expenses covered." Previously a user with $27K in a brokerage account and no dedicated savings saw a score of 0 on the biggest health-score component (25% weight). Retirement accounts remain excluded for the same penalty-risk reason.
- "Dependent" labels in the UI renamed to **Partner** — a spouse/partner understandably took offense to being categorized as a dependent. Affected copy: Settings ("Partner" section header, "Enable partner tracking" toggle, "Partner's name" modal), Bills page category ("Partner Coverage" replaces "Dependent Coverage" in the waterfall breakdown), onboarding tour, chatbot prompt defaults, and the README feature bullet. Internal data model keys (`dependent`, `dependentBills`, `dependentName`) are unchanged so existing user data continues to work untouched.

### Fixed
- Admin panel "Create Test User" button did nothing — the click handler was accidentally deleted in the waitlist-removal sweep (commit `b658b88`). Restored handler so the modal opens and the `createTestUser` Cloud Function is invoked again.
- Financial Health Score grade badges (⚠️ at "Needs Work" and 🚨 at "Critical") in the card header read as calculation errors. Removed the header emoji — the colored score ring + grade label already communicate state without looking like a system alert. Replaced the alarming emojis on the grade object itself with neutral finance-flavored icons (📊 📉 🔻).
- Risk tolerance picker cards in Settings were not clickable — the hidden-radio-inside-`<label>` pattern wasn't wired up. Refactored to plain `<button>` elements with `data-risk-option` attributes and a delegated click handler (same pattern as the theme toggle). Selecting Conservative / Balanced / Aggressive now persists and re-renders the card.

## [0.1.0] — 2026-04-17

First public release. Tagged as the baseline for future versioning.

### Added

#### Deployment modes
- Self-host mode: Express + better-sqlite3 (WAL) on port 8081, no outbound calls by default.
- Cloud mode: Firebase Hosting + Cloud Functions v2 + Firestore on project `cashpilot-c58d5`.
- Dockerfile (multi-stage, non-root user) and `docker-compose.yml` with named volume for data.
- `npm run deploy:cloud` wrapper that flips `APP_MODE` to `'cloud'`, runs `firebase deploy`, and restores `'selfhost'` in a `try/finally`. Predeploy hook (`scripts/verify-cloud-mode.js`) blocks bare `firebase deploy` from shipping a selfhost build to production.

#### Core finance features
- Accounts with balance tracking and net-worth history.
- Bills with recurring schedules, categories, owner assignment, and paid/unpaid status.
- Debts with interest rate, minimum payment, and payoff projections.
- Expenses (manual + Plaid-sourced) with tag support and line-item splits.
- Savings goals with linked-account auto-progress on a dedicated page.
- Income tracking with user + dependent pay schedules.
- Tax deductions by category and tax year.
- 156-category expense taxonomy across 18 groups, plus user-defined custom categories.
- Searchable type-ahead category picker with "Common" section on focus.

#### Budgeting & analytics
- Category budgets with month-to-month rollover.
- Bill-to-budget linking so scheduled bills count toward category spending.
- Variance report and dashboard card comparing actual vs. budgeted spend.
- Transaction rules engine — match conditions (contains / equals / regex / numeric) with category, tag, rename, or ignore actions.
- Interactive Cashflow Sankey and Cashflow report with historical Plaid transaction sync.

#### Integrations
- Plaid bank sync in both modes. Cloud mode uses shared keys; self-host mode supports BYO `PLAID_CLIENT_ID` / `PLAID_SECRET` via environment variables.
- Stripe subscriptions: $7.99/mo monthly, $6.49/mo annual ($77.88/yr), 30-day trial without a card.
- Stripe webhook for subscription lifecycle + referral reward tracking.
- Gemini-powered AI financial assistant (chatbot).
- Public REST API authenticated via hashed API keys.

#### Auth & sharing
- Firebase Auth with email/password and Google OAuth.
- TOTP MFA with authenticator app + 8-character recovery codes.
- Partner / CPA sharing with per-user edit permissions (`sharedWithUids` / `sharedWithEdit`).
- Server-side Firestore security rules enforcing user isolation and shared-access checks.
- Referral code system — 10 paid referrals grants the referrer one free year.
- Open signup (removed prior waitlist + registration-code gate).
- UTM / `gclid` / `fbclid` / referrer capture at signup, stored as `acquisitionSource` on `users/{uid}`, viewable in admin panel.

#### Mobile
- React Native 0.81 + Expo 54 companion app (separate repo `PennyHelm-Mobile`, Android package `com.pennyhelm.mobile`, version 0.5.0).
- Shares the same Firestore backend; syncs via JSON data blob.

#### Site & marketing
- Marketing landing page with rotating hero showcase (dashboard / bills / calendar / cashflow).
- Responsive gallery (featured Sankey + screenshot grid) with click-to-enlarge lightbox.
- Pricing page with grandfathered rate messaging.
- Privacy policy + account-deletion self-serve flow.

### Licensing
- Licensed under **GNU AGPLv3**.
- Contributor License Agreement required for external PRs (`CLA.md` + CLA Assistant).

[Unreleased]: https://github.com/administrativetrick/pennyhelm/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/administrativetrick/pennyhelm/releases/tag/v0.1.0
