import { describe, it, expect } from "vitest";
import { assertNoPlaceholders } from "../publish";
import { PLACEHOLDER_PATTERN, salonSchema } from "../schemas/salon";

const baseSalon = {
  name: "Venus Nail Spa",
  tagline: "Best nails",
  address: { street: "1 Main", city: "Spring", state: "TX", zip: "77388" },
  branding: { primaryColor: "#000000", accentColor: "#ffffff" },
};

describe("assertNoPlaceholders — walks salon.json for seed sentinels", () => {
  it("passes on a clean salon.json (no placeholder strings)", () => {
    expect(() =>
      assertNoPlaceholders({
        booking: { url: "https://manage2.mangoforsalon.com/booking?id=abc123" },
      })
    ).not.toThrow();
  });

  it("throws on VENUS_PLACEHOLDER booking url (today's bug)", () => {
    expect(() =>
      assertNoPlaceholders({
        booking: { url: "https://manage2.mangoforsalon.com/booking?id=VENUS_PLACEHOLDER" },
      })
    ).toThrow(/booking\.url.*VENUS_PLACEHOLDER/);
  });

  it("throws on any nested string field containing a placeholder", () => {
    expect(() =>
      assertNoPlaceholders({ social: { instagram: "https://instagram.com/COMING_SOON" } })
    ).toThrow(/social\.instagram/);
  });

  it("reports the full field path on failure so support knows where to fix", () => {
    try {
      assertNoPlaceholders({
        services: [{ items: [{ name: "Pedi", price: "REPLACE_ME" }] }],
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("services.0.items.0.price");
    }
  });

  it("ignores arrays of clean data", () => {
    expect(() =>
      assertNoPlaceholders({ services: [{ name: "x" }, { name: "y" }] })
    ).not.toThrow();
  });

  it("catches XXX_ prefix sentinels (dev markers)", () => {
    expect(() =>
      assertNoPlaceholders({ about: { founderStory: "XXX_PASTE_REAL_STORY" } })
    ).toThrow(/about\.founderStory/);
  });

  // Anti-false-positive tests — per code review, PLACEHOLDER_PATTERN was
  // tightened to avoid matching legitimate content that happens to include
  // common English words. These cases MUST NOT throw.
  it("does NOT reject Spanish 'todo' (it's a common word, case-insensitive)", () => {
    expect(() =>
      assertNoPlaceholders({ tagline: "Todo para tus uñas" })
    ).not.toThrow();
  });

  it("does NOT reject English 'coming soon' phrases (only the underscore sentinel)", () => {
    expect(() =>
      assertNoPlaceholders({ popup: { text: "New location coming soon!" } })
    ).not.toThrow();
  });

  it("does NOT reject URLs with ?utm=todo or similar legitimate query params", () => {
    expect(() =>
      assertNoPlaceholders({ social: { instagram: "https://instagram.com/salon?utm=todo_list" } })
    ).not.toThrow();
  });

  it("does NOT reject descriptive text containing the word 'todo' (e.g. 'Things todo at spa')", () => {
    expect(() =>
      assertNoPlaceholders({ about: { description: "Things todo while you wait" } })
    ).not.toThrow();
  });
});

describe("PLACEHOLDER_PATTERN regex", () => {
  it("matches real-world salon seeds we've seen in production", () => {
    const seeds = [
      "VENUS_PLACEHOLDER",
      "BOUJEE_PLACEHOLDER",
      "ELIFE_PLACEHOLDER",
      "FIZZ_WAXING_PLACEHOLDER",
      "NAPLES_PLACEHOLDER",
      "BEALETON_PLACEHOLDER",
      "SPANAILS_PLACEHOLDER",
      "VALENTINO_PLACEHOLDER",
    ];
    for (const seed of seeds) {
      expect(PLACEHOLDER_PATTERN.test(seed)).toBe(true);
    }
  });

  it("does NOT match legitimate values containing common words", () => {
    // "placeholder" alone isn't the sentinel — only compound forms are.
    expect(PLACEHOLDER_PATTERN.test("This is a placeholder")).toBe(false);
    // Natural-language "coming soon" (with space) is legitimate site copy.
    expect(PLACEHOLDER_PATTERN.test("Coming soon in 2026")).toBe(false);
    // Bare "todo" / "TODO" is Spanish/English common-word or generic list
    // marker — not a specific sentinel.
    expect(PLACEHOLDER_PATTERN.test("Todo para tus uñas")).toBe(false);
    expect(PLACEHOLDER_PATTERN.test("TODO list for spa staff")).toBe(false);
    // Bare "FIXME" and "REPLACE" without the underscore sentinel shouldn't match.
    expect(PLACEHOLDER_PATTERN.test("Fix me up with a mani")).toBe(false);
  });

  it("DOES match the exact onboarding sentinels (underscore-joined, all-caps)", () => {
    expect(PLACEHOLDER_PATTERN.test("COMING_SOON")).toBe(true);
    expect(PLACEHOLDER_PATTERN.test("REPLACE_ME")).toBe(true);
    expect(PLACEHOLDER_PATTERN.test("XXX_TEMPLATE")).toBe(true);
    expect(PLACEHOLDER_PATTERN.test("id=VENUS_PLACEHOLDER")).toBe(true);
  });
});

describe("salonSchema rejects placeholder values on save", () => {
  it("rejects booking.url containing a _PLACEHOLDER sentinel", () => {
    const result = salonSchema.safeParse({
      ...baseSalon,
      booking: { url: "https://manage2.mangoforsalon.com/booking?id=VENUS_PLACEHOLDER" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain("placeholder");
    }
  });

  it("accepts booking.url that's a real URL", () => {
    const result = salonSchema.safeParse({
      ...baseSalon,
      booking: { url: "https://manage2.mangoforsalon.com/booking?id=JQzVreCMYKtIZ9rBGWZPSw==" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts booking.url empty (site will render 'booking coming soon' state)", () => {
    const result = salonSchema.safeParse({ ...baseSalon, booking: { url: "" } });
    expect(result.success).toBe(true);
  });

  it("rejects any flexibleUrl field (social.instagram etc.) with a sentinel", () => {
    // XXX_ prefix is a dev-marker sentinel and always rejected.
    const result = salonSchema.safeParse({
      ...baseSalon,
      social: { instagram: "https://instagram.com/XXX_SALON_HANDLE" },
    });
    expect(result.success).toBe(false);
  });

  it("silently drops the deprecated booking.placeholder boolean field", () => {
    // Old salon.json files carry placeholder: true. Schema no longer has
    // that field; nested z.object strips unknown keys by default, so PUT
    // succeeds and the field is removed from the persisted JSON.
    const result = salonSchema.safeParse({
      ...baseSalon,
      booking: {
        url: "https://real.example.com/booking",
        placeholder: true,
      } as unknown,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data.booking as Record<string, unknown>)?.placeholder).toBeUndefined();
    }
  });
});
