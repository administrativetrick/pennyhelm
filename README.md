# PennyHelm

A personal finance tracker built with vanilla HTML, CSS, and JavaScript. Self-host for total privacy or use PennyHelm Cloud for seamless access anywhere.

## Features

- **Dashboard** — Monthly income, bills, remaining balance, net worth, credit scores, pay-period breakdowns, and a Financial Health Score with conditional weighting, mortgage-aware DTI, and a Liquid Reserves calculation that counts taxable brokerage balances at a user-configurable risk tier
- **Bills** — Track recurring bills with due dates, categories, payment sources, paid/unpaid status, and an interactive Sankey that can be driven by real Plaid-imported spend (falls back to recurring bills when none)
- **Calendar** — Visual month view of bill due dates and paydays
- **Budgets** — Category budgets with rollover, case-insensitive matching, and one-time migration of legacy category casings
- **Rules** — Auto-categorization rules for imported transactions (Plaid or manual imports)
- **Savings** — Goal-based savings tracking with target dates and progress
- **Accounts** — Checking, savings, credit cards, investments, retirement, and properties with net-worth rollups
- **Vehicles** — Dedicated vehicle tracker (loan balance, equity, depreciation)
- **Debts** — Track loans and credit cards with avalanche / snowball payoff strategy comparison
- **Taxes** — Log deductions by category and year with receipt document storage
- **Income** — Primary pay schedule, partner pay (with independent frequency), plus side income sources
- **Partner Tracking** — Manage a partner's bills separately and track which ones you're covering
- **Reports / Exports** — PDF and CSV exports for cashflow, income, bills, and more
- **Settings** — Names, pay schedule, credit scores, custom categories, risk tolerance, data import / export
- **Admin** *(cloud only)* — User management, ad-attribution funnel (UTM breakdowns, CTR, signups), DAU / WAU / MAU dashboard, and trial-code administration

## Self-Host (Quick Start)

```bash
# Clone the repository
git clone https://github.com/administrativetrick/pennyhelm.git
cd pennyhelm

# Install dependencies
npm install

# Start the server
npm start
```

