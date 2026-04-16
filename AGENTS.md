# PennyHelm

Personal finance tracker with two deployment modes (self-host with SQLite, cloud with Firebase) and a companion React Native mobile app.

## Repository Layout

| Path | What it is |
|------|-----------|
| `D:\Codex\Codex\PennyHelm` | Web app (this repo) |
| `D:\Codex\Codex\PennyHelm-Mobile` | React Native / Expo mobile app |
| `D:\Codex\Codex\PennyHelm_Company_Documents` | Company policies, marketing docs |

## Architecture

### Web App (this repo)

- **Frontend**: Vanilla HTML/CSS/JS with ES modules (`import`/`export`). No build step, no framework.
- **Entry point**: `app.html` loads `js/app.js` as `type="module"`
- **Backend (self-host)**: Express.js + better-sqlite3 (`server.js`, port 8081)
- **Backend (cloud)**: Firebase Hosting + Cloud Functions v2 (Node 20)
- **Database**: Firestore (cloud) / SQLite with WAL mode (self-host) / localStorage fallback
- **Auth**: Firebase Auth (cloud) with email/password, Google OAuth, TOTP MFA
- **Mode switch**: `js/mode-config.js` sets `APP_MODE = 'cloud'` or `'selfhost'`
- **Firebase project**: `cashpilot-c58d5`

### Mobile App (`PennyHelm-Mobile/`)

- **Framework**: React Native 0.81 + Expo 54 (New Architecture enabled)
- **Language**: JavaScript (no TypeScript)
- **Navigation**: React Navigation v7 (stack + bottom tabs)
- **State**: React Context API (`AuthContext`, `ThemeContext`)
- **Backend**: Same Firebase project (`cashpilot-c58d5`), shared Firestore collections
- **Build**: EAS Build, Android package `com.pennyhelm.mobile`, current version 0.5.0
- **No shared code** with web app — Firestore is the sync bridge

## Key Patterns

### Routing (Web)
Hash-based SPA routing in `js/app.js`. Pages map defined as `{ dashboard: renderDashboard, bills: renderBills, ... }`. Sub-tabs supported (e.g., `#income/documents`).

### State Management (Web)
Singleton `Store` class in `js/store.js` holds all app state in `this._data`. Observer pattern via `store.onChange(fn)`. Debounced saves (100ms). `StorageAdapter` abstracts Firestore vs SQLite vs localStorage.

### Service Layer (Web)
Services extracted to `js/services/`:
- `financial-service.js` — Pure calculation functions (net worth, monthly income, pay dates)
- `storage-adapter.js` — Backend abstraction (Firestore / Express+SQLite / localStorage)
- `migration-service.js` — Data migration between versions
- `entity-linker.js` — Bidirectional sync between Accounts, Debts, and Bills
- `recurring-service.js` — Recurring bill/transaction logic
- `modal-manager.js` — Centralized modal open/close

### Cloud Functions (`functions/`)
Factory pattern — each domain module exports a function receiving `shared` dependencies (admin SDK, secrets). Entry point `functions/index.js` wires and re-exports all ~38 functions.

| Module | Domain |
|--------|--------|
| `auth.js` | Registration, password management, mobile credentials |
| `plaid.js` | Link tokens, token exchange, transaction sync, balance refresh |
| `stripe.js` | Checkout, customer management, portal, webhooks |
| `mfa.js` | TOTP 2FA setup and verification |
| `invites.js` | Sharing invites, acceptance, waitlist |
| `scheduled.js` | Cron jobs, admin utilities |
| `chatbot.js` | AI financial assistant (Gemini API) |
| `api-keys.js` | API key generation, listing, revocation |
| `api.js` | Public REST API (authenticated via API keys) |

### Navigation (Mobile)
Stack navigator gates auth state: LoginScreen → (ChangePassword | MFAVerification | Subscription | Onboarding) → MainTabs. Bottom tabs: Dashboard, Bills, Calendar, Income, Debts, Settings. ChatScreen presented as modal.

### Data Flow (Mobile)
Screens call `fetchUserData(uid)` → Firestore doc → parse JSON → provide defaults. Saves via `saveUserData(uid, data)` preserving `sharedWith` arrays for security rules.

