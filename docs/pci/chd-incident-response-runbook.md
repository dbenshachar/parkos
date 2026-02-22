# CHD Incident Response Runbook

## Trigger Conditions
- Suspected storage, transmission, or logging of sensitive authentication data.
- Suspected PAN/CVV exposure through application, logs, or third-party integrations.
- Unauthorized access to payment-related systems or secrets.

## Immediate Actions (0-60 minutes)
1. Declare security incident and page incident commander.
2. Contain:
- Disable affected endpoints/feature flags if needed.
- Rotate exposed secrets and invalidate active sessions.
3. Preserve evidence:
- Snapshot logs, configs, deployment hashes, and access records.

## Investigation (1-24 hours)
1. Determine exposure window and affected systems.
2. Identify affected account records and traffic paths.
3. Confirm whether PAN/CVV or equivalent sensitive data was disclosed.

## Notification and Escalation
- Notify legal/compliance leadership immediately.
- Notify acquirer/payment brands per contractual and PCI obligations.
- Coordinate customer notifications if required by law/contract.

## Recovery
1. Patch root cause and deploy verified fix.
2. Re-run targeted security tests and validation checks.
3. Monitor for recurrence and suspicious activity.

## Post-Incident
- Complete root-cause analysis within 5 business days.
- Record corrective actions and control improvements.
- Update this runbook and training material with lessons learned.
