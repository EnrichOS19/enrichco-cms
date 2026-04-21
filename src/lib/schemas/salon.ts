import { z } from "zod";

const phoneRegex = /^[+()\-\s\d]{7,20}$/;
const zipRegex = /^[A-Za-z0-9\-\s]{3,12}$/;
const timeRegex = /^([0]?[1-9]|1[0-2]):[0-5]\d\s?(AM|PM)$/i;
const colorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/;

// Seed/placeholder sentinel values — onboarding scripts insert values like
// "VENUS_PLACEHOLDER" or "COMING_SOON" that are meant to be overwritten with
// real data before launch. If a salon.json field still contains one of these
// at save or publish time, we must block: otherwise fake URLs reach live
// users (e.g. Venus Nail Spa's booking iframe rendered `id=VENUS_PLACEHOLDER`
// and Mango returned "Store Not Exist").
//
// The pattern intentionally matches ONLY the exact onboarding sentinels —
// not natural-language words. Earlier broader tokens (`TODO`, `FIXME`,
// bare `COMING SOON` with a space) were rejected in code review because
// they would false-positive on legitimate salon copy: Spanish `todo`,
// English "new location coming soon", URL `?utm=todo`, etc. All sentinels
// below are all-caps compound strings that do not appear in real content.
//
//   *_PLACEHOLDER       — e.g. VENUS_PLACEHOLDER, BOUJEE_PLACEHOLDER
//   *_PLACEHOLDER_*     — suffix variants, e.g. VENUS_PLACEHOLDER_URL
//   REPLACE_ME          — generic onboarding marker
//   COMING_SOON         — with underscore (not the English phrase)
//   XXX_*               — dev-marker prefix
//
// The _PLACEHOLDER anchor allows:
//   - multi-word prefixes (FIZZ_WAXING_PLACEHOLDER — prefix class is
//     [A-Z0-9_]* so underscores in the name are fine)
//   - optional trailing `_SUFFIX` (VENUS_PLACEHOLDER_URL — `_` is a word
//     char, so a plain `\b` after PLACEHOLDER alone would miss these)
// The leading `[A-Z0-9]` (one required all-caps/digit char) prevents the
// pattern from matching the bare English word "placeholder".
export const PLACEHOLDER_PATTERN = /(\b[A-Z0-9][A-Z0-9_]*_PLACEHOLDER(?:_[A-Z0-9_]+)*\b|\bREPLACE_ME\b|\bCOMING_SOON\b|\bXXX_[A-Z0-9_]+)/;

// Flexible URL — accepts with or without protocol, or empty.
// Rejects placeholder sentinels so fake seeds can't get persisted.
const flexibleUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) => v === "" || !PLACEHOLDER_PATTERN.test(v),
    { message: "URL contains a placeholder sentinel (e.g. _PLACEHOLDER). Enter the real URL or leave blank." }
  )
  .optional()
  .or(z.literal(""));

// Price — accepts string, number, or empty. Coerces everything to string.
const flexiblePrice = z.preprocess(
  (val) => (val === null || val === undefined) ? "" : String(val),
  z.string().trim().max(100).optional().or(z.literal(""))
);

// Hours entry — open/close accept null (closed days), empty string, or time format
const hoursEntry = z.object({
  day: z.string().trim().min(1).max(20),
  open: z.preprocess(
    (v) => (v === null || v === undefined) ? "Closed" : String(v),
    z.string().trim().max(20)
  ),
  close: z.preprocess(
    (v) => (v === null || v === undefined) ? "Closed" : String(v),
    z.string().trim().max(20)
  ),
});

// Hours — accepts array or object format { Mon: { open, close } }
const hoursSchema = z.preprocess(
  (val) => {
    if (Array.isArray(val)) return val;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      // Convert object { Mon: { open, close } } to array
      return Object.entries(val as Record<string, unknown>).map(([day, times]) => {
        if (times && typeof times === "object") {
          const t = times as Record<string, unknown>;
          return { day, open: t.open ?? "Closed", close: t.close ?? "Closed" };
        }
        return { day, open: "Closed", close: "Closed" };
      });
    }
    return [];
  },
  z.array(hoursEntry).max(14, "Too many hours entries")
);

// About values — accepts string (split on newline) or string[]
const aboutValuesSchema = z.preprocess(
  (val) => {
    if (typeof val === "string") return val.split("\n").map(s => s.trim()).filter(Boolean);
    if (Array.isArray(val)) return val;
    return [];
  },
  z.array(z.string().trim().max(500)).max(30).optional()
);

// Address — accepts object or string
const addressSchema = z.preprocess(
  (val) => {
    if (typeof val === "string") {
      return { street: val, city: "", state: "", zip: "" };
    }
    return val;
  },
  z.object({
    street: z.string().trim().max(200).optional().or(z.literal("")),
    city: z.string().trim().max(120).optional().or(z.literal("")),
    state: z.string().trim().max(60).optional().or(z.literal("")),
    zip: z.string().trim().max(12).optional().or(z.literal("")),
    full: z.string().trim().max(300).optional().or(z.literal("")),
    googleMapsEmbed: z.string().trim().max(2000).optional().or(z.literal("")),
  })
);

export const serviceItemSchema = z.object({
  name: z.string().trim().min(1, "Service name is required").max(250),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  price: flexiblePrice,
  duration: z.preprocess(
    (val) => (val === null || val === undefined) ? "" : String(val),
    z.string().trim().max(50).optional().or(z.literal(""))
  ),
});