## Data Model

Core data stored as JSON in Firestore `userData/{uid}` (cloud) or SQLite `data/finances.db` (self-host):

- `income` — Pay amount, frequency, next pay dates (user + dependent)
- `bills[]` — id, name, amount, dueDate, category, paymentSource, paid, frequency, owner
- `accounts[]` — id, name, type, balance, amountOwed
- `debts[]` — id, name, type, currentBalance, originalBalance, interestRate, minimumPayment
- `expenses[]` — id, name, amount, category, date, vendor, source ('manual'|'plaid')
- `taxDeductions[]` — id, taxYear, category, description, amount, vendor
- `savingsGoals[]` — id, name, targetAmount, currentAmount, targetDate, linkedAccountId
- `balanceHistory[]` — date, checking, savings, investment, netWorth snapshots

## Firestore Collections

| Collection | Purpose |
|-----------|---------|
| `users/` | Profiles, subscription status, trial tracking |
| `userData/` | Finance data (JSON string), shared access via `sharedWithUids` |
| `invites/` | Pending sharing invites |
| `apiKeys/` | Hashed API keys |
| `plaidItems/` | Plaid access tokens (write-protected) |
| `telemetry/` | Troubleshooting logs (auto-deleted after 30 days) |
| `registrationCodes/` | Account creation control |
| `waitlist/` | Waitlist entries |

## File Map (Web)

```
app.html                    # SPA shell
server.js                   # Express + SQLite (self-host mode)
js/
  app.js                    # Router, init, page rendering
  store.js                  # Singleton state manager (~750 lines)
  mode-config.js            # APP_MODE toggle
  firebase-config.js        # Firebase project credentials
  chatbot.js                # AI assistant UI
  pages/
    dashboard.js            # Financial overview
    bills.js                # Bill management
    calendar.js             # Calendar view
    cashflow.js             # Cashflow analysis
    accounts.js             # Account tracking
    debts.js                # Debt management
    income.js               # Income + tax deductions
    settings.js             # User settings + import/export
    admin.js                # Admin panel (cloud only)
    savings.js              # Savings goals
    sharing.js              # Partner/CPA sharing
  services/
    financial-service.js    # Pure financial calculations
    storage-adapter.js      # Backend abstraction
    migration-service.js    # Data version migrations
    entity-linker.js        # Account/Debt/Bill linking
    recurring-service.js    # Recurring transaction logic
    modal-manager.js        # Modal UI management
functions/
  index.js                  # Cloud Functions entry point
  auth.js, plaid.js, stripe.js, mfa.js, invites.js,
  scheduled.js, chatbot.js, api-keys.js, api.js
css/
  styles.css                # Main styles
  landing.css               # Landing page styles
firebase.json               # Hosting + Functions config
firestore.rules             # Security rules
firestore.indexes.json      # Composite indexes
```

## Company Documents (`PennyHelm_Company_Documents/`)

- `Company_Policies/` — Access Control Policy, Information Security Policy, Data Retention Policy, Privacy Policy
- `marketing/` — Behavioral science framework, channel strategy, copywriter toolkit
- Policy owner: James Curtis. Security policies approved Feb 2026.

## Development

### Web (self-host mode)
```bash
npm install
npm start          # Express server on http://localhost:8081
```

### Web (cloud deploy)
```bash
firebase deploy    # Deploys hosting + functions
```

### Mobile
```bash
cd D:\Codex\Codex\PennyHelm-Mobile
npm install
npx expo start     # Dev server with Expo Go
eas build          # Production build via EAS
```

## Important Notes

- Cloud Functions use CommonJS (`require`/`module.exports`). Frontend uses ES modules.
- Secrets managed via `firebase-functions/params` — never hardcode or expose to client.
- Firestore security rules enforce user isolation; `sharedWithUids` and `sharedWithEdit` arrays control cross-user access.
- The web app has no build step — edit JS/CSS/HTML and reload.
- License: Business Source License 1.1 — free for personal/self-host, commercial hosting requires a license.
