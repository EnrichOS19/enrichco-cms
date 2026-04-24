# CMS Deploy Toolkit

## Deploy CMS to production

```bash
./scripts/deploy-cms.sh
```

That is the only deploy path. Do not use `deploy-gcp.sh`, direct `gcloud scp`, or manual `systemctl` commands.

**What it does (in order):**

1. Runs `npm run build` — fails fast if build breaks
2. Verifies `.next/standalone/`, `.next/static/`, and `.next/BUILD_ID` all exist
3. Creates a clean tarball excluding macOS junk (`._*`) and pre-built `.node` binaries
4. Uploads to the server via `gcloud compute scp --tunnel-through-iap` (retries once)
5. On server: backs up current deploy → extracts new build → copies `.next/static/` into `standalone/.next/static/` (the step that caused today's outage) → runs `npm rebuild better-sqlite3` → verifies the `.node` binary is Linux x86-64 ELF → restarts `enrich-cms.service` → checks logs for errors
6. Runs `smoke-cms.sh` — if any check fails, auto-rollback kicks in and the script exits non-zero
7. Prints BUILD_ID, deploy timestamp, and smoke result

---

## Smoke-test without deploying

```bash
./scripts/smoke-cms.sh
```

Tests `https://cms.enrichco.us` from an end-user perspective. Runs six checks:

| Check | Expected |
|-------|----------|
| `/api/health` | 200 `{"status":"ok","db":"ok"}` |
| `/login` | 200 HTML |
| `/api/salons` | 401 (auth-gated) |
| Home page has `_next/static` CSS + CSS URL loads | 200 |
| `_next/static` JS chunk loads | 200 |
| `/api/salon/vanity-nails-spa` | 401 or 404 |

Exit 0 = all pass. Exit 1 = any fail.

Override the base URL for staging:
```bash
SMOKE_BASE_URL=https://staging.enrichco.us ./scripts/smoke-cms.sh
```

---

## Validate salon schemas against the fleet

```bash
./scripts/validate-all-salons.sh
```

Connects to `mangotemplate-web-server` via gcloud IAP, pulls every `salon.json`, and validates each one against `src/lib/schemas/salon.ts`. Reports any failures with field-level error paths.

Run against local sites instead:
```bash
SITES_DIR=/Users/aisquad/salon-websites/sites ./scripts/validate-all-salons.sh
```

Run this before any deploy that changes the schema. Exit 0 = all pass, exit 1 = failures.

---

## Contract

**Never deploy via any other path.** The scripts encode the two hard lessons from today:

- `.next/static/` MUST be copied inside `standalone/` — Next.js standalone does not serve static assets unless they are at `standalone/.next/static/`
- `better-sqlite3` MUST be rebuilt on the server — a Mac-compiled `.node` binary is ARM Mach-O, not Linux x86-64 ELF, and will crash silently on startup

Both checks are enforced and will abort (and auto-rollback) if violated.

---

## If smoke fails (auto-rollback happened)

1. The script already rolled back to the previous deploy and restarted the service
2. Check the journal: `gcloud compute ssh aisquad@mangotemplate-web-server --zone=us-east1-c --project=mangoforsalon-97743 --tunnel-through-iap --command="sudo journalctl -u enrich-cms -n 100 --no-pager"`
3. Fix the issue locally
4. Re-run `./scripts/deploy-cms.sh`

Do not manually restart the service or push files — use the script.
