# PennyHelm

A personal finance tracker built with vanilla HTML, CSS, and JavaScript. Self-host for total privacy or use PennyHelm Cloud for seamless access anywhere.

## Features

- **Dashboard** — Monthly income, bills, remaining balance, net worth, credit scores, and pay period breakdowns
- **Bills** — Track recurring bills with due dates, categories, payment sources, and paid/unpaid status
- **Calendar** — Visual month view of bill due dates and paydays
- **Cashflow** — Waterfall charts, 6-month projections, income vs expenses breakdown
- **Dependent Tracking** — Manage a dependent's bills separately and track which ones you're covering
- **Accounts** — Monitor checking, savings, credit cards, investments, retirement, and property accounts
- **Debts** — Track loans and credit card debt with avalanche/snowball payoff strategy comparison
- **Taxes** — Log tax deductions by category and year with receipt document storage
- **Income** — Track primary pay schedule plus side income sources
- **Settings** — Configure names, pay schedule, credit scores, and import/export data as JSON

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

**If you're self-hosting, set `APP_MODE = 'selfhost'`.** The repository ships with `'cloud'` as the default because the hosted build runs off the same source tree — change this line before running `npm start` or the app will try to initialize Firebase and redirect to a login page.

#### What works in self-host mode

Everything in the app works against your local SQLite database **except** bank sync (Plaid), which requires Firebase Cloud Functions to keep API secrets off the client. Specifically:

- ✅ Dashboard, Bills, Calendar, Accounts (manual), Debts, Income, Cashflow (including the interactive Sankey), Reports, PDF/CSV exports, Settings, onboarding, theme, data import/export
- ❌ **Plaid bank connection** — the "Connect Bank" button is hidden in self-host mode. Add accounts manually instead
- ❌ Cloud-only features hidden in self-host: subscriptions/Stripe, MFA setup, mobile app credentials, sharing/invites, Delete Account, registration codes, admin panel

The Cashflow Sankey and Cashflow Report fall back to your recurring bills when no imported transactions are available, so both features work fully in self-host with manually entered data.

#### What you do NOT need for self-host

You can ignore `firebase.json`, `firestore.rules`, `firestore.indexes.json`, the `functions/` directory, and `js/firebase-config.js` entirely — they're only consumed when `APP_MODE === 'cloud'`. No secrets are required; no `firebase-service-account.json` or `.env` file needs to exist.

## PennyHelm Cloud

PennyHelm Cloud is a hosted version with Firebase Auth and Firestore — sign up, log in, and access your finances from any device. Try it at [cashpilot-c58d5.web.app](https://cashpilot-c58d5.web.app).

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
├── server.js           # Express server + SQLite API
├── package.json
├── app.html            # SPA shell
├── index.html          # Landing page
├── login.html          # Firebase Auth login (cloud mode)
├── css/
│   ├── styles.css      # App styles
│   └── landing.css     # Landing + login page styles
├── js/
│   ├── app.js          # Router + initialization
│   ├── store.js        # Data layer (SQLite or Firestore)
│   ├── auth.js         # Auth manager (selfhost/cloud)
│   ├── seed.js         # Sample data for first-run
│   ├── utils.js        # Shared helpers
│   ├── mode-config.js  # selfhost or cloud mode flag
│   ├── firebase-config.js
│   ├── login.js        # Login page logic
│   └── pages/
│       ├── dashboard.js
│       ├── bills.js
│       ├── calendar.js
│       ├── dependent.js
│       ├── accounts.js
│       ├── debts.js
│       ├── cashflow.js
│       ├── income.js
│       ├── taxes.js
│       └── settings.js
├── firestore.rules     # Firestore security rules (cloud)
├── firebase.json       # Firebase Hosting config (cloud)
└── data/               # Created at runtime (git-ignored)
    └── finances.db
```

## License

This software is licensed under the [Business Source License 1.1](LICENSE). You are free to self-host and use it for personal, non-commercial purposes. Commercial use (including offering it as a hosted service) requires a separate license. See the [LICENSE](LICENSE) file for full terms.
