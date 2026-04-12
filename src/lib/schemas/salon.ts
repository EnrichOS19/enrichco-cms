import { z } from "zod";

const phoneRegex = /^[+()\-\s\d]{7,20}$/;
const zipRegex = /^[A-Za-z0-9\-\s]{3,12}$/;
const timeRegex = /^([0]?[1-9]|1[0-2]):[0-5]\d\s?(AM|PM)$/i;
const colorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const priceRegex = /^(\$?\d+(\.\d{1,2})?|[A-Za-z].*)$/;

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .optional()
  .or(z.literal(""))
  .refine((value) => {
    if (!value) return true;
    return /^https?:\/\//i.test(value);
  }, "Must be a valid URL starting with http:// or https://");

export const serviceItemSchema = z.object({
  name: z.string().trim().min(1, "Service name is required").max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  price: z.string().trim().min(1, "Price is required").max(50).regex(priceRegex, "Invalid price format"),
  duration: z.string().trim().max(50).optional().or(z.literal("")),
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
  alt: z.string().trim().min(1, "Alt text is required").max(200),
});

export const salonSchema = z.object({
  name: z.string().trim().min(1, "Salon name is required").max(120),
  tagline: z.string().trim().max(160),
  description: z.string().trim().max(3000),
  address: z.object({
    street: z.string().trim().min(1, "Street is required").max(200),
    city: z.string().trim().min(1, "City is required").max(120),
    state: z.string().trim().min(2, "State is required").max(60),
    zip: z.string().trim().min(3).max(12).regex(zipRegex, "Invalid ZIP/postal code"),
    full: z.string().trim().max(300),
    googleMapsEmbed: z.string().trim().max(2000).optional().or(z.literal("")),
  }),
  phone: z.string().trim().min(7).max(20).regex(phoneRegex, "Invalid phone number"),
  phoneRaw: z.string().trim().max(20).optional().or(z.literal("")),
  email: z.string().trim().email("Invalid email address").max(254),
  hours: z
    .array(
      z.object({
        day: z.string().trim().min(1).max(20),
        open: z.string().trim().min(1).max(20).refine((v) => v.toLowerCase() === "closed" || timeRegex.test(v), "Invalid open time format"),
        close: z.string().trim().min(1).max(20).refine((v) => v.toLowerCase() === "closed" || timeRegex.test(v), "Invalid close time format"),
      })
    )
    .max(14, "Too many hours entries"),
  social: z.object({
    facebook: optionalUrl,
    instagram: optionalUrl,
    yelp: optionalUrl,
    google: optionalUrl,
  }),
  booking: z.object({
    url: z.string().trim().min(1, "Booking URL is required").max(500).url("Invalid booking URL"),
    provider: z.string().trim().max(80).optional().or(z.literal("")),
    placeholder: z.boolean().optional(),
  }),
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
  }),
  meta: z.object({
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().min(1).max(320),
    keywords: z.string().trim().max(500).optional().or(z.literal("")),
    ogImage: z.string().trim().max(500).optional().or(z.literal("")),
    url: optionalUrl,
  }),
  about: z
    .object({
      welcome: z.string().trim().max(2000).optional().or(z.literal("")),
      mission: z.string().trim().max(2000).optional().or(z.literal("")),
      sanitation: z.string().trim().max(2000).optional().or(z.literal("")),
      values: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
    })
    .optional(),
  services: z.array(serviceCategorySchema).max(100, "Too many service categories"),
  gallery: z.array(galleryImageSchema).max(200, "Too many gallery images"),
  // Phase 3A: domain for publish pipeline routing
  domain: z.string().trim().max(253).optional().or(z.literal("")),
});

export type SalonInput = z.infer<typeof salonSchema>;

export function flattenZodErrors(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));
}
