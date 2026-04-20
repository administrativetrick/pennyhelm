# Changelog

All notable changes to PennyHelm will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] — 2026-04-20

### Added
- **Reddit ad landing page at `/switch`.** Dedicated single-page conversion target for paid-ad traffic — strikethrough price comparison vs Monarch / YNAB / Copilot / Rocket Money, three feature highlights, side-by-side comparison table, founder quote, final CTA. `noindex, nofollow` so it doesn't cannibalize organic SEO. No self-host / nav / footer clutter — one goal, two CTAs, both pointing at `/login`.
- **Ad attribution funnel in the admin panel.** New Cloud Functions `logAdEvent` (HTTP, rate-limited, unauth) and `getAdAttributionStats` (admin callable). The `/switch` page fires `landing_view` on load and `cta_click` on CTA press via `navigator.sendBeacon`; CTA hrefs auto-forward the UTM query string to `/login` so `acquisition.js` can capture it for signup attribution. Admin panel shows a 7/30/90-day funnel broken down three ways — by `utm_source`, `utm_campaign`, and `utm_content` — with unique visitors, views, clicks, CTR, signups, conversion rate, and abandoned-click count. Events land in a new `adEvents/` Firestore collection with 90-day TTL (wire a TTL policy on `adEvents.expiresAt` in Firebase Console). Signups are derived from the existing `users.acquisitionSource` field so there's no double-counting.
- **Active Users (DAU / MAU) panel in admin.** New Cloud Function `getActiveUserStats` (admin callable) plus client-side `js/active-ping.js` that marks the current user active at most once per UTC day. Admin card shows DAU (today), WAU (7-day), MAU (rolling 30-day), stickiness (DAU ÷ MAU), and an inline DAU sparkline across the selected 7/30/90-day window. Activity markers live in a new protected `userActivity/` Firestore collection with one doc per `(user, UTC day)` — no page, action, or financial detail recorded, just `{uid, date, timestamps, expiresAt}`. 90-day TTL cleanup (wire a TTL policy on `userActivity.expiresAt` in Firebase Console).

### Changed
- **Cache-Control headers on Firebase Hosting.** HTML/JS/MJS/CSS now serve with `public, max-age=0, must-revalidate` so browsers always revalidate against the origin and pick up fresh deploys immediately (304 when unchanged — no payload penalty). Images get 24 h, fonts get 1 y immutable. Prevents the "sidebar renders but page body is blank" stale-cache regression seen after recent deploys where the browser held an old `js/mode/cloud.js` for up to an hour.
- **Privacy policy updated for marketing attribution and usage activity.** §1.6 no longer claims "no cookies for tracking" (the /switch landing page now stores an anonymous visitor ID in localStorage) or "no third-party analytics services" wording that read ambiguously. New §1.7 discloses the /switch attribution pipeline (anonymous visitor ID, UTMs, referrer, landing path, rate-limit IP, 90-day retention, admin-only access). New §1.8 discloses the DAU/MAU activity marker (one doc per user per UTC day; uid + date + timestamps only; no financial data; 90-day retention). Effective date bumped to April 20, 2026. Landing-page trust line narrowed from "never sells, harvests, or shares your data" to "never sells or shares your financial data" — scoped and accurate.
- **Tier 1 UI density pass.** Tightened vertical rhythm across the app shell — tab bars, drawer, widget carousel, and Settings page — so more information lives above the fold without crowding. Tabs shrank from 12/20 to 8/14 padding with lighter font weight; drawer inner padding reduced; Settings switched from stacked rows to a responsive `auto-fit, minmax(280px, 1fr)` grid and the header toggles (theme, gift icon, etc.) became icon-only with tooltips instead of text-labeled buttons.
- **Dashboard widget carousel: pagination dots replace scrollbar.** The horizontal scrollbar under the dashboard widget strip was replaced with iOS-style pagination dots (active dot elongates into a pill). Click any dot to snap to that widget; native scroll still works and the active dot tracks as the user drags. Scrollbars themselves are hidden across Chrome/Firefox/Edge via `scrollbar-width: none` and `::-webkit-scrollbar { display: none }`.
- **Stat cards made responsive.** The Debts / Income / Taxes / Assets pages were stacking stat cards full-width on every viewport because `.stats-grid` had no CSS rule. Added `grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))` so cards flow two-up or three-up on desktop, stack on mobile. Also added `.stat-label` and `.stat-value` rules so the typography is consistent instead of each page re-styling its own.
- **Style centralization sweep.** Audited ~1,500 inline `style="..."` attributes across the page modules and migrated ~80 exact-match cases to shared utility classes (`.flex-align-center`, `.flex-between`, `.gap-4`, `.gap-8`, `.mb-8`, `.mb-16`, `.text-muted`, `.text-sm`, etc.) in `css/styles.css`. No visual behavior change — just fewer places where a color or spacing decision lives. Dynamic inline styles (template-literal interpolations, computed widths/colors) were left alone; variant-ordered and risky cases were flagged for a future sweep.
- **New `.icon-label` utility.** The recurring "SVG icon + text label" pattern (`<span class="flex-align-center gap-8"><svg/>Label</span>`) is now a single `inline-flex` class. 20 call sites across `calendar.js`, `bills.js`, `income.js`, `accounts.js`, `dashboard.js`, and `settings.js` migrated over. Child SVGs get `flex-shrink: 0` so icons don't compress when labels wrap.

