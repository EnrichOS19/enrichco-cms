"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface SalonConfig {
  name?: string;
  tagline?: string;
  description?: string;
  phone?: string;
  email?: string;
  address?: { street?: string; city?: string; state?: string; zip?: string };
  hours?: { day: string; open: string; close: string }[];
  services?: { category: string; items: { name: string; description?: string; price?: string }[] }[];
  gallery?: { src: string; alt?: string }[];
  booking?: { url?: string };
  social?: { facebook?: string; instagram?: string; yelp?: string; google?: string };
  branding?: { primaryColor: string; accentColor: string; backgroundColor?: string; textColor?: string; fontHeading?: string; fontBody?: string };
  about?: { welcome?: string; mission?: string };
  meta?: { title?: string; description?: string };
  [key: string]: unknown;
}

export default function PreviewPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [config, setConfig] = useState<SalonConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check localStorage for preview data (passed from editor)
    const previewData = sessionStorage.getItem(`preview-${slug}`);
    if (previewData) {
      try {
        setConfig(JSON.parse(previewData));
        setLoading(false);
        return;
      } catch {}
    }

    // Fallback: fetch from API
    fetch(`/api/salon/${slug}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setConfig(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#000", color: "#fff", fontFamily: "system-ui" }}>
        Loading preview...
      </div>
    );
  }

  if (!config) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#000", color: "#fff", fontFamily: "system-ui" }}>
        Salon not found
      </div>
    );
  }

  const b = config.branding || { primaryColor: "#8B5CF6", accentColor: "#F59E0B" };
  const primary = b.primaryColor || "#8B5CF6";
  const accent = b.accentColor || "#F59E0B";
  const bg = b.backgroundColor || "#ffffff";
  const text = b.textColor || "#1a1a1a";
  const headingFont = b.fontHeading || "Georgia, serif";
  const bodyFont = b.fontBody || "system-ui, sans-serif";

  return (
    <div style={{ background: bg, color: text, fontFamily: bodyFont, minHeight: "100vh" }}>
      {/* Preview banner */}
      <div style={{ background: "#111", color: "#fff", padding: "8px 16px", fontSize: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 100 }}>
        <span>Preview Mode — This is how your changes will look. Changes are NOT published yet.</span>
        <button onClick={() => window.close()} style={{ background: primary, color: "#fff", border: "none", padding: "4px 12px", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}>
          Close Preview
        </button>
      </div>

      {/* Hero */}
      <div style={{ background: `linear-gradient(135deg, ${primary}, ${primary}dd)`, color: "#fff", padding: "80px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: headingFont, fontSize: "42px", fontWeight: 700, marginBottom: "12px" }}>
          {config.name || "Salon Name"}
        </h1>
        <p style={{ fontSize: "18px", opacity: 0.9 }}>{config.tagline || ""}</p>
        {config.booking?.url && (
          <a href={config.booking.url} target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-block", marginTop: "24px", background: accent, color: "#fff", padding: "12px 32px", borderRadius: "8px", textDecoration: "none", fontWeight: 600, fontSize: "16px" }}>
            Book Now
          </a>
        )}
      </div>

      {/* About */}
      {(config.description || config.about?.welcome) && (
        <div style={{ maxWidth: "800px", margin: "0 auto", padding: "60px 24px" }}>
          <h2 style={{ fontFamily: headingFont, fontSize: "28px", marginBottom: "16px", color: primary }}>About Us</h2>
          <p style={{ lineHeight: 1.7, fontSize: "16px" }}>{config.about?.welcome || config.description}</p>
          {config.about?.mission && (
            <p style={{ lineHeight: 1.7, fontSize: "16px", marginTop: "16px" }}>{config.about.mission}</p>
          )}
        </div>
      )}

      {/* Services */}
      {config.services && config.services.length > 0 && (
        <div style={{ background: "#f9f9f9", padding: "60px 24px" }}>
          <div style={{ maxWidth: "800px", margin: "0 auto" }}>
            <h2 style={{ fontFamily: headingFont, fontSize: "28px", marginBottom: "32px", color: primary, textAlign: "center" }}>Our Services</h2>
            {config.services.map((cat, i) => (
              <div key={i} style={{ marginBottom: "32px" }}>
                <h3 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "12px", borderBottom: `2px solid ${primary}`, paddingBottom: "8px" }}>
                  {cat.category}
                </h3>
                <div style={{ display: "grid", gap: "8px" }}>
                  {cat.items?.map((item, j) => (
                    <div key={j} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #eee" }}>
                      <div>
                        <span style={{ fontWeight: 500 }}>{item.name}</span>
                        {item.description && <span style={{ color: "#666", fontSize: "14px", marginLeft: "8px" }}>{item.description}</span>}
                      </div>
                      {item.price && <span style={{ fontWeight: 600, color: primary }}>{item.price}</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Gallery */}
      {config.gallery && config.gallery.length > 0 && (
        <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "60px 24px" }}>
          <h2 style={{ fontFamily: headingFont, fontSize: "28px", marginBottom: "32px", color: primary, textAlign: "center" }}>Gallery</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px" }}>
            {config.gallery.slice(0, 12).map((img, i) => (
              <div key={i} style={{ borderRadius: "8px", overflow: "hidden", aspectRatio: "1", background: "#eee" }}>
                <img
                  src={img.src}
                  alt={img.alt || config.name || ""}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hours */}
      {config.hours && config.hours.length > 0 && (
        <div style={{ background: "#f9f9f9", padding: "60px 24px" }}>
          <div style={{ maxWidth: "500px", margin: "0 auto" }}>
            <h2 style={{ fontFamily: headingFont, fontSize: "28px", marginBottom: "24px", color: primary, textAlign: "center" }}>Hours</h2>
            {config.hours.map((h, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #eee" }}>
                <span style={{ fontWeight: 500 }}>{h.day}</span>
                <span>{h.open === "Closed" ? "Closed" : `${h.open} - ${h.close}`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Contact */}
      <div style={{ maxWidth: "600px", margin: "0 auto", padding: "60px 24px", textAlign: "center" }}>
        <h2 style={{ fontFamily: headingFont, fontSize: "28px", marginBottom: "24px", color: primary }}>Contact</h2>
        {config.phone && <p style={{ fontSize: "20px", marginBottom: "8px" }}><a href={`tel:${config.phone}`} style={{ color: primary, textDecoration: "none" }}>{config.phone}</a></p>}
        {config.email && <p style={{ fontSize: "16px", marginBottom: "8px" }}><a href={`mailto:${config.email}`} style={{ color: primary, textDecoration: "none" }}>{config.email}</a></p>}
        {config.address && (
          <p style={{ fontSize: "16px", color: "#666" }}>
            {[config.address.street, config.address.city, config.address.state, config.address.zip].filter(Boolean).join(", ")}
          </p>
        )}
        <div style={{ marginTop: "24px", display: "flex", gap: "16px", justifyContent: "center" }}>
          {config.social?.facebook && <a href={config.social.facebook} target="_blank" rel="noopener noreferrer" style={{ color: primary }}>Facebook</a>}
          {config.social?.instagram && <a href={config.social.instagram} target="_blank" rel="noopener noreferrer" style={{ color: primary }}>Instagram</a>}
          {config.social?.yelp && <a href={config.social.yelp} target="_blank" rel="noopener noreferrer" style={{ color: primary }}>Yelp</a>}
          {config.social?.google && <a href={config.social.google} target="_blank" rel="noopener noreferrer" style={{ color: primary }}>Google</a>}
        </div>
      </div>

      {/* Footer */}
      <div style={{ background: primary, color: "#fff", padding: "24px", textAlign: "center", fontSize: "14px", opacity: 0.9 }}>
        &copy; {new Date().getFullYear()} {config.name}. All rights reserved.
      </div>
    </div>
  );
}
