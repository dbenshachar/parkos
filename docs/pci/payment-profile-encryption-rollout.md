# Payment Profile Encryption Rollout

## External Contract Freeze
- `POST /api/parking/payment/execute` request/response shape remains unchanged.
- UI payment flow remains: enter details -> confirm pay -> receive expiry confirmation.

## Feature Flags
- `PAYMENT_PROFILE_ENCRYPTION_ENFORCED=false` for transitional deployment.
- `NEXT_PUBLIC_PAYMENT_PROFILE_ENCRYPTION_ENFORCED` mirrors the server flag for client behavior.

## Rollout Stages
1. Canary users:
- Enable updated build for internal testers only.
- Validate migration from `parkos.paymentProfile.v1` plaintext to encrypted payload.

2. 25% traffic:
- Monitor login success rate, payment success rate, and local profile unlock failures.

3. 50% traffic:
- Confirm no regression in payment completion and no elevated support incidents.

4. 100% traffic:
- Keep enforcement disabled until migration confidence is established.

5. Enforced mode:
- Set `PAYMENT_PROFILE_ENCRYPTION_ENFORCED=true`.
- Disable plaintext transitional read in a later cleanup release.

## Rollback
- Rollback is configuration-first:
- Toggle `PAYMENT_PROFILE_ENCRYPTION_ENFORCED=false`.
- No DB schema rollback required.
