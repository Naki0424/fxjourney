# FXJourney PC ⇄ ZTE Blade A75 pairing

This phase uses Tailscale only as a private transport. FXJourney still requires its Ed25519 request signatures, registered devices, explicit trust, workspace checks, and protocol/schema checks.

## 1. Configure the two nodes

Install and sign in to Tailscale manually on the PC and the ZTE Blade A75. No root access, router forwarding, Funnel, or public endpoint is needed.

On each device, determine its Tailscale IPv4 address from the Tailscale app or admin console. It should normally be in `100.64.0.0/10`. Do not infer trust from the address alone.

In the ignored `server/.env` on the PC, set the PC address and the exact A75 address:

```dotenv
FXJOURNEY_HOST=100.PC.TAILSCALE.IP
FXJOURNEY_SYNC_PEER_HOSTS=100.A75.TAILSCALE.IP
PORT=3001
```

In the ignored `server/.env` on the A75, set the A75 address and the exact PC address:

```dotenv
FXJOURNEY_HOST=100.A75.TAILSCALE.IP
FXJOURNEY_SYNC_PEER_HOSTS=100.PC.TAILSCALE.IP
PORT=3001
```

Replace every placeholder with the exact numeric address. `0.0.0.0`, `::`, arbitrary LAN addresses, broad private ranges, and unlisted peer addresses are rejected. For normal local development, omit `FXJOURNEY_HOST` and the server remains on `127.0.0.1`.

Start each backend from the repository root with:

```powershell
npm run server
```

The private-overlay HTTP endpoint is not a public HTTP service: confidentiality comes from Tailscale and application authenticity comes from FXJourney Ed25519 signatures.

## 2. Create the PC invitation

On the PC, with its existing workspace selected, run:

```powershell
npm run pairing -- create --expires-minutes 10
```

Record the one-time `token`, `ownerFingerprint`, and `ownerDeviceId` from the output. Never put the token in source control or logs.

## 3. Accept on the fresh A75

The joining node must have no meaningful Account, Trade, or other user-created domain data. Stop the A75 backend before running the CLI so its in-memory bootstrap context cannot be stale.

On the A75, run:

```powershell
npm run pairing -- accept `
  --peer http://100.PC.TAILSCALE.IP:3001 `
  --token ONE_TIME_TOKEN `
  --owner-fingerprint PC_OWNER_FINGERPRINT `
  --local-endpoint http://100.A75.TAILSCALE.IP:3001
```

The A75 keeps its own device ID and private key. The command verifies the signed PC response, adopts the PC workspace transactionally, registers the PC public key, persists the peer endpoint, and completes trust on the PC. It never copies either identity file or private key. If the process is interrupted after adoption, rerun the command with the same invitation; the short-lived local resume state completes the pending trust step.

Restart the A75 backend with `npm run server`. The command output gives the A75 `deviceId` and the PC `ownerDeviceId`; use these as the `--peer-id` values below.

## 4. Manual Account + Trade sync

Keep both backends running. From the PC:

```powershell
npm run sync:peer -- --peer-id A75_DEVICE_ID
```

From the A75:

```powershell
npm run sync:peer -- --peer-id PC_OWNER_DEVICE_ID
```

The command reads the persisted paired endpoint, performs handshake, pushes and pulls Account/Trade events through Sync-0, persists cursors/receipts, and exits. It does not run in the background.

## 5. Physical verification checklist

1. Connectivity: verify each node can reach the other over its exact Tailscale URL; an unpaired device must fail FXJourney authentication.
2. Initial pairing: verify distinct device IDs and fingerprints, the same workspace/user, two trusted public identities, and that the invitation cannot be reused.
3. PC to A75: create a test Account and Trade on the PC, run `sync:peer`, and verify matching IDs, versions, provenance, advanced cursor, no duplicate, and no echo event on the A75.
4. A75 offline write: stop the PC backend, create a second test Trade on the A75, verify the local write and A75 origin sequence, restart the PC, and run sync from the A75.
5. PC unavailable: stop the PC completely, continue creating/updating test data on the A75, restart the PC, and run sync in both directions until both replicas converge.
6. Conflict: start from the same Trade version, stop connectivity, edit the same Trade independently, reconnect, and verify both snapshots and conflict metadata remain; no timestamp-only winner or replication loop is allowed.
7. Tombstone: synchronize a test Trade, delete it on one disconnected node, reconnect, and verify the tombstone propagates. Separately exercise edit-versus-delete and verify preserved conflict metadata.
8. Restart/replay: restart both servers, run sync again, and verify identities, trust, cursors, receipts, duplicate suppression, and no echo remain stable.

Do not copy SQLite, WAL/SHM, media, or `local-identity.json` files between devices. Media, Journal, Analyzer, Goals, Habits, Dashboard, and Analytics are outside this phase.
