export interface SalonHours {
  day: string;
  open: string;
  close: string;
}

export interface ServiceItem {
  name: string;
  description?: string;
  price: string;
  duration?: string;
}

export interface ServiceCategory {
  category: string;
  subtitle?: string;
  icon?: string;
  image?: string;
  description?: string;
  items: ServiceItem[];
}

export interface GalleryImage {
  src: string;
  alt: string;
}

export interface SalonConfig {
  name: string;
  tagline: string;
  description: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
    full: string;
    googleMapsEmbed?: string;
  };
  phone: string;
  phoneRaw?: string;
  email: string;
  hours: SalonHours[];
  social: {
    facebook?: string;
    instagram?: string;
    yelp?: string;
    google?: string;
  };
  booking: {
    url: string;
    provider?: string;
    placeholder?: boolean;
  };
  branding: {
    primaryColor: string;
    primaryLight?: string;
    primaryDark?: string;
    backgroundColor?: string;
    surfaceColor?: string;
    surfaceLight?: string;
    textColor?: string;
    textMuted?: string;
    accentColor: string;
    fontHeading?: string;
    fontBody?: string;
  };
  meta: {
    title: string;
    description: string;
    keywords?: string;
    ogImage?: string;
    url?: string;
  };
  about?: {
    welcome?: string;
    mission?: string;
    sanitation?: string;
    values?: string[];
  };
  services: ServiceCategory[];
  gallery: GalleryImage[];
  [key: string]: unknown;
}

export interface SalonSummary {
  slug: string;
  name: string;
  city: string;
  state: string;
  status: "Demo Ready" | "Approved" | "New";
  phone: string;
  serviceCount: number;
  galleryCount: number;
  dirName: string;
}
