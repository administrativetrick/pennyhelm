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

## Releases & CHANGELOG

Every new version **must** update [CHANGELOG.md](CHANGELOG.md) before the release tag is created.

### Format

- Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [SemVer](https://semver.org/).
- Section headings per release: `### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed`, `### Security`. Omit empty sections.
- Entries use past tense, user-visible language. "Added category budgets" beats "refactor budget-service.js".
- Security fixes always get their own `### Security` section, even if one line.

### Workflow for cutting a release

0. **Run tests**: `npm test` — must be green before tagging. If a test fails, fix it (or the underlying bug) before going further.
1. **Collect the changes**: `git log --oneline --no-merges v{last-tag}..HEAD`
2. **Edit `CHANGELOG.md`**: move entries from `[Unreleased]` into a new `## [X.Y.Z] — YYYY-MM-DD` section, add the link reference at the bottom.
3. **Commit**: `Prep v{X.Y.Z} changelog` (or roll into the release commit).
4. **Tag annotated**: `git tag -a vX.Y.Z -m "short human summary"`
5. **Push**: `git push origin master && git push origin vX.Y.Z`
6. **GitHub Release**: `gh release create vX.Y.Z --title "..." --notes "..."` — this is what awesome-selfhosted and most scrapers read.
7. **Deploy** (cloud): `npm run deploy:cloud -- --only hosting --project cashpilot-c58d5`

### What to leave in `[Unreleased]` during normal development

Any PR that changes user-visible behavior should append a bullet to `[Unreleased]`. Pure internal refactors, test additions, CI tweaks, and dependency bumps that don't affect behavior do not need a changelog entry.

### SemVer rules of thumb

- **MAJOR** — breaking change to data model, public API, or self-host config env vars.
- **MINOR** — new feature, new page, new category, new cloud function.
- **PATCH** — bug fix, copy tweak, non-breaking performance work.

Thanks for helping make PennyHelm better.
