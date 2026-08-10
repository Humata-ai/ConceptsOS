# ConceptsOS Security Roadmap

## V1 (current)

- **Transport:** all user ↔ pod traffic over WireGuard. wg private key is
  generated on-device (iOS) and stored in the iOS Keychain; the server
  only ever sees the client pubkey.
- **Auth:** Supabase JWTs, Sign in with Apple / Google. RLS on all
  user-scoped tables.
- **Isolation:** one Kubernetes pod + PVC per user. Users cannot reach
  each other over the network (wg-gateway routes strictly by pubkey).
- **LLM keys:** per-user Anthropic key, revocable independently.

## Known V1 gaps (accepted, documented)

- **Persistent volume is NOT encrypted with a user-held key.** GCP
  encrypts PDs at rest with Google-managed keys, but ConceptsOS
  operators (us) can mount the volume and read it.
- **Pod RAM is not confidential.** A malicious operator with node
  access could inspect the running process.
- **Users cannot verify the image they're running** matches the
  published source.

## V2 target — Tier 1 E2EE

- Each user's PVC is a **LUKS-encrypted volume**.
- The disk-encryption key (DEK) is generated on iOS at signup, stored
  in iOS Keychain (syncs via iCloud Keychain to their other Apple
  devices).
- On pod boot, the pod comes up in a "locked" state — no user services
  running, only a small unlock-listener on the wg tunnel.
- iOS, once the wg tunnel is up, POSTs the DEK to the pod's unlock
  endpoint. The pod unlocks the LUKS volume and starts services.
- **We never see the DEK.** If the user loses all their Apple devices
  and iCloud Keychain isn't restored, their data is unrecoverable.
  This is the honest cost of real E2EE and must be surfaced in the
  signup UX.

## V3 target — Tier 2

- Move user node pool to **Confidential GKE Nodes** (AMD SEV-SNP).
  Pod RAM is encrypted; we lose the ability to snoop running
  processes even with node-level access.

## V4 target — Tier 3

- Reproducible builds of the `ConceptsOS-VM` image.
- iOS verifies the image digest (published + signed) before sending
  the DEK. Establishes end-to-end trust that the code running on the
  server is the code we published.
