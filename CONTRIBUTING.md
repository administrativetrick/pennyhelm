# Contributing to PennyHelm

Thanks for your interest in contributing! PRs, issues, and feedback are all welcome.

## TL;DR

1. Fork the repo, create a feature branch.
2. Make your change, commit with a clear message.
3. Open a PR against `master`.
4. A **CLA Assistant** bot will comment on your PR asking you to sign the [Contributor License Agreement](CLA.md). Sign once (per GitHub account) and you're done — subsequent PRs don't re-prompt.
5. Once CI + review pass, your PR gets merged.

## Why the CLA?

PennyHelm is distributed under the **[GNU Affero General Public License v3.0](LICENSE)** (AGPLv3). The [Contributor License Agreement](CLA.md) lets the Project Owner offer PennyHelm under additional licensing models in the future — for example, a proprietary commercial license alongside the AGPL version.

**You keep the copyright on your contribution.** The CLA is a license grant, not an assignment — you're giving the Project Owner permission to relicense your contribution, not transferring ownership of it. The full text is in [CLA.md](CLA.md) and is modeled on the widely-used Apache ICLA / Project Harmony templates.

This is the same pattern used by MongoDB, MariaDB, Canonical (Ubuntu), Google, Elastic, and most other dual-licensed open-source projects.

## What to expect in a PR

- **Small, focused changes are easier to review** than sprawling refactors. If you want to make a big change, open an issue first to discuss.
- **Follow the existing style** — PennyHelm is vanilla JS (ES modules, no bundler) on the frontend and CommonJS on the backend. No linter enforced yet, but `node --check` passes on every file is a minimum.
- **Test what you can** — there's no formal test suite yet (sorry), so manual verification is the bar: confirm your change works against the sample data (`Load Sample Data` on first run) and doesn't break the existing flows you touched.
- **Commit messages** — imperative mood ("Add X", "Fix Y"), explain *why* in the body if the change isn't self-evident.

## What won't get merged

- **Cosmetic churn** — reformatting, renames for style preference only, pure "cleanup" PRs without functional justification.
- **Feature bloat** — PennyHelm tries to stay focused on personal finance. New modules (project management, habit tracking, etc.) are out of scope.
- **Unsigned contributions** — the CLA Assistant will block merging until you've signed.

## Development setup

```bash
git clone https://github.com/administrativetrick/pennyhelm
cd pennyhelm
npm install
npm start
```

Or via Docker:

```bash
docker compose up -d --build
```

Open <http://localhost:8081>.

## Bug reports / feature requests

Open a GitHub issue. Please include:

- What you expected to happen
- What actually happened
- Steps to reproduce (sample data works fine for most scenarios)
- Browser + OS version if it's a frontend bug
- Node version if it's a backend bug

Thanks for helping make PennyHelm better.
