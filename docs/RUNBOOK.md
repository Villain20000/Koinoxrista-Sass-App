# Disaster Recovery Runbook

> Objective: **RPO ≤ 24h** (nightly dumps, see `.github/workflows/backup.yml`) and
> **RTO ≤ 2h** (restore + smoke test below). Backups live in S3-compatible object
> storage with SSE-KMS, versioning enabled, 30-day retention.

## 1. Nightly backups

- `.github/workflows/backup.yml` dumps Postgres (`pg_dump --format=custom`) every day
  at 02:30 UTC to `s3://<bucket>/pg/YYYY/MM/`.
- Retention: automatic purge of objects older than 30 days.
- **Defense in depth**: the `transfer` module also exports per-building JSON; enable
  the scheduled monthly export in production for every active building.

### Required secrets / vars

| Secret / Var | Purpose |
|---|---|
| `BACKUP_DATABASE_URL` | Read replica or primary connection string (never the app env) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Object-storage credentials |
| `BACKUP_S3_BUCKET` (var) | Bucket name |
| `BACKUP_S3_ENDPOINT` (var) | Endpoint for MinIO/S3-compatible storage (default AWS) |

## 2. Restore drill (execute at least quarterly)

Target: restore the latest dump to a **scratch database**, run current migrations,
boot the API against it, and smoke-test login + invoice listing. Never restore over
the live database without an explicit go/no-go.

```bash
# 0) Prereqs
createdb polyos-restore

# 1) Restore the dump
pg_restore --dbname=polyos-restore ./latest.dump

# 2) Apply any migrations newer than the dump
DATABASE_URL="postgresql://user:pass@localhost:5432/polyos-restore" \
  pnpm exec prisma migrate deploy --schema=apps/api/prisma/schema.prisma

# 3) Boot the API against scratch DB
DATABASE_URL="postgresql://user:pass@localhost:5432/polyos-restore" \
  PORT=3001 pnpm nx run api:serve:development
```

### Smoke test
1. `POST /api/auth/login` with a known admin → expect `200` + `accessToken`.
2. `GET /api/buildings/:buildingId/invoices` with that token → expect `200` + rows.
3. `GET /api/health` → expect `{ status: 'ok' }` with db ping.

## 3. Incident reference

- **Lost DB volume** → restore from latest dump (RPO ≤ 24h), apply migrations, smoke test.
- **Corrupt/missing recent data** → recover from nightly snapshot; verify with the
  transfer-module per-building JSON exports as fallback.
- **No backup for N days** → treat as priority incident; fix scheduling first, then restore
  from the newest available dump and reconcile manually.

## 4. Verification checklist

- [ ] Backup job green for 7 consecutive days.
- [ ] Restore drill executed at least quarterly and logged.
- [ ] Scratch-DB smoke test (login + invoice list) passes.
- [ ] RPO/RTO documented and communicated to stakeholders.