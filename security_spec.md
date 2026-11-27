# Signal Forge — Firestore Security Specification (Phase 0 TDD)

- **Firebase Project ID**: `propane-talon-fv0ns`
- **Firestore Database ID**: `ai-studio-bbb47fa7-6d44-40e8-b4b1-545daa3218d3`
- **Default Policy**: Global default-deny catch-all (`match /{document=**} { allow read, write: if false; }`)

## 1. Data Invariants & Relationship Mapping

1. **Master Source of Truth (`/users/{userId}`)**:
   - Every user-scoped resource belongs exclusively to `/users/{userId}` where `userId == request.auth.uid`.
   - PII (`email`, `displayName`) is strictly isolated to `isOwner(userId)` — never readable by other signed-in users.
   - All write operations require `isVerified()` (`request.auth != null && request.auth.token.email_verified == true`).
   - All subcollection `create` operations enforce the Master Gate: `exists(/databases/$(database)/documents/users/$(userId))`.
2. **Subcollections under `/users/{userId}`**:
   - `watchlist/{coinId}` — Trader watchlist pairs (`symbol` matches `^[A-Z0-9]+$`, length 4..16).
   - `alerts/{alertId}` — Target price alerts (`condition` in `['ABOVE', 'BELOW']`, `targetPrice > 0`).
   - `workspaceConfig/{configId}` — 24-key boolean `GranularControlMatrix` with strict key allowlist (`isValidToggleMap`).
   - `rollbackSnapshots/{snapshotId}` — Immutable configuration checkpoints (`allow update: if false`).
   - `errorLogs/{logId}` — Immutable PII-masked forensic records (`allow update: if false`, `serviceId` and `severity` strictly enum-bounded).
   - `dailyPnlRecords/{dateKey}` — High-precision daily PnL ledger (`dateKey` matches `^[0-9]{4}-[0-9]{2}-[0-9]{2}$`, `winRatePct` in `[0, 100]`).
   - `vaultLocker/{vaultId}` — Profit scooping locker snapshot (`thresholdMode` in `['USD_FIXED', 'PERCENT_OF_EQUITY']`, bounded thresholds & ratios).
3. **Evaluation Order (Denial-of-Wallet Guard — Pillar 10)**:
   - Step 1: Request authentication & ownership (`isVerified() && isOwner(userId)`).
   - Step 2: Static path/schema validation (`isValidId(...)` and `isValid[Entity](incoming(), ...)`).
   - Step 3: Relational DB read (`exists(/databases/$(database)/documents/users/$(userId))`).
4. **Immutability & Temporal Integrity**:
   - `createdAt == request.time` on `create`; `createdAt == existing().createdAt` and `updatedAt == request.time` on `update`.
   - `uid`, `id`, `userId`, `symbol`, `dateKey` are immutable after creation.
   - `allow list` never calls `get()`/`exists()` and always enforces `resource.data.userId == request.auth.uid`.

## 2. The "Dirty Dozen" Adversarial Payloads

| # | Attack Class | Target Collection | Malicious Payload / Mutation | Expected Verdict |
|---|---|---|---|---|
| 1 | Shadow Field Injection | `/users/{uid}` | Valid `UserProfile` + `{ "role": "admin", "isAdmin": true }` | `PERMISSION_DENIED` (`hasOnly`) |
| 2 | Cross-Tenant Identity Spoofing | `/users/{uid}/watchlist/BTCUSDT` | `{ "id": "BTCUSDT", "userId": "victim_uid", ... }` | `PERMISSION_DENIED` (`data.userId == request.auth.uid`) |
| 3 | Unverified Email Write Bypass | `/users/{uid}/alerts/al_1` | Signed-in user with `email_verified: false` creating alert | `PERMISSION_DENIED` (`isVerified()`) |
| 4 | ID Poisoning / Resource Exhaustion | `/users/{uid}/watchlist/{1.5KB_id}` | Document ID > 128 chars or containing invalid symbols (`../$`) | `PERMISSION_DENIED` (`isValidId`) |
| 5 | Client-Forged Timestamp | `/users/{uid}/watchlist/BTCUSDT` | `createdAt` set to past/future timestamp instead of `request.time` | `PERMISSION_DENIED` (`incoming().createdAt == request.time`) |
| 6 | Negative / Zero Target Price | `/users/{uid}/alerts/al_bad` | `{ ..., "targetPrice": -50 }` | `PERMISSION_DENIED` (`targetPrice > 0`) |
| 7 | Toggle Matrix Ghost Key Injection | `/users/{uid}/workspaceConfig/controlMatrix` | `toggles` containing 24 valid keys + `"bypassRisk": true` | `PERMISSION_DENIED` (`isValidToggleMap` `hasOnly`) |
| 8 | Immutable Checkpoint Tampering | `/users/{uid}/rollbackSnapshots/snap_1` | `update` attempt on an existing rollback checkpoint | `PERMISSION_DENIED` (`allow update: if false`) |
| 9 | Immutable Audit Log Tampering | `/users/{uid}/errorLogs/err_1` | `update` attempt or unknown `serviceId: "root-shell"` | `PERMISSION_DENIED` (`allow update: if false` / enum check) |
| 10 | Invalid Date Key / Win-Rate Overflow | `/users/{uid}/dailyPnlRecords/bad-date` | `dateKey: "2026-99"` or `winRatePct: 145` | `PERMISSION_DENIED` (`isValidDateKey` & `winRatePct <= 100`) |
| 11 | Vault Threshold Bounds Bypass | `/users/{uid}/vaultLocker/primaryVault` | `profitThresholdUsd: 1` or `scoopExcessRatioPct: 500` | `PERMISSION_DENIED` (numeric range guard) |
| 12 | Immutable Field & Orphan Write | `/users/{uid}/alerts/al_1` | `update` changing `symbol` or `createdAt`, or `create` without parent `/users/{uid}` | `PERMISSION_DENIED` (`affectedKeys().hasOnly` / `exists()`) |

## 3. Red Team Audit Matrix

- **Shadow Update Test**: PASS — Every `isValid*` helper combines `keys().hasAll(...)` and `keys().hasOnly(...)`, and every `allow update` restricts mutations via `incoming().diff(existing()).affectedKeys().hasOnly(...)`.
- **Email Spoofing Test**: PASS — No email string check occurs without `request.auth.token.email_verified == true`.
- **PII Blanket Test**: PASS — `/users/{userId}` restricts `get` strictly to `isOwner(userId)` and forbids `list` and `delete`.
- **Query Trust Test**: PASS — Every `allow list` explicitly checks `isOwner(userId) && isValidId(userId) && resource.data.userId == request.auth.uid` with zero `get()`/`exists()` calls.
- **Value Poisoning Test**: PASS — Every `allow update` calls `isValid[Entity](incoming(), ...)` before evaluating `affectedKeys().hasOnly(...)`.
