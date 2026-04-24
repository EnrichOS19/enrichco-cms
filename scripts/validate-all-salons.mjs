#!/usr/bin/env node
/**
 * validate-all-salons.mjs
 *
 * Schema-validates every salon.json from the prod server (or locally).
 * Called by validate-all-salons.sh.
 *
 * Modes:
 *   Remote (default): SSH to prod via gcloud IAP and pull all salon.json files
 *   Local:            SITES_DIR=/path/to/sites node scripts/validate-all-salons.mjs
 *
 * Each salon.json is validated by _salon-schema-runner.ts via `npx tsx`.
 *
 * Exit 0 = all salons pass
 * Exit 1 = one or more salons fail
 * Exit 2 = infrastructure error (SSH failed, tsx not found, etc.)
 */

import { execSync } from "child_process";
import { writeFileSync, unlinkSync, readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..");
const RUNNER = join(__dirname, "_salon-schema-runner.ts");

const GCP_PROJECT  = process.env.GCP_PROJECT  || "mangoforsalon-97743";
const GCP_ZONE     = process.env.GCP_ZONE     || "us-east1-c";
const GCP_INSTANCE = process.env.GCP_INSTANCE || "mangotemplate-web-server";
const REMOTE_SITES = "/opt/enrich-cms/sites";
const SITES_DIR    = process.env.SITES_DIR    || null;

process.on("SIGINT", () => process.exit(1));

// Check tsx is available
try {
  execSync("npx tsx --version", { cwd: REPO_ROOT, stdio: "pipe" });
} catch {
  console.error("ERROR: tsx not found. Run: npm install --save-dev tsx");
  process.exit(2);
}

// ── validate a single JSON string against the schema via runner script ────────
const TMP_JSON = `/tmp/_salon_validate_${process.pid}.json`;

function validateJson(jsonStr) {
  writeFileSync(TMP_JSON, jsonStr, "utf-8");
  try {
    const result = execSync(
      `npx tsx "${RUNNER}" "${TMP_JSON}"`,
      {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        timeout: 20000,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    return JSON.parse(result.trim());
  } catch (e) {
    const out = (e.stdout || "").trim();
    try { return JSON.parse(out); } catch {}
    return {
      ok: false,
      errors: [{ path: "(process)", message: `tsx crashed: ${(e.stderr || e.message || "").slice(0, 300)}` }]
    };
  } finally {
    try { unlinkSync(TMP_JSON); } catch {}
  }
}

// ── collect salon entries ─────────────────────────────────────────────────────
let salonEntries = []; // [{ slug, jsonStr }]

if (SITES_DIR) {
  console.error(`[validate] Local mode: ${SITES_DIR}`);
  const dirs = readdirSync(SITES_DIR)
    .filter(d => !d.startsWith("_") && !d.startsWith("."))
    .filter(d => { try { return statSync(join(SITES_DIR, d)).isDirectory(); } catch { return false; } });

  for (const slug of dirs) {
    const cfgPath = join(SITES_DIR, slug, "config", "salon.json");
    if (!existsSync(cfgPath)) continue;
    try {
      salonEntries.push({ slug, jsonStr: readFileSync(cfgPath, "utf-8") });
    } catch (e) {
      salonEntries.push({ slug, jsonStr: null, readError: e.message });
    }
  }
} else {
  console.error(`[validate] Remote mode: ${GCP_INSTANCE}:${REMOTE_SITES}`);
  let raw;
  try {
    raw = execSync(
      `gcloud compute ssh aisquad@${GCP_INSTANCE} \
        --zone=${GCP_ZONE} \
        --project=${GCP_PROJECT} \
        --tunnel-through-iap \
        --strict-host-key-checking=yes \
        --command="for f in ${REMOTE_SITES}/*/config/salon.json; do \
          slug=\\$(echo \\$f | sed 's|${REMOTE_SITES}/||' | cut -d/ -f1); \
          echo \\"---SALON:\\$slug\\"; \
          cat \\"\\$f\\"; \
          echo; \
        done"`,
      { encoding: "utf-8", timeout: 120000 }
    );
  } catch (e) {
    console.error("ERROR: gcloud SSH failed:", (e.message || "").slice(0, 300));
    process.exit(2);
  }

  // Each block: "---SALON:<slug>\n<json>\n"
  const blocks = raw.split(/^---SALON:/m).slice(1);
  for (const block of blocks) {
    const nl = block.indexOf("\n");
    if (nl === -1) continue;
    const slug = block.slice(0, nl).trim();
    const jsonStr = block.slice(nl + 1).trim();
    if (slug) salonEntries.push({ slug, jsonStr: jsonStr || null });
  }
}

// ── run validation ────────────────────────────────────────────────────────────
const ok = [];
const failures = [];
const noConfig = [];

console.error(`[validate] Validating ${salonEntries.length} salons…`);

for (const entry of salonEntries) {
  const { slug } = entry;

  if (!entry.jsonStr) {
    noConfig.push(slug);
    continue;
  }

  // Quick JSON parse sanity check
  try {
    JSON.parse(entry.jsonStr);
  } catch (e) {
    failures.push({ slug, errors: [{ path: "(root)", message: `JSON parse error: ${e.message}` }] });
    continue;
  }

  const result = validateJson(entry.jsonStr);
  if (result.ok) {
    ok.push(slug);
  } else {
    failures.push({ slug, errors: result.errors });
  }
}

// ── report ────────────────────────────────────────────────────────────────────
const total = ok.length + failures.length + noConfig.length;

console.log("");
console.log("=== Salon Schema Validation Report ===");
console.log(`  Total salons:   ${total}`);
console.log(`  Passing:        ${ok.length}`);
console.log(`  Failing:        ${failures.length}`);
console.log(`  No salon.json:  ${noConfig.length}`);
console.log("");

if (noConfig.length > 0) {
  console.log("--- Salons with no salon.json ---");
  noConfig.forEach(s => console.log(`  ${s}`));
  console.log("");
}

if (failures.length > 0) {
  console.log("--- Failing salons ---");
  for (const f of failures) {
    console.log(`\n  [${f.slug}]`);
    for (const e of f.errors) {
      console.log(`    .${e.path}: ${e.message}`);
    }
  }
  console.log("");

  // Aggregate top failing fields
  const pathCounts = new Map();
  for (const f of failures) {
    for (const e of f.errors) {
      pathCounts.set(e.path, (pathCounts.get(e.path) ?? 0) + 1);
    }
  }
  if (pathCounts.size > 0) {
    console.log("--- Top failing fields ---");
    [...pathCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .forEach(([p, c]) => console.log(`  ${String(c).padStart(3)}x  ${p}`));
    console.log("");
  }
}

if (failures.length === 0 && noConfig.length === 0) {
  console.log(`All ${ok.length} salons PASS schema validation.`);
  process.exit(0);
} else {
  process.exit(1);
}