Open [http://localhost:8081](http://localhost:8081) in your browser.

On first launch you'll be prompted to either **load sample data** or **start fresh** with an empty setup.

### App Mode (`APP_MODE`)

PennyHelm runs in one of two modes, toggled via a single flag in [`js/mode-config.js`](js/mode-config.js):

```js
export const APP_MODE = 'selfhost'; // or 'cloud'
```

| Value | Backend | Auth | Storage |
|---|---|---|---|
| `'selfhost'` | Express + SQLite | None (local) | `data/finances.db` |
| `'cloud'` | Firebase Hosting + Cloud Functions | Firebase Auth (Google, email/password, MFA) | Firestore |

**The repository ships with `'selfhost'` as the default** so `npm start` and the Docker image both work out of the box with no additional setup. For the Firebase Hosting deploy, use `npm run deploy:cloud` (see [Deploying to Firebase](#deploying-to-firebase)) — never bare `firebase deploy` from a source checkout, since a predeploy guard will reject it.

#### What works in self-host mode

Everything in the app works against your local SQLite database. Specifically:

- ✅ Dashboard, Bills, Calendar, Accounts, Debts, Income, Cashflow (including the interactive Sankey), Budgets with rollover, Transaction Rules, Tags, Splits, Variance Report, Reports, PDF/CSV exports, Settings, onboarding, theme, data import/export
- ✅ **Plaid bank connection — bring your own API keys.** Sign up at [plaid.com](https://plaid.com/), set `PLAID_CLIENT_ID` / `PLAID_SECRET` / `PLAID_ENV` via env vars or paste them into **Settings → Bank Connection (Plaid)**. The local Express server talks to Plaid directly — your access tokens never leave your machine. See the [Bank connections (Plaid, selfhost)](#bank-connections-plaid-selfhost) section below for details.
- ❌ Cloud-only features hidden in self-host: subscriptions/Stripe, MFA setup, mobile app credentials, sharing/invites, Delete Account, registration codes, admin panel

The Cashflow Sankey and Cashflow Report fall back to your recurring bills when no imported transactions are available, so both features work fully in self-host with manually entered data.

#### What you do NOT need for self-host

You can ignore `firebase.json`, `firestore.rules`, `firestore.indexes.json`, the `functions/` directory, and `js/firebase-config.js` entirely — they're only consumed when `APP_MODE === 'cloud'`. No secrets are required; no `firebase-service-account.json` or `.env` file needs to exist.

## PennyHelm Cloud

PennyHelm Cloud is a hosted version with Firebase Auth and Firestore — sign up, log in, and access your finances from any device. Try it at [https://pennyhelm.com](https://pennyhelm.com).

## Configuration

### Port

The server runs on port **8081** by default. To change it:

```bash
# Linux / macOS
PORT=3000 npm start

# Windows (Command Prompt)
set PORT=3000 && npm start

# Windows (PowerShell)
$env:PORT=3000; npm start
```

## How It Works

- The frontend is a single-page app using vanilla JavaScript with ES modules and hash-based routing — no frameworks or build step
- An Express server handles two things: serving the static files and providing a REST API (`GET /api/data`, `POST /api/data`)
- All data is stored in a single SQLite database file at `data/finances.db` using [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- The database is created automatically on first run — no setup required
- Writes are debounced (100ms) so rapid edits don't hammer the database

## Testing

A pure-Node test suite runs against the shared financial / recurring / category-normalization services (no browser, no Firebase). Runs on every push and PR via GitHub Actions (`.github/workflows/test.yml`, Node 22 LTS).

```bash
npm test
```

Covers net-worth math, monthly-income conversion across pay frequencies, pay-date generation, bill expansion, Financial Health Score (including the mortgage-aware DTI and the configurable risk-tolerance haircut on taxable brokerage balances), Savings Cushion + Liquid Reserves, Plaid bill-matching, merchant normalization, recurring-transaction detection, and case-insensitive category-budget matching. The suite uses only Node's built-in test runner — no new dependencies.

## Data & Backups

Your data lives in the `data/` directory (git-ignored by default). To back up your finances:

```bash
# Copy the database file
cp data/finances.db ~/backups/finances-backup.db
```

You can also use the **Settings** page to export your data as a JSON file, and import it later on any instance.

## Project Structure

```
pennyhelm/
├── server.js                    # Express server + SQLite API
├── package.json
├── app.html                     # SPA shell
├── index.html                   # Landing page
├── login.html                   # Firebase Auth login (cloud mode)
├── oauth.html                   # OAuth redirect handler (Plaid + Google)
├── accept-invite.html           # Shared-household invite acceptance (cloud)
├── delete-account.html          # Self-serve deletion flow (cloud)
├── privacy.html                 # Privacy policy
├── switch.html                  # Paid-ad landing page (cloud marketing)
├── css/
│   ├── styles.css               # App styles (utility classes + components)
│   └── landing.css              # Landing + login page styles
├── js/
│   ├── app.js                   # Router + initialization
│   ├── store.js                 # Data layer (SQLite or Firestore)
│   ├── auth.js                  # Auth manager (selfhost / cloud)
│   ├── seed.js                  # Sample data for first-run
│   ├── utils.js                 # Shared helpers
│   ├── mode-config.js           # selfhost or cloud mode flag
│   ├── firebase-config.js
│   ├── login.js                 # Login page logic
│   ├── active-ping.js           # DAU / MAU activity marker (cloud)
│   ├── services/                # Domain services split out of store.js
│   │   ├── modal-manager.js     # openModal / confirmModal / toast / subscribe
│   │   ├── financial-service.js
│   │   ├── recurring-service.js
│   │   └── …                    # entity-linker, budgets, etc.
│   ├── mode/                    # Selfhost / cloud mode adapters
│   └── pages/
│       ├── dashboard.js
│       ├── bills.js
│       ├── calendar.js
│       ├── budgets.js
│       ├── rules.js
│       ├── savings.js
│       ├── accounts.js
│       ├── assets.js
│       ├── vehicle-detail.js
│       ├── debts.js
│       ├── cashflow-sankey.js
│       ├── income.js
│       ├── taxes.js
│       ├── settings.js
│       ├── settings-plaid.js    # Plaid config card (selfhost only)
│       └── admin.js             # Admin panel (cloud only)
├── functions/                   # Cloud Functions v2 (cloud only)
│   ├── index.js                 # Factory entry point
│   ├── auth.js / mfa.js / invites.js
│   ├── plaid.js / stripe.js / chatbot.js
│   ├── api.js / api-keys.js
│   ├── ad-events.js             # /switch attribution funnel
│   ├── active-users.js          # DAU / MAU rollups
│   ├── rate-limit.js            # Firestore-backed rate limiter
│   └── scheduled.js             # Cron jobs
├── scripts/
│   ├── deploy-cloud.js          # APP_MODE-flipping deploy wrapper
│   └── verify-cloud-mode.js     # Firebase predeploy guard
├── tests/                       # Node test runner — `npm test`
│   ├── financial-service.test.js
│   ├── recurring-service.test.js
│   └── category-normalization.test.js
├── firestore.rules              # Firestore security rules (cloud)
├── firestore.indexes.json
├── firebase.json                # Firebase Hosting config (cloud)
└── data/                        # Created at runtime (git-ignored)
    └── finances.db
```

## Docker

A `Dockerfile` and `docker-compose.yml` ship in the repo for a fully self-hosted container build. The image runs the Express + SQLite backend and never contacts Firebase or any external service.

### Docker Compose (recommended)

```bash
docker compose up -d
```

Open [http://localhost:8081](http://localhost:8081). The database lives in the named `pennyhelm-data` volume.

### Plain Docker

```bash
docker build -t pennyhelm .
docker run -d \
    -p 8081:8081 \
    -v pennyhelm-data:/app/data \
    --name pennyhelm \
    pennyhelm
```

To back up the database:

```bash
docker run --rm -v pennyhelm-data:/data -v "$PWD":/backup alpine \
    tar czf /backup/pennyhelm-backup.tgz -C /data .
```

To upgrade: pull the latest repo, `docker build -t pennyhelm .` again, then `docker rm -f pennyhelm` and re-run. Your data stays in the volume.

## Bank connections (Plaid, selfhost)

Self-hosted users bring their own Plaid API credentials. Sign up at [plaid.com](https://plaid.com/) and grab your `client_id` and `secret` from the [Plaid dashboard](https://dashboard.plaid.com/developers/keys).

There are two ways to configure them:

**1. Environment variables** (recommended for Docker):

```bash
docker run -d \
    -p 8081:8081 \
    -v pennyhelm-data:/app/data \
    -e PLAID_CLIENT_ID=your_client_id \
    -e PLAID_SECRET=your_secret \
    -e PLAID_ENV=sandbox \
    --name pennyhelm \
    pennyhelm
```

`PLAID_ENV` must be explicitly set to one of `sandbox`, `development`, or `production`.

**2. In-app settings UI**: start the server without env vars, open **Settings → Bank Connection (Plaid)**, and paste your credentials. They're stored in your local SQLite database.

Environment variables take precedence over in-app settings, so Docker users with `PLAID_*` set see a read-only config panel in the UI. Credentials never leave your machine — the Express server talks to Plaid directly; nothing is sent to Firebase or any other third party.

The Plaid "Connect Bank" and "Refresh Balances" buttons stay hidden until Plaid is configured.

## Deploying to Firebase

The hosted build at `cashpilot-c58d5.web.app` must always run in cloud mode — deploying selfhost would break every existing user. To make this impossible to get wrong:

```bash
npm run deploy:cloud
```

That script:

1. Flips `js/mode-config.js` to `APP_MODE = 'cloud'` for the duration of the upload.
2. Runs `firebase deploy` (any extra CLI args are forwarded — e.g. `npm run deploy:cloud -- --only hosting`).
3. Restores the `'selfhost'` default on success **or** failure via a `try/finally`.

A Firebase predeploy guard (`scripts/verify-cloud-mode.js`, wired in `firebase.json`) double-checks the mode at upload time. A bare `firebase deploy` from a fresh selfhost checkout is refused with a clear error, so the cloud site can't accidentally ship selfhost.

## License

PennyHelm is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPLv3).

You're free to run, study, modify, and redistribute PennyHelm — including self-hosting it for yourself, your family, or inside your organization. The key obligation: **if you host a modified version as a network service for others, you must publish your modifications under AGPLv3 too.** That's the "A" in AGPL. Unmodified self-hosting has no publishing obligation.

The hosted build at `cashpilot-c58d5.web.app` is operated by the PennyHelm copyright holder under a separate commercial arrangement — dual licensing is permitted for the copyright holder. See the [LICENSE](LICENSE) file for full terms.
