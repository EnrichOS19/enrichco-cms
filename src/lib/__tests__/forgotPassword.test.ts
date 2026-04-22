/**
 * Story 6 — Forgot-password page copy tests.
 *
 * Since vitest runs in node environment (no jsdom), we can't render React
 * components. Instead we assert the source of the page includes the correct
 * copy strings and URL — a reliable proxy for "the copy is in the component".
 *
 * TDD: red first, then implement.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const PAGE_PATH = path.resolve(__dirname, "../../app/forgot-password/page.tsx");

function getPageSource(): string {
  return readFileSync(PAGE_PATH, "utf-8");
}

describe("forgot-password page copy", () => {
  it("references login.mangoforsalon.com in the source", () => {
    const src = getPageSource();
    expect(src).toContain("login.mangoforsalon.com");
  });

  it("contains a link to https://login.mangoforsalon.com", () => {
    const src = getPageSource();
    expect(src).toContain("https://login.mangoforsalon.com");
  });

  it("mentions resetting password at the POS login", () => {
    const src = getPageSource();
    // The copy should say something about resetting / coming back to log in here
    expect(src.toLowerCase()).toMatch(/reset|forgot/);
    expect(src).toContain("login.mangoforsalon.com");
  });

  it("does NOT include the old admin-contact flow (send reset link via email)", () => {
    const src = getPageSource();
    // The old CTA "Send Reset Link" should be gone
    expect(src).not.toContain("Send Reset Link");
  });

  it("does NOT call /api/auth/forgot-password (the form is replaced by a redirect link)", () => {
    const src = getPageSource();
    expect(src).not.toContain("/api/auth/forgot-password");
  });
});
