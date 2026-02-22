# QSA / Acquirer Evidence Pack Checklist

## Architecture and Scope
- CDE data-flow diagram (`docs/pci/cde-data-flow.md`).
- In-scope system inventory (web, API, Tauri, Supabase, CI/CD).
- SAQ D rationale documentation.

## Technical Controls
- Payment profile encryption implementation evidence.
- Security headers/CSP configuration snapshot.
- Auth/session security controls and secret management evidence.
- RLS migration and policy evidence.

## Secure Development
- CI security workflow outputs (CodeQL, secret scan, dependency review).
- Change-management records for PCI-impacting releases.

## Operational Controls
- Vulnerability scanning reports (quarterly).
- Penetration test report (annual).
- Incident response records and tabletop exercise notes.
- Key rotation logs and secret inventory.

## Attestation Package
- Completed SAQ D form.
- Responsibility matrix by control owner.
- Open findings register and remediation plan.
