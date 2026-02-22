# Key Management SOP (ParkOS)

## Keys in Scope
- `PARKOS_SESSION_SECRET` for session signing.
- Payment profile local encryption derived keys (ephemeral, derived from user password + salt).
- Third-party API secrets (`SUPABASE_API_KEY`, `TWILIO_AUTH_TOKEN`, `OPENAI_API_KEY`, etc.).

## Generation
- Generate server secrets using cryptographically secure random generators.
- Minimum entropy target: 256-bit random values for signing secrets.

## Storage
- Store production secrets only in deployment secret manager.
- Never commit secrets to source control.
- Restrict secret access to least-privilege operational roles.

## Rotation
- Rotate high-impact secrets at least every 90 days or on personnel/incident trigger.
- Immediate rotation required after suspected exposure.
- Session signing secret rotation must force session re-issue.

## Revocation and Incident Handling
- Revoke compromised credentials immediately.
- Record revocation timestamp, impacted systems, and remediation owner.
- For potential CHD impact, follow `docs/pci/chd-incident-response-runbook.md`.

## Verification
- Quarterly review of secret inventory and access permissions.
- Validate that old/retired secrets are disabled and unusable.