export const serviceCategorySchema = z.object({
  category: z.string().trim().min(1, "Category is required").max(120),
  subtitle: z.string().trim().max(160).optional().or(z.literal("")),
  icon: z.string().trim().max(80).optional().or(z.literal("")),
  image: z.string().trim().max(500).optional().or(z.literal("")),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  items: z.array(serviceItemSchema).max(200, "Too many service items"),
});

export const galleryImageSchema = z.object({
  src: z.string().trim().min(1, "Image URL is required").max(500),
  alt: z.string().trim().max(200).optional().or(z.literal("")),
});

export const salonSchema = z.object({
  name: z.string().trim().min(1, "Salon name is required").max(200),
  tagline: z.string().trim().max(300).optional().or(z.literal("")),
  description: z.string().trim().max(5000).optional().or(z.literal("")),
  address: addressSchema,
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  phoneRaw: z.string().trim().max(30).optional().or(z.literal("")),
  email: z.string().trim().max(254).optional().or(z.literal("")),
  hours: hoursSchema.optional(),
  social: z.object({
    facebook: flexibleUrl,
    instagram: flexibleUrl,
    yelp: flexibleUrl,
    google: flexibleUrl,
  }).optional(),
  booking: z.object({
    // Placeholder sentinels (e.g. "*_PLACEHOLDER") are rejected so fake
    // seeds from onboarding can't be persisted or published. Empty is
    // allowed — the site template renders a "booking coming soon" state
    // until a real URL is provided.
    url: z
      .string()
      .trim()
      .max(500)
      .refine(
        (v) => v === "" || !PLACEHOLDER_PATTERN.test(v),
        { message: "Booking URL is a placeholder (e.g. VENUS_PLACEHOLDER). Enter the real URL from Mango or leave blank." }
      )
      .optional()
      .or(z.literal("")),
    provider: z.string().trim().max(80).optional().or(z.literal("")),
    label: z.string().trim().max(100).optional().or(z.literal("")),
  }).optional(),
  branding: z.object({
    primaryColor: z.string().trim().regex(colorRegex, "Invalid color"),
    primaryLight: z.string().trim().regex(colorRegex, "Invalid color").optional().or(z.literal("")),
    primaryDark: z.string().trim().regex(colorRegex, "Invalid color").optional().or(z.literal("")),
    backgroundColor: z.string().trim().regex(colorRegex, "Invalid color").optional().or(z.literal("")),
    surfaceColor: z.string().trim().regex(colorRegex, "Invalid color").optional().or(z.literal("")),
    surfaceLight: z.string().trim().regex(colorRegex, "Invalid color").optional().or(z.literal("")),
    textColor: z.string().trim().regex(colorRegex, "Invalid color").optional().or(z.literal("")),
    textMuted: z.string().trim().regex(colorRegex, "Invalid color").optional().or(z.literal("")),
    accentColor: z.string().trim().regex(colorRegex, "Invalid color"),
    fontHeading: z.string().trim().max(120).optional().or(z.literal("")),
    fontBody: z.string().trim().max(120).optional().or(z.literal("")),
    logo: z.string().trim().max(500).optional().or(z.literal("")),
    logoHasName: z.boolean().optional(),
  }),
  meta: z.object({
    title: z.string().trim().max(300).optional().or(z.literal("")),
    description: z.string().trim().max(500).optional().or(z.literal("")),
    keywords: z.string().trim().max(500).optional().or(z.literal("")),
    ogImage: z.string().trim().max(500).optional().or(z.literal("")),
    url: flexibleUrl,
  }).optional(),
  about: z.object({
    welcome: z.string().trim().max(5000).optional().or(z.literal("")),
    mission: z.string().trim().max(5000).optional().or(z.literal("")),
    sanitation: z.string().trim().max(5000).optional().or(z.literal("")),
    values: aboutValuesSchema,
  }).optional(),
  services: z.array(serviceCategorySchema).max(100).optional(),
  gallery: z.array(galleryImageSchema).max(200).optional(),
  domain: z.string().trim().max(253).regex(domainRegex, "Invalid domain format").optional().or(z.literal("")),
  stagingDomain: z.string().trim().max(253).regex(domainRegex, "Invalid staging domain format").optional().or(z.literal("")),
  siteStatus: z.enum(["staging", "production"]).optional(),
  domainOwnership: z.enum(["enrichco", "client"]).optional(),
  websiteManager: z.enum(["ai-team", "marketing-team"]).optional(),
}).passthrough();

/**
 * Strict variant for salon_owner PUT requests.
 *
 * Protected fields (siteStatus, domain, stagingDomain, domainOwnership,
 * websiteManager, currentTemplate) are stripped by the route handler
 * BEFORE reaching this schema. This schema then rejects any remaining
 * unknown keys so no unexpected fields can sneak through.
 */
export const ownerSalonSchema = salonSchema
  .omit({
    siteStatus: true,
    domain: true,
    stagingDomain: true,
    domainOwnership: true,
    websiteManager: true,
  })
  .strict();

export type SalonInput = z.infer<typeof salonSchema>;
export type OwnerSalonInput = z.infer<typeof ownerSalonSchema>;

export function flattenZodErrors(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));
}
