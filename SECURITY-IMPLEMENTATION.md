# Passkeys and security fixes — 4 November 2026

The passkey implementation and the seven requested security/reliability fixes are implemented locally. Valid-input V1 pricing functions are unchanged. Existing customer data, live credentials and deployment environment were not edited; no deployment was performed.

## Using passkeys

1. Install updated requirements and restart the application. New tables and additive security columns are created by the existing schema updater. Take a verified backup before updating a real shop.
2. Sign in with a password, then open **Passkeys & sign-in** in the sidebar. Confirm the current password, choose a device name, and select **Add passkey**.
3. At the login page use **Sign in with passkey**. The operating system chooses fingerprint, Face ID, Windows Hello, device PIN or an approved authenticator. The website cannot require a fingerprint specifically or collect fingerprint data.
4. Manage/remove keys from the same page. Removal requires the password. Password login remains available for recovery. A password reset/change revokes prior sessions and all account passkeys; the customer registers them again afterward.

For local development use `http://localhost:<port>`. For all client devices configure ONE stable hostname with trusted HTTPS, then set:

```dotenv
PASSKEY_ORIGIN=https://billing.example.com
PASSKEY_RP_ID=billing.example.com
TRUSTED_HOSTS=billing.example.com
SESSION_COOKIE_SECURE=true
FLASK_ENV=production
TRUST_PROXY=0
```

Replace the example with the real shop hostname. Use `TRUST_PROXY=1` only behind one trusted proxy that supplies correct forwarded scheme/address headers and cannot be bypassed. Keep a unique SECRET_KEY of at least 32 characters. Production WSGI startup rejects the published development key, short keys and non-Secure session cookies. Direct `python app.py` runs only on loopback with local HTTP cookies and a unique persisted local key when the configured key is weak; it leaves `.env` unchanged. Local development generates and persists a unique key when the published default is supplied. Raw HTTP LAN IP access supports password login but cannot offer passkeys. A hostname change requires re-registering keys. No HTTPS certificates or hosting changes were applied here.

## Security properties

WebAuthn verification uses the pinned `webauthn` library. Server checks the configured exact origin/RP, signed challenge, public key, credential owner, user handle, signature counter and REQUIRED user verification. Registration requires a current-password check. Challenges are server-stored, expire after three minutes, are session-bound and atomically consumed once. Shared database throttling caps authentication requests across workers. CSRF applies to options, verification and removal. Only public credential information is stored; private keys and biometrics stay with the authenticator. Maximum ten keys per account.

## Requested fixes

| Requested issue | Implemented behavior |
|---|---|
| Backup/restore conflicts with billing | Online SQLite backup snapshots; cross-process shared request locks and an exclusive nonblocking restore lock. Busy restore returns 503 with retry guidance. Upload staged and checked for integrity, matching schema, relationships and an owner account. A verified pre-restore snapshot is kept; a failed application attempts rollback. Live file is updated through SQLite's backup API, avoiding replacement while other connections hold old files. All app HTTP processes must use this version and the same database/lock path. CLI database maintenance must run with the shop stopped. |
| Cancellation/payment race | Cancellation now locks the customer and invoice in the same order as collections/deletion, then refreshes status before reversing the ledger. Product version checks protect competing ORM stock updates. |
| Initial credentials and defaults | Initial owner setup asks for a password of at least 12 characters or accepts INITIAL_ADMIN_PASSWORD. No fixed owner password is created. A legacy account using the known default is forced to replace it after sign-in. Owner-created/reset passwords require replacement before business access. Production secret/cookie guards and opt-in proxy trust added. |
| Password resets leave sessions active | Per-user authentication versions invalidate old browser sessions. Password reset/change also revokes the user's passkeys and pending registration challenges. Database restore randomizes versions, clears passkeys/challenges and requires replacement of restored passwords. |
| Staff permissions too broad | Owner-only settings/rate changes, inventory creation/edit/deletion, bill cancellation/deletion, customer deletion, tag-template mutation and management actions. Cashiers retain billing, customer creation/editing, collection, inventory viewing and tag printing. Owner controls are hidden where updated; server authorization is definitive. |
| Input/export/upload limits | 64 MB global request ceiling (including restore overhead), 1 MB ordinary request ceiling, 64 KB passkey responses, multipart limits, 200 bill lines, field lengths, finite numeric inputs bounded to one billion in entered units. Original valid-input arithmetic is preserved. CSV formula-leading text is prefixed consistently. |
| Stale stock edit overwrites sales | Product version column is included in edit forms and incremented for stock reservations/ORM changes. Stale edits and competing ORM updates return 409 and require reload. |

Responses carrying authenticated data and passkey/login responses use no-store. Camera permission is restricted to this origin and microphones are disabled. Secure production requests receive HSTS.

## Recovery

SQLite snapshots are kept under the server's `instance/backups` folder. Protect this folder with operating-system permissions, encrypted backup storage where appropriate, off-device copies and a retention policy. It contains private shop data. Download a snapshot for the owner's safekeeping.

Restore only while devices are idle. The owner confirms the current password and uploads a compatible .db backup. Successful restore signs devices out; restored owners sign in with the password in that backup and replace it. Passkeys must be registered again. If rollback itself fails, the application returns an explicit 503 recovery message; stop billing and recover from the retained snapshot. Infrastructure, disk failure and external database tools remain outside the HTTP lock.

Older backup schemas are rejected before live data changes. Upgrade a separate copy first:

```powershell
./.venv/Scripts/python.exe scripts/upgrade_backup.py --source path/to/old-backup.db --output path/to/new-upgraded-backup.db
```

The utility refuses an existing output, opens the source read-only, migrates only the new copy and checks integrity/relations. Review the upgraded copy before restore. PostgreSQL backup/restore remains an operator-managed pg_dump/pg_restore workflow; this UI does not replace PostgreSQL files.

## Validation and limits

The targeted suite covers session revocation, owner authorization, non-finite/direct-submit inputs, CSV safety, stale stock, backup validity, successful restore, corrupt-upload rejection, restore rollback, maintenance exclusion, concurrent cancellation/payment, legacy default-password replacement, additive migration, challenge expiration/binding/consumption and CSRF.

Chromium's virtual authenticator completed real WebAuthn registration/signature verification, resident-key login, replay rejection and password-confirmed removal. Passkey management was checked at 320/768/1440 widths. No physical biometric sensor was accessed.

Real client HTTPS/proxy setup, physical device authentication, cross-device passkey syncing, PostgreSQL concurrency, full disk/power-loss recovery and independent penetration testing still need acceptance on the deployed environment. This work does not claim zero defects or complete resolution of every item in the earlier audit (for example a full CSP rollout, dependency vulnerability audit and adaptive camera performance remain separate work).

Primary references: [py_webauthn registration](https://duo-labs.github.io/py_webauthn/registration.html), [authentication](https://duo-labs.github.io/py_webauthn/authentication.html), [WebAuthn](https://www.w3.org/TR/webauthn/), [SQLite backup](https://www.sqlite.org/backup.html), [Flask security](https://flask.palletsprojects.com/en/stable/web-security/), [OWASP CSV injection](https://community.owasp.org/attacks/CSV_Injection).

Validation results: 93 Python tests passed (including 24 new targeted security/recovery cases); static checks and installed-dependency consistency passed. The existing browser checkout/touch/print workflow passed 125 responsive screen checks. Passkey registration/login/removal/replay rejection passed with a virtual authenticator, including management layout at three screen widths. A separate older synthetic backup was upgraded successfully and its original SHA-256 remained unchanged. Extreme calculated amounts are rejected before database persistence, without changing valid-input pricing.
