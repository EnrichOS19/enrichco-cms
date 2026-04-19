/**
 * Validate every salon config against the current Zod schema.
 * Produces a real failure list — not the April 14 taxonomy that may be stale.
 *
 * Run with: CMS_AUTH_DISABLED=true npx tsx scripts/validate-all-salons.ts
 */
import fs from "fs";
import path from "path";
import { salonSchema } from "../src/lib/schemas/salon";

const SITES_DIR = process.env.SITES_DIR || "/Users/aisquad/salon-websites/sites";

type Failure = {
  slug: string;
  errors: Array<{ path: string; message: string; received?: unknown }>;
};

const sites = fs
  .readdirSync(SITES_DIR)
  .filter((d) => !d.startsWith("_") && !d.startsWith("."))
  .filter((d) => fs.statSync(path.join(SITES_DIR, d)).isDirectory());

const ok: string[] = [];
const failures: Failure[] = [];
const missingConfig: string[] = [];

for (const slug of sites) {
  const configPath = path.join(SITES_DIR, slug, "config", "salon.json");
  if (!fs.existsSync(configPath)) {
    // Try alt naming: some dirs include -website suffix
    const altPath = path.join(
      SITES_DIR,
      slug.endsWith("-website") ? slug : `${slug}-website`,
      "config",
      "salon.json"
    );
    if (fs.existsSync(altPath)) {
      validateOne(slug, altPath);
      continue;
    }
    missingConfig.push(slug);
    continue;
  }
  validateOne(slug, configPath);
}

function validateOne(slug: string, configPath: string) {
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (e) {
    failures.push({
      slug,
      errors: [{ path: "(root)", message: `JSON parse error: ${(e as Error).message}` }],
    });
    return;
  }
  const result = salonSchema.safeParse(data);
  if (result.success) {
    ok.push(slug);
  } else {
    failures.push({
      slug,
      errors: result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
        received: "received" in i ? (i as { received: unknown }).received : undefined,
      })),
    });
  }
}

// Report
console.log(`\n=== Salon Validation Report ===`);
console.log(`Total sites: ${sites.length}`);
console.log(`Passing:    ${ok.length}`);
console.log(`Failing:    ${failures.length}`);
console.log(`No config:  ${missingConfig.length}\n`);

// Aggregate failure patterns
const pathCounts = new Map<string, number>();
const messageCounts = new Map<string, number>();
for (const f of failures) {
  for (const e of f.errors) {
    pathCounts.set(e.path, (pathCounts.get(e.path) ?? 0) + 1);
    messageCounts.set(e.message, (messageCounts.get(e.message) ?? 0) + 1);
  }
}

console.log(`=== Top failing paths ===`);
[...pathCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .forEach(([p, c]) => console.log(`  ${c.toString().padStart(3)}x  ${p}`));

console.log(`\n=== Top error messages ===`);
[...messageCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .forEach(([m, c]) => console.log(`  ${c.toString().padStart(3)}x  ${m.slice(0, 100)}`));

// Write full per-salon report
const outPath = "/tmp/salon-validation-report.json";
fs.writeFileSync(
  outPath,
  JSON.stringify({ ok, failures, missingConfig }, null, 2)
);
console.log(`\nFull report: ${outPath}`);

if (missingConfig.length > 0) {
  console.log(`\n=== Sites with no salon.json ===`);
  missingConfig.slice(0, 10).forEach((s) => console.log(`  ${s}`));
  if (missingConfig.length > 10) console.log(`  ... and ${missingConfig.length - 10} more`);
}
