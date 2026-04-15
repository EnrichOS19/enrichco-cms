// cms/src/lib/template.ts
import fs from "fs";
import path from "path";
import crypto from "crypto";

export const TEMPLATE_DIR =
  process.env.TEMPLATE_DIR ||
  path.join(
    process.env.HOME || "/Users/aisquad",
    "salon-websites",
    "template",
    "components"
  );

/**
 * List all .tsx / .ts files in the shared template directory.
 */
export function listTemplateFiles(): string[] {
  if (!fs.existsSync(TEMPLATE_DIR)) return [];
  return fs
    .readdirSync(TEMPLATE_DIR)
    .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
}

/**
 * Compute SHA-256 of a template file's current content.
 * Returns null if the file doesn't exist.
 * Used for compare-and-swap writes.
 */
export function templateFileSha256(filename: string): string | null {
  const p = path.join(TEMPLATE_DIR, filename);
  if (!fs.existsSync(p)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

/**
 * Inject shared template components into a temp build directory.
 *
 * tmpDir must be an already-created copy of a salon site (e.g. /tmp/build-slug-ts/).
 * Only writes into tmpDir/src/components/ — the original siteDir is never touched.
 *
 * Override mechanism: if tmpDir/src/components/template-overrides.txt exists,
 * filenames listed there (one per line) are skipped — the site's own version wins.
 *
 * Returns list of injected filenames.
 */
export function injectToTempDir(tmpDir: string): string[] {
  const destDir = path.join(tmpDir, "src", "components");

  if (!fs.existsSync(TEMPLATE_DIR)) return [];
  if (!fs.existsSync(destDir)) return [];

  const overridesPath = path.join(destDir, "template-overrides.txt");
  const overrides = new Set<string>();
  if (fs.existsSync(overridesPath)) {
    fs.readFileSync(overridesPath, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((f) => overrides.add(f));
  }

  const injected: string[] = [];
  for (const file of listTemplateFiles()) {
    if (overrides.has(file)) continue;
    const src = path.join(TEMPLATE_DIR, file);
    const dest = path.join(destDir, file);
    fs.copyFileSync(src, dest);
    injected.push(file);
  }
  return injected;
}
