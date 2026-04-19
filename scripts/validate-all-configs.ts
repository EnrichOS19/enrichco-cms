/**
 * Dry-run validator — loads every salon.json and validates against Zod schema.
 * Reports pass/fail with exact errors. Used before and after schema/data fixes.
 *
 * Usage: cd ~/salon-websites/cms && npx tsx scripts/validate-all-configs.ts
 */

import fs from "fs";
import path from "path";
import { salonSchema, flattenZodErrors } from "../src/lib/schemas/salon";

const SITES_DIR = process.env.SITES_DIR || path.join(process.env.HOME || "/Users/aisquad", "salon-websites", "sites");

const dirs = fs.readdirSync(SITES_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith("_removed") && !d.name.startsWith("."));

let passed = 0;
let failed = 0;
const failures: { slug: string; errors: string[] }[] = [];

for (const dir of dirs) {
  const configPath = path.join(SITES_DIR, dir.name, "config", "salon.json");
  if (!fs.existsSync(configPath)) continue;

  const slug = dir.name.replace(/-website$/, "");

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const data = JSON.parse(raw);
    const result = salonSchema.safeParse(data);

    if (result.success) {
      passed++;
    } else {
      failed++;
      const errors = flattenZodErrors(result.error).map(
        (e) => `  ${e.path}: ${e.message}`
      );
      failures.push({ slug, errors });
    }
  } catch (e: unknown) {
    failed++;
    failures.push({ slug, errors: [`  JSON parse error: ${(e as Error).message}`] });
  }
}

const total = passed + failed;
console.log(`\n${"=".repeat(60)}`);
console.log(`VALIDATION RESULTS: ${passed}/${total} PASS, ${failed}/${total} FAIL`);
console.log(`${"=".repeat(60)}\n`);

if (failures.length > 0) {
  console.log("FAILURES:\n");
  for (const f of failures) {
    console.log(`  ${f.slug}:`);
    for (const e of f.errors) console.log(`    ${e}`);
    console.log();
  }
}

process.exit(failed > 0 ? 1 : 0);