### Security
- **Rate limiting on auth, MFA, and invite Cloud Functions.** Added a Firestore-backed rate limiter (`functions/rate-limit.js`) that buckets calls per-UID (or per-IP for unauth flows) into fixed windows and rejects with `resource-exhausted` once the cap is hit. Applied to `setupMobileCredentials` / `resendMobilePassword` / `deleteAccount` (auth), `setupMFA` / `verifyMFASetup` / `verifyMFALogin` (MFA), and `sendInvite` / `acceptInvite` / `declineInvite` (sharing). Admins (`request.auth.token.admin === true`) are exempt so support flows aren't throttled. Counter docs self-expire via a Firestore TTL policy on the `rateLimits` collection (`expiresAt` field).
- **Firebase App Check wired throughout the web client.** The reCAPTCHA v3 compat SDK is loaded alongside the other Firebase bundles and `firebase.appCheck().activate(siteKey)` runs immediately after `initializeApp` on every entry point (app shell, `login.html`, `accept-invite.html`, `delete-account.html`, `oauth.html`). Ships inert until a site key is registered in Firebase Console → App Check → Apps → Web and written to `APP_CHECK_SITE_KEY` in `js/firebase-config.js`. Once enabled, App Check tokens are attached automatically to all subsequent Firestore, Functions, and Auth requests, blocking bots that impersonate the public Web `apiKey` outside a real browser session. Localhost gets auto-enabled debug tokens for dev.

## [0.2.0] — 2026-04-19

### Added
- `/health` endpoint on the self-host server returning JSON `{status, mode, uptime}`. Returns 503 if SQLite is unreachable.
- Docker `HEALTHCHECK` directive so `docker compose ps` reports accurate container health (30s interval, 5s timeout, 10s start period).
- Unit test suite for `financial-service` and `recurring-service` — 117 tests covering net-worth math, monthly-income conversion, pay-date generation, bill expansion, financial-health score, Savings Cushion + Liquid Reserves (cash + taxable investments), configurable risk-tolerance haircut, Plaid bill-matching, merchant normalization, and recurring-transaction detection. Runs with `npm test` (Node built-in test runner, no new dependencies).
- GitHub Actions CI workflow (`.github/workflows/test.yml`) runs `npm test` on every push and pull request to `master` (Node 22 LTS).
- Dashboard Financial Health Score now lists "Add these to improve your score accuracy" when required inputs are missing — surfaces missing components (Credit Score, Payment History, etc.) with actionable tips, plus a "Partial" or "Not enough data" badge next to the grade.
- **Risk tolerance picker** in Settings → Financial Health Score. Users choose Conservative (50%), Balanced (75%, default), or Aggressive (100%) to set how much of their taxable brokerage balance counts toward Savings Cushion and Liquid Reserves. Retirement accounts remain excluded regardless of tier.
- Quick-edit buttons on the Income page summary cards. Each card (`James's Pay`, `Partner's Pay`, `Other Income`) now has a small Edit/Manage button in the top-right that opens the existing edit modal or scrolls to the relevant section — saves a trip to Settings for routine pay changes.
- **Mortgage-aware DTI** in Financial Health Score. The DTI component now computes lender-standard front-end (housing / income, target ≤28%) and back-end (all debt / income, target ≤36%, FHA ceiling 43%) ratios and takes the worse of the two. A user with a $500K mortgage but otherwise low debt no longer gets the same score as someone buried in credit-card payments. The component tip now shows both ratios (`Housing 24% / total 25% of income`) so users can see exactly what's being scored. When debts are recorded but no minimum payments are set, DTI is flagged as missing data instead of silently scoring zero.

