/**
 * _salon-schema-runner.ts
 *
 * Internal helper called by validate-all-salons.mjs.
 * Reads one salon.json path from argv[2], validates against salonSchema,
 * prints JSON result to stdout.
 *
 * Usage: npx tsx scripts/_salon-schema-runner.ts /path/to/salon.json
 */
import { readFileSync } from "fs";
import { salonSchema } from "../src/lib/schemas/salon";

const filePath = process.argv[2];
if (!filePath) {
  process.stdout.write(JSON.stringify({ ok: false, errors: [{ path: "(args)", message: "No file path provided" }] }));
  process.exit(1);
}

let raw: string;
try {
  raw = readFileSync(filePath, "utf-8");
} catch (e: unknown) {
  process.stdout.write(JSON.stringify({ ok: false, errors: [{ path: "(read)", message: String(e) }] }));
  process.exit(1);
}

let input: unknown;
try {
  input = JSON.parse(raw);
} catch (e: unknown) {
  process.stdout.write(JSON.stringify({ ok: false, errors: [{ path: "(root)", message: `JSON parse error: ${String(e)}` }] }));
  process.exit(1);
}

const result = salonSchema.safeParse(input);
if (result.success) {
  process.stdout.write(JSON.stringify({ ok: true }));
} else {
  process.stdout.write(JSON.stringify({
    ok: false,
    errors: result.error.issues.map(i => ({
      path: i.path.join(".") || "(root)",
      message: i.message,
    }))
  }));
}
