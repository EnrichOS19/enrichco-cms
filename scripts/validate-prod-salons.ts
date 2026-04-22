/**
 * Validate all prod salon.json files pulled from mangotemplate-web-server.
 * Run: npx tsx scripts/validate-prod-salons.ts
 */
import fs from "fs";
import path from "path";
import { salonSchema } from "../src/lib/schemas/salon";

const DIR = "/tmp/prod-salons";
const entries = fs.readdirSync(DIR).filter((d) => fs.statSync(path.join(DIR, d)).isDirectory());

const ok: string[] = [];
const failures: { slug: string; errors: { path: string; message: string }[] }[] = [];

for (const slug of entries) {
  const p = path.join(DIR, slug, "salon.json");
  if (!fs.existsSync(p)) continue;
  let data: unknown;
  try { data = JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch (e) { failures.push({ slug, errors: [{ path: "(root)", message: `JSON: ${(e as Error).message}` }] }); continue; }
  const r = salonSchema.safeParse(data);
  if (r.success) ok.push(slug);
  else failures.push({
    slug,
    errors: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });
}

console.log(`\nPROD salons: ${entries.length} | PASS: ${ok.length} | FAIL: ${failures.length}\n`);
const pathCounts = new Map<string, number>();
for (const f of failures) for (const e of f.errors) pathCounts.set(e.path, (pathCounts.get(e.path) ?? 0) + 1);
console.log("Top failing paths:");
[...pathCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([p, c]) => console.log(`  ${c}x ${p}`));
console.log("\nFailing slugs:");
failures.forEach((f) => console.log(`  ${f.slug}: ${f.errors.length} err — ${f.errors[0].path}: ${f.errors[0].message.slice(0, 80)}`));
fs.writeFileSync("/tmp/prod-validation.json", JSON.stringify({ ok, failures }, null, 2));
