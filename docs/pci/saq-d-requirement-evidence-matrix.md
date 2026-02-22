# SAQ D Requirement-to-Evidence Matrix (ParkOS)

| PCI DSS Area | ParkOS Control | Evidence Artifact |
| --- | --- | --- |
| Req 1: Network Security Controls | Reverse proxy and security headers configured; restricted exposed services | Infrastructure diagram, ingress config, `next.config.ts` headers |
| Req 2: Secure Configurations | Baseline hardening for Next.js/Tauri/CI | Config baseline checklist, `src-tauri/tauri.conf.json`, CI workflow files |
| Req 3: Protect Stored Account Data | Local saved payment profiles encrypted with AES-256-GCM + PBKDF2 | `lib/payment-profile-storage.ts`, migration validation logs |
| Req 4: Protect Data in Transit | HTTPS/TLS endpoints for processor, Twilio, Supabase, OpenAI | TLS policy docs, endpoint inventory |
| Req 5: Malware Protection | Endpoint controls on managed hosts/build agents | EDR deployment report |
| Req 6: Secure Systems & Software | Secure coding, SAST, dependency review, secret scan | `.github/workflows/security-*.yml`, PR records |
| Req 7: Restrict Access by Need-to-Know | RLS enabled with service-role-only policies | `supabase/20260222_enable_rls_for_pci.sql` |
| Req 8: User Identification & Authentication | Password-based auth with session cookie signing secret | `lib/account-session.ts`, auth runbooks |
| Req 9: Physical Access | Hosting provider physical controls | Cloud provider attestation (SOC reports) |
| Req 10: Log and Monitor | Sanitized error logging, security workflow results | Application logs, SIEM exports |
| Req 11: Security Testing | Quarterly scans + annual penetration test | Scan reports, pen-test statement |
| Req 12: Security Policy | Key management, incident response, governance docs | `docs/pci/*.md` policy set |

## Validation Cadence
- Quarterly: vulnerability scanning and control evidence refresh.
- Annually: SAQ D attestation package preparation and review.
