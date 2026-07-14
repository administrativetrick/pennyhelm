# Changelog

All notable changes to PennyHelm will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Credit-card payments and account transfers no longer count as spending.** Paying a card's balance or moving money to your own brokerage/savings shows up in bank feeds as a transaction, so budgets, the Cashflow Sankey, the dashboard cashflow, and the expense summaries were counting the same dollars twice (once as the card's purchases, once as the payment) and treating investment transfers as expenses. These are now detected automatically — from Plaid's transaction category on newly synced transactions and from recognizable payment/transfer wording on existing ones — shown with a "transfer" badge in the expense list, and excluded from every spending total. A checkbox in the expense editor overrides the detection in either direction. Deliberately categorized transactions (by you or by a rule) are always trusted as spending.
- **Credit-card interest surfaces as its own "Interest Charges" category.** Interest is real spending — the cost of borrowed money — so instead of drowning in "Other" it's now categorized as Interest Charges, budgetable like any category. Other bank fees from synced transactions now land under "Bank Fees" instead of "Other" too.
- **Budget sharing is editable after creation.** The "Who can see this budget" checkboxes now appear when editing a budget (not just when creating one), pre-set to each person's current visibility.
- **The Cashflow view has the This Month / Quarter / Year toggle.** Same semantics as the dashboard: the income/outflow/net cards aggregate bills per calendar month across the period (a yearly premium lands only in its due month). The Sankey follows the period too, now comparing like with like — spending *so far* in the period against income accrued *so far* (prorated by elapsed days) — so its savings/shortfall no longer disagrees with the plan cards just because they measured different windows.
- **Properties can be tagged as investment properties.** An "Investment property" checkbox on property accounts (Income → Assets, or any account edit) adds the property to the Investments tab in a Real Estate section with estimated value, amount owed, and equity — alongside the securities portfolio, and even before any brokerage is connected. Tagged properties show an "Investment" badge on the Assets list.
- **Bills, Budgets, and Rules now share ONE category set, with bill↔transaction reconciliation.** Bills historically had their own category list ("Insurance", "Rent", custom bill categories) that budgets and rules couldn't see. A one-time migration converts every bill to the shared canonical categories (labels with no match become custom categories automatically, so nothing is lost), the bill form uses the same category list as everywhere else (typing a brand-new name creates it on the spot), and bills feed the budget matching their category through **reconciliation**: a bill counts as an upcoming forecast until its real payment appears in your transactions (matched by amount ±5% and date ±7 days), then the actual takes over automatically — no double counting, no invisible upcoming bills. The per-bill override remains (count toward a different budget, or none). Custom categories are managed in one place in Settings and apply app-wide.
- **This Month / Quarter / Year toggle on the dashboard.** The cashflow hero and the income/bills/remaining/coverage cards can aggregate over the current calendar quarter or year, with bills computed month by month (a yearly premium lands only in its due month, an every-other-month bill in its alternating months, per-paycheck bills follow each month's real pay-date count). Balance-sheet cards stay point-in-time.
- **Referral revenue-share tracking (cloud, admin).** Every referred signup whose subscription becomes active is recorded in a payout ledger at $20 per conversion. The admin panel gains a Referral Payouts section grouped by referrer — owed/paid totals, per-conversion status (unpaid / paid / void) with payout notes, and one-click "mark all paid". The free-month referral tiers are unchanged and stack on top.
- **Adding a detected bill can create a matching categorization rule.** A checked-by-default option on the "Add Detected Bill" dialog creates a rule (merchant → chosen category) so future transactions stay consistent, applies it to past transactions immediately (hand-edited ones untouched), lands at the lowest priority, and skips creation when a rule already covers the merchant.

### Changed
- **The dashboard uses a two-column layout.** Wide widgets flow down the main column while compact ones (Financial Health Score, Upcoming Bills, Savings Goals, Budget Health, Smart Insights) stack in a right-hand rail. The header greets you by name, the layout collapses to one column on narrow screens, and Customize works exactly as before.
- **The financial summary is a single-row carousel.** Stat cards scroll horizontally (swipe on touch, chevrons on desktop) instead of wrapping into a tall grid.
- **Detected bills prefill their real category.** The suggestion uses the majority category across the merchant's transactions (one recategorized charge no longer flips it), passes through verbatim including custom categories, and the saved bill counts toward the matching budget.
- **No more native browser popups.** Creating a category (Budgets/Rules pickers), renaming a business (Settings), adjusting a shared budget, and recording a referral payout (admin) all use styled in-app forms instead of system prompt dialogs.

### Fixed
- **A stale browser tab can no longer wipe bank-synced transactions.** Saves write the whole data blob, so a tab opened before a server-side bank sync used to overwrite the newer transactions on its next save — budgets then under-reported spending. Every cloud save now checks the server first and preserves any synced transactions the tab has never seen; deliberate deletions stay deleted and the sync timestamp can't move backwards.
- **The "Add Detected Bill" dialog actually has an Add button.** It rendered with no way to save (its confirm handler was passed to a modal API that ignored it); it now has Cancel/Add Bill buttons and a category dropdown with free-typing.

### Security
- **The AI assistant endpoint is rate-limited per user and per IP.**

## [0.6.0] — 2026-07-06

### Security
- **Self-hosted PennyHelm is now password-protected** ([#10](https://github.com/administrativetrick/pennyhelm/issues/10)). Previously anyone who could reach the IP:port could read all financial data. The first visit now sets an app password (salted scrypt hash, stored locally); sessions are 30-day HttpOnly cookies; login is throttled against brute force; and changing the password (Settings → Security) signs out every other device. Self-host Plaid endpoints — which hold bank access tokens — are behind the same authentication. For deployments where a reverse proxy already handles auth, `PENNYHELM_DISABLE_AUTH=1` opts out and the app shows a permanent warning banner that the data is unprotected.

### Added
- **Change someone's access level without re-inviting them.** "Edit access" next to each person in Settings → People with access opens the role editor — switch between Companion/Advisor/Viewer/Partner/Full, adjust which accounts and budgets they see, and toggle budget adjusting. Changes apply on their next refresh; no new invite email, no broken link.
- **Viewing shared finances no longer requires a subscription.** When a trial or subscription expires, an account that holds a share opens straight into the shared view instead of the paywall — viewing what someone shared with you stays free. Setting up or returning to your *own* finances is what asks for the subscription.

## [0.5.0] — 2026-07-04

### Added
- **Shared mode: the app itself now scopes to your granted role.** When someone views finances shared with them, the sidebar collapses to just the shared overview plus their own Settings — a Companion no longer sees Bills, Calendar, Income, or any other tab their role doesn't include, and typing those URLs redirects to the overview. Everyone with shares gets a "Shared with you" section in the sidebar; "My finances" switches back at any time, and the viewing context is remembered across visits.
- **Invited accounts default to the shared view until they set up their own finances.** A new account with a share skips the first-run screen entirely and signs straight in to the finances shared with it. Pressing "My finances" for the first time starts their own setup — the welcome screen (for brand-new accounts) and the guided tour — and from then on the app defaults to their own finances.
- **Role-based sharing (cloud).** Invites now carry an access level instead of a view/edit binary. Five additive roles: **Companion** (balances of accounts you pick + budget limit/spent/remaining — never individual bills, transactions, debts, or income), **Advisor** (read-only financial picture: accounts, debts, investments, income, savings, net-worth history), **Viewer** (read-only everything), **Partner** (everything + manages day-to-day bills/budgets/savings/rules), **Full** (everything + accounts/debts/income). Sharing management, data export, and bank connections always stay owner-only. Companion and Advisor grants can optionally allow adjusting budget amounts.
- **A "Shared with me" view.** People you've shared with now have an actual window into your finances: Settings lists finances shared with them and opens a role-scoped, read-only view. Enforcement is server-side — partial-access roles (Companion/Advisor) are served by a Cloud Function that filters your data and computes budget spent/remaining on the server, so bills and transactions never reach their browser at all. Existing shares keep working (view → Viewer, edit → Partner).
- **A $0 budget now means "no limit — just track it".** Set a budget's monthly limit to 0 and it becomes a tracking-only budget: total spend for that category or tag shows on the Budgets page, the variance report, the dashboard, and shared views, without ever reading as "over budget". Unlimited budgets are excluded from the remaining/limit totals (their spend is shown separately) and rollover doesn't apply.
- **The Budgets page warns when your plan exceeds your income.** With income configured, the summary shows whether your combined budget limits fit inside monthly income — a red banner calls out a negative-cashflow plan ("$X more than you earn even if every budget is hit exactly"), and otherwise a note shows your unbudgeted headroom.
- **Set a new budget's sharing visibility as you create it.** When people with Companion or Advisor access exist, the Add Budget form lists them with checkboxes ("Who can see this budget") — uncheck anyone to keep the new budget private from them, without touching their other access.
- **Choose which budgets an invited person can see.** Companion and Advisor invites now include a budget checklist — all selected by default; uncheck any budget to keep it private (new budgets stay visible unless you've customized the list). Shared budget edits are merged server-side, so hidden budgets can never be seen, changed, or accidentally wiped.
- **Budgets can now track a tag as well as a category.** A budget targets either a category (as before) or a tag — e.g. cap everything tagged "discretionary" no matter which category it lands in. Tag budgets count tagged expenses across all categories (bills don't apply, since bills carry no tags), support rollover, appear in the variance report and the dashboard's Budget Health widget as #tag, and flow through shared views — including budget editing by invited users who have that permission.

### Changed
- **Incoming invites now report their access role.** The invite list API includes the granted role, so clients (like the mobile app) can show "Companion access" instead of the legacy "View only" wording.
- **Rules can combine multiple conditions with AND/OR.** A rule now holds any number of conditions and matches either ALL of them (AND) or ANY of them (OR) — e.g. "vendor contains COSTCO AND amount is greater than 100". The rule form adds/removes condition rows; existing single-condition rules are unchanged.
- **Rules are now first-match-wins, with drag-and-drop priority.** Rules evaluate in numbered order (1, 2, 3…) and the first rule that matches a transaction applies — the rest are skipped, so specific rules placed above general ones can't be overridden anymore. Drag rows on the Rules page to reorder priorities. (Previously every matching rule applied cumulatively, with later rules overriding earlier ones.)
- **Rules now pick categories from a searchable dropdown.** The "Set category" field on transaction rules offers every existing category (including your custom ones) with search, plus "+ Create new category" to add one on the spot — no more free-typing category names that silently don't match any budget. Rules with legacy free-typed categories keep working and show as "(legacy)" when edited.

### Fixed
- **The invite accept page now loads for signed-out invitees.** It fetched the invitation straight from the database, which security rules (correctly) block before sign-in — so following an invite link while signed out always showed "Unable to load invitation". The page now fetches a display-safe preview through a Cloud Function, shows who invited you and at what access level (including the new role names), and then prompts you to sign in.
- **A broken invite email no longer loses the invite.** Sending an invite creates it first and emails second; if the email can't be delivered (e.g. the mail provider rejects the send), the invite still succeeds and the app shows a shareable accept link to pass along directly — the invitee also sees the pending invite when they sign in. Previously the whole action reported "Failed to send invite" even though the invite had been created.
- **"Re-run on all expenses" no longer overwrites manual edits.** Expenses you've hand-edited (category, name, tags, type, or business) are marked as yours and skipped when rules re-run — the confirmation and result messages now say exactly what was preserved. Rules still take precedence over the automatic import categorization for untouched expenses.
- **Adding a tag budget no longer replaces other tag budgets.** The one-budget-per-target dedupe compared categories only, so every tag budget (which has no category) collided with every other tag budget.
- **Budgets created with a full-date start month no longer show as "not started" for their first month.** Start months are normalized to year-month on save and defensively when computing status.

### Security
- **Invited editors can no longer alter sharing grants.** Firestore rules now freeze the access-control fields on any non-owner write, so a shared editor cannot grant or revoke access — that stays owner-only.

## [0.4.1] — 2026-07-03

### Added
- **New bill frequencies: "Every 4 Weeks" and "Every Other Month".** Every-4-weeks bills (e.g. daycare billed on a rotating custody cycle) are anchored by any known due date and repeat on a true 28-day cycle; every-other-month bills (common for water/sewer/trash) repeat in alternating months from a chosen month. Both flow through the paycheck view, month view, calendar, dashboard totals, budgets, and the overdue carry-forward.
- **Missed weekly/biweekly/every-4-weeks payments now carry forward too.** The "Overdue from last month" section previously only covered monthly bills; recurring bills now carry forward per missed occurrence.
- **Unpaid bills now carry forward as overdue.** A bill left unpaid last month no longer silently disappears at the month rollover — it appears in a red "Overdue from [month]" section at the top of the Bills page (and leads the dashboard's Upcoming Bills as "Overdue by N days"). Marking it paid resolves last month's record, not this month's. Auto-pay bills are exempt (an untick isn't a missed payment), and a "Mark all as paid" button clears a backlog in one click.
- **Optional auto-tick for auto-pay bills.** New setting (Settings → Bills): automatically mark auto-pay bills as paid once their due date passes. Off by default so manual ticking remains the reconciliation workflow.

### Changed
- **The financial-assistant chat bubble can now be moved and hidden.** Drag it anywhere on screen (the position is remembered) so it never covers UI you need, and a small minus button hides it for the rest of the session.

### Fixed
- **Bills with no category no longer produce a blank, unlabeled filter chip.** They now get an explicit "Uncategorized" chip and their category badge reads "Uncategorized" instead of rendering empty.
- **Multi-selecting bills no longer resets the filter to Unpaid.** Choosing "All" (or any category) now survives ctrl/cmd-click, shift-click, and long-press selection — previously each selection re-rendered the page back to the Unpaid filter, hiding rows mid-selection.
- **Paycheck view broke on payday during daylight-saving months.** Pay dates were generated by adding exact milliseconds, so after the March DST change every date sat at 1:00 AM instead of midnight. On a payday, "today" (midnight) matched no pay period and the By Paycheck view silently fell back to showing every bill with no period label. Pay dates now step by calendar days and stay at midnight year-round; the same fix was applied to weekly/biweekly bill occurrence expansion and day-of-week counting.

### Security
- **Product screenshots recaptured from fictional sample data.** The previous screenshots (README gallery and landing page) were captured from a real database. They have been replaced with captures of the built-in sample dataset, and the affected image files were purged from the entire git history (history rewritten and force-pushed; the v0.4.0 release tag was recreated). If you cloned or forked before this, please re-clone.

### Changed
- **Bills summary now shows what's left to pay.** The bills-page summary card is labeled "Remaining Bills This Period" (and "Remaining Bills" in the monthly view) and totals only unpaid bills, so it reflects what you still owe this period instead of the full scheduled amount. Marking a bill paid lowers the total.

## [0.4.0] — 2026-07-01

### Added
- **Net worth widget on the dashboard.** A new customizable widget shows current net worth, a trend area chart drawn from your saved balance history (once at least two snapshots exist), and colored chips breaking down the components (cash, investments, property/vehicle equity, credit owed, debt).
- **Cashflow summary on the dashboard.** A new top-of-dashboard widget leads with how much is left to spend this month in plain English ("Bills are running 112.8% of income — you're $1,845.07 over"), with income-vs-spending bars and a dependent-coverage callout. It's a customizable widget like the others (reorder or hide it from the gear menu).
- **Android app-install banner.** Visitors on an Android browser see a small dismissible banner on the homepage and sign-in page linking to the Play Store app. It is skipped on self-host and localhost, on non-Android browsers, in installed-PWA mode, and after dismissal (remembered in localStorage).
- **Prebuilt multi-arch Docker image on GHCR.** A GitHub Actions workflow (`.github/workflows/docker-publish.yml`) builds and publishes `ghcr.io/administrativetrick/pennyhelm` for linux/amd64 and linux/arm64 (Raspberry Pi / homelab friendly) on version tags and manual dispatch. README now documents a one-line `docker run`, and `docker-compose.yml` pulls the prebuilt image by default instead of building from source.
- **Screenshots in the README.** Added a dashboard, cashflow, bills, and calendar gallery near the top of the README.
- **Privacy-friendly web analytics on the marketing pages.** Added a cookieless analytics loader (Umami) that runs only on the public pennyhelm.com pages, never on self-host or localhost, and never inside the app. It sets no cookies and collects no personal data, so no consent banner is needed. Ships inert until a website ID is set in `js/analytics.js`. Disclosed in privacy policy section 1.10, effective date bumped to June 11, 2026.
- **robots.txt and sitemap.xml.** The site now tells crawlers what to index (marketing pages) and what to skip (app shell, OAuth handler, invite/delete flows). Sitemap lists `/`, `/switch`, `/privacy.html`, and `/terms.html` against the `pennyhelm.com` host.
- **Open-source indicator on the landing page.** A small "Open source (AGPLv3) · View on GitHub" note under the hero CTAs and a "100% open source" bullet on the Self Host pricing card, so self-hosters can see the license and repo without it crowding the cloud pitch.
- **Terms of Service page (`/terms.html`).** Covers the hosted Cloud subscription (pricing, 30-day trial, Stripe billing, auto-renewal, cancellation), a prominent "not financial advice" disclaimer, bank-connection accuracy caveats for Plaid, the AGPLv3 license and brand-use boundary, warranty disclaimer, and liability limits. Linked from every footer (was a dead `#` link). Governed by California law.
- **Social preview cards (Open Graph + Twitter).** Sharing any page on Reddit, Facebook, iMessage, Slack, etc. now renders a branded 1200x630 card (`og-image.png`) with title and description instead of a bare URL. Added to the landing, privacy, and terms pages.
- **Canonical URLs.** Each page declares a `rel="canonical"` to its `pennyhelm.com` (apex) address, with `www.pennyhelm.com` redirecting there, so search engines consolidate ranking signals on one host instead of splitting them.
- **Social icons in the footer, rendered from one place.** GitHub and Facebook now appear as icons in the footer (GitHub was previously a text link). The footer markup moved into a single `js/footer.js`, so it is defined once and shared across the landing, privacy, and terms pages instead of being duplicated on each.

### Changed
- **Rebranded the marketing and sign-in pages to match the app.** The landing page, login, and the other public pages (privacy, terms, FAQ, alternatives, invite, link) now use the same green accent, deep canvas, and Hanken Grotesk / IBM Plex Mono typography as the app, including the green-to-blue logo mark. The old blue accent is fully retired across the web.
- **Polished the data tables across Bills, Debts, Investments, and Accounts.** On desktop the tables now sit in rounded cards with roomier, spaced-out uppercase column headers and tabular (monospaced-digit) figures so amounts line up cleanly. Mobile keeps its compact edge-to-edge tables.
- **Grouped the sidebar navigation.** The left nav is now organized under Overview / Manage / Wealth headings, with Settings pinned to the bottom. All existing pages are kept; the active item gets a green accent bar. Also swept the last hardcoded blue tints (active nav, selected rows, toggles, calendar "today", filter chips) over to the new accent color for a consistent rebrand.
- **Refreshed app theme and typography.** The web app moved to a new visual identity — a deeper near-black canvas, a green accent, warmer semantic colors, and the Hanken Grotesk / IBM Plex Mono typefaces — applied through the existing design tokens so both dark and light modes are updated. No layout or feature changes yet; this is the foundation for a broader dashboard redesign.
- **Landing page now uses WebP screenshots.** The four product screenshots were converted from PNG to WebP, cutting their combined weight ~59% (436 KB to 180 KB) for a faster hero load.
- **Footer copyright corrected and license-forward.** Year fixed to 2026 (the project's first release year), and "All rights reserved" replaced with "Open source under AGPLv3" across the landing and policy pages, which is the accurate framing for a copyleft project.
- **Landing `<title>` rewritten for search.** From "Take Control of Your Finances" to "Open-source personal finance, self-hosted or cloud" so it carries the keywords people actually search.
- **Google sign-in now runs on the pennyhelm.com auth handler.** Firebase `authDomain` was pointed at `pennyhelm.com` (in `js/firebase-config.js` and `oauth.html`) so the OAuth sign-in popup shows `pennyhelm.com` instead of briefly flashing the internal Firebase project domain (`cashpilot-c58d5.firebaseapp.com`). This also makes the OAuth handshake same-origin, which is more resilient to third-party-cookie blocking in Safari/Brave. Requires `pennyhelm.com` to be a Firebase Auth authorized domain and an authorized redirect URI (`https://pennyhelm.com/__/auth/handler`) on the OAuth web client. No change to the mobile app.

### Fixed
- **Public REST API returned 404 for every valid request.** The `/api/v1/*` router assumed `req.path` would arrive as `/v1/<resource>`, but the Firebase Hosting `/api/**` rewrite preserves the full path (`/api/v1/<resource>`), so every authenticated request fell through to a 404 "not found." The router now tolerates the leading `api` segment, so `/api/v1/bills`, `/accounts`, `/debts`, `/expenses`, and `/summary` all work with a valid `Authorization: Bearer ph_live_...` key.
- **Bill paid status now tracks the correct month across pay periods.** In the paycheck view, a monthly bill whose due date falls into the next calendar month was recording and reading its paid flag under the month being viewed rather than the month it is actually due. A pay period that straddled month-end could make next month's bill look already paid, or drop a paid mark. Paid status is now bucketed by each bill's own due month (and the upcoming-bills list on the dashboard matches).
- **Assets tab no longer disappears on the Income page.** Opening the Documents or Deductions sub-tab redrew a tab strip that was missing the Assets tab, so it vanished until you navigated away. The Documents/Deductions view now shows all four tabs (Income, Documents, Deductions, Assets), matching the other sub-views.
- **"Start Free Trial" buttons now open the Sign Up tab.** Both landing-page trial CTAs pointed at `/login`, which defaults to the Sign In tab, so new visitors landed on a form for existing users. The CTAs now use `/login?signup=1`, the same auto-switch param the `/switch` ad page already relies on.

### Security
- **Firebase Hosting no longer serves internal files.** The hosting `ignore` list previously replaced Firebase's defaults without covering everything, so `auth_export.json` (real account records), a stray local data file, `firebase.json`, dotfiles, `Dockerfile`, `app.json`, `plaid-service.js`, and temp screenshots were publicly reachable on pennyhelm.com. The ignore list now blocks all of them; deployed and verified 404 on 2026-06-10.

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

[Unreleased]: https://github.com/administrativetrick/pennyhelm/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/administrativetrick/pennyhelm/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/administrativetrick/pennyhelm/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/administrativetrick/pennyhelm/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/administrativetrick/pennyhelm/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/administrativetrick/pennyhelm/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/administrativetrick/pennyhelm/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/administrativetrick/pennyhelm/releases/tag/v0.1.0
