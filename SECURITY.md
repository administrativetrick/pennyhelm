# Security Policy

PennyHelm handles personal financial data, so security reports get priority
over everything else.

## Reporting a vulnerability

**Please use GitHub's private vulnerability reporting:** go to the
[Security tab](https://github.com/administrativetrick/pennyhelm/security) of
this repository and click **"Report a vulnerability"**. That opens a private
thread with the maintainer — nothing is public until a fix ships.

If the issue does not expose user data and doesn't need coordinated
disclosure (e.g. a hardening suggestion), a regular
[GitHub issue](https://github.com/administrativetrick/pennyhelm/issues) is
fine too.

## What to expect

PennyHelm is maintained by one person, so response times are honest rather
than corporate:

- **Acknowledgment** within a few days.
- **Fix for confirmed vulnerabilities** as fast as severity warrants —
  data-exposure issues take precedence over all feature work and ship as a
  tagged release with a `### Security` changelog entry and a rebuilt Docker
  image.
- **Credit** to the reporter in the changelog and release notes, unless you
  ask not to be named.

## Supported versions

Only the **latest release** receives security fixes. Self-hosters should
track `ghcr.io/administrativetrick/pennyhelm:latest` or update promptly when
a release is marked as a security upgrade.

## Scope notes for self-hosters

- Since v0.6.0, self-hosted instances are password-protected by default.
  Running with `PENNYHELM_DISABLE_AUTH=1` intentionally removes that
  protection — reports about data exposure in that configuration are
  working-as-documented (the app shows a permanent warning).
- The self-host server binds to `127.0.0.1` unless you set `HOST` — exposing
  it beyond your machine/LAN is your deployment choice; put a reverse proxy
  with TLS in front for anything internet-facing.