### Changed
- Sidebar nav icons refreshed to the v2 custom icon set (`assets/icons/pennyhelm-v2/`). Rounded line style with disciplined negative space, 1.8px stroke, `currentColor` for theming.
- Financial Health Score now uses **conditional weighting**: components without input data (e.g., no credit score entered, no bills yet) are excluded rather than defaulting to 50. Remaining component weights renormalize so the visible score reflects only what the user has told us. Fixes the "fake 50%" problem where brand-new empty accounts showed up as mediocre-health by default.
- Bill payment history now falls back to Plaid transaction evidence — if a bill wasn't manually ticked as paid but a Plaid-synced expense exists within ±3 days and ±5% (or ±$1 floor) of the bill amount, the bill is inferred as paid. Stops penalizing users who autopay but forget to tick the checkbox.
- Health-Score emergency-fund component renamed **Cash Reserves → Liquid Reserves** and now counts taxable brokerage balances at 75% (reflecting market risk, capital-gains tax, and 1–3 day settlement). Retirement accounts are still excluded — the early-withdrawal penalty makes them unsuitable as emergency liquidity. Users who keep their emergency reserves invested in a taxable brokerage no longer show $0 reserves.
- **Savings Cushion** component now applies the same rule — taxable brokerage counts at 75% toward "months of expenses covered." Previously a user with $27K in a brokerage account and no dedicated savings saw a score of 0 on the biggest health-score component (25% weight). Retirement accounts remain excluded for the same penalty-risk reason.
- "Dependent" labels in the UI renamed to **Partner** — a spouse/partner understandably took offense to being categorized as a dependent. Affected copy: Settings ("Partner" section header, "Enable partner tracking" toggle, "Partner's name" modal), Bills page category ("Partner Coverage" replaces "Dependent Coverage" in the waterfall breakdown), onboarding tour, chatbot prompt defaults, and the README feature bullet. Internal data model keys (`dependent`, `dependentBills`, `dependentName`) are unchanged so existing user data continues to work untouched.

### Fixed
- Dashboard household-income totals and the Income / Cashflow PDF exports now honor the partner's pay frequency when computing their monthly equivalent. Previously the partner's `payAmount` was always treated as already-monthly — partners paid weekly or biweekly had their contribution under-counted in total household income and downstream reports. Surfaced while consolidating the four hand-rolled copies of monthly-income math onto the shared `calculateMonthlyIncome()` helper.
- Admin panel "Create Test User" button did nothing — the click handler was accidentally deleted in the waitlist-removal sweep (commit `b658b88`). Restored handler so the modal opens and the `createTestUser` Cloud Function is invoked again.
- Financial Health Score grade badges (⚠️ at "Needs Work" and 🚨 at "Critical") in the card header read as calculation errors. Removed the header emoji — the colored score ring + grade label already communicate state without looking like a system alert. Replaced the alarming emojis on the grade object itself with neutral finance-flavored icons (📊 📉 🔻).
- Risk tolerance picker cards in Settings were not clickable — the hidden-radio-inside-`<label>` pattern wasn't wired up. Refactored to plain `<button>` elements with `data-risk-option` attributes and a delegated click handler (same pattern as the theme toggle). Selecting Conservative / Balanced / Aggressive now persists and re-renders the card.
- **DTI double-counted linked debt bills.** PennyHelm's entity-linker attaches `linkedDebtId` to bills that mirror a debt (e.g., "Walter Alley Mortgage Payment" bill paired with the "Walter Alley Mortgage" debt). The new mortgage-aware DTI was summing both the debt's `minimumPayment` AND the linked bill, doubling every housing/credit-card payment. Real-world example: user with $14,401/mo income and a $3,486.50 mortgage saw "Housing 48% / total 86%" → DTI score 0 when the honest ratios were 24% / 44% → DTI ~56. Fixed by skipping `linkedDebtId` bills in the housing/non-housing rollup — the debt's minimumPayment is the single source of truth. Unlinked bills (e.g., a standalone auto-loan bill with no debt record) still count normally.
- **Category budgets silently ignored half your spending.** The budget matcher compared categories with strict `===`, so a budget on `"mortgage"` never saw a bill or Plaid-sourced expense tagged `"Mortgage"`, and a `"groceries"` budget missed every `"Groceries"` transaction. Three overlapping bugs made this worse: (1) the rules UI was a plain text input that saved the display label the user typed, (2) Plaid-imported transactions landed with Plaid's capitalized label, and (3) the bill form's `expenseCategory` write path didn't coerce. Real-world example: a user with a $3,486/mo mortgage bill and a $3,475/mo Mortgage budget saw Spent: $0 / Remaining: $3,475 and assumed the feature was broken. Fix has three layers: (a) `computeBudgetStatus` and `store._billSpendForMonth` now compare case-insensitively (runtime safety net); (b) a new `normalizeCategoryKey()` helper coerces every `addBill` / `updateBill` / `addExpense` / `updateExpense` / `addRule` / `updateRule` / `addBudget` / `updateBudget` / `importPlaidTransactions` input to its canonical `EXPENSE_CATEGORIES` key; (c) a one-time `migrateCategoryKeys` migration rewrites legacy stored values on first load. Unknown or custom categories pass through untouched so bespoke user taxonomies aren't clobbered. Duplicate budgets created across casings (e.g. one on `"Mortgage"` and another on `"mortgage"`) collapse to the most recently added row.

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

[Unreleased]: https://github.com/administrativetrick/pennyhelm/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/administrativetrick/pennyhelm/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/administrativetrick/pennyhelm/releases/tag/v0.1.0
