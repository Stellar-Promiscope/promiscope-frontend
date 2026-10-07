# Security Policy

## Supported Versions

We provide security updates for the following versions:

| Version  | Supported          |
| -------- | ------------------ |
| latest   | :white_check_mark: |
| < latest | :x:                |

## Scope

### In scope

This **frontend repository** (`promiscope/promiscope-frontend`) — including:

- Next.js application code (`app/`, `components/`, `hooks/`, `lib/`)
- API routes (`app/api/`)
- Server-side logic (IPFS upload proxy, SEP-10 authentication, referral handling)
- Build and CI/CD configuration
- Environment variable handling and configuration validation

### Out of scope

- The **smart-contract repository** (`promiscope/promiscope-contracts`) — see its own security policy
- Third-party services we depend on (Stellar network, Pinata IPFS, Sentry, Vercel)
- Issues in dependencies that are already reported upstream
- Theoretical attacks without a practical demonstration

## Reporting a Vulnerability

We use **GitHub Private Vulnerability Reporting** for responsible disclosure.
Do **not** file a public GitHub issue for a security vulnerability.

### How to report

1. Go to the **Security Advisories** page:
   https://github.com/promiscope/promiscope-frontend/security/advisories/new

2. Fill in the details:
   - **Title**: Brief description of the vulnerability
   - **Description**: Steps to reproduce, impact, and any suggested fix
   - **Severity**: Your assessment of the impact (critical, high, medium, low)
   - **Affected versions**: Which releases are affected

3. Submit the advisory — it remains private until we resolve it.

If you're unable to use the GitHub form for any reason, you may alternately
email **security@promiscope.example** — but the GitHub advisory is strongly
preferred as it provides structured fields and automatic tracking.

### What to expect

| Event             | Estimated time                                                                  |
| ----------------- | ------------------------------------------------------------------------------- |
| Acknowledgment    | Within 48 hours                                                                 |
| Triage & analysis | Within 5 business days                                                          |
| Fix deployed      | Dependent on severity (critical: < 48 hours, high: < 7 days, medium: < 30 days) |
| Public disclosure | After fix is deployed, coordinated with reporter                                |

We will work with you to understand the issue and ensure it is addressed
promptly. You will be credited in our security acknowledgments (unless you
prefer to remain anonymous).

## Hall of Fame

We thank the following researchers for their responsible disclosures:

_None yet — be the first!_

---

## Security.txt

This project also publishes an RFC 9116 `security.txt` file at:
https://promiscope.example/.well-known/security.txt
