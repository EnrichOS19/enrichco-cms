"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { TemplateSwitcher } from "@/components/TemplateSwitcher";
import { useToast } from "@/components/Toast";
import {
  ArrowLeft,
  ClipboardList,
  Clock,
  Scissors,
  Image as ImageIcon,
  Palette,
  Settings,
  ExternalLink,
  Save,
  Rocket,
  Loader2,
  Plus,
  Trash2,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Globe,
  Instagram,
  Facebook,
} from "lucide-react";

interface SalonConfig {
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
  hours: { day: string; open: string; close: string }[];
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
  services: {
    category: string;
    subtitle?: string;
    icon?: string;
    description?: string;
    items: { name: string; description?: string; price: string; duration?: string }[];
  }[];
  gallery: { src: string; alt: string }[];
  [key: string]: unknown;
}

type TabId = "info" | "hours" | "services" | "gallery" | "design" | "settings";

const TABS: { id: TabId; label: string; icon: typeof ClipboardList }[] = [
  { id: "info", label: "Info", icon: ClipboardList },
  { id: "hours", label: "Hours", icon: Clock },
  { id: "services", label: "Services", icon: Scissors },
  { id: "gallery", label: "Gallery", icon: ImageIcon },
  { id: "design", label: "Design", icon: Palette },
  { id: "settings", label: "Settings", icon: Settings },
];

export default function SalonEditorPage() {
  const params = useParams();
  const slug = params.slug as string;
  const { toast } = useToast();

  const [config, setConfig] = useState<SalonConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("info");
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const initialConfigRef = useRef<string>("");

  useEffect(() => {
    fetch(`/api/salon/${slug}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data) => {
        setConfig(data);
        initialConfigRef.current = JSON.stringify(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [slug]);

  // Unsaved changes warning
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        handlePublish();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const updateField = useCallback((path: string, value: unknown) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const copy = JSON.parse(JSON.stringify(prev));
      const keys = path.split(".");
      let obj = copy;
      for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (key.match(/^\d+$/)) {
          obj = obj[parseInt(key)];
        } else {
          obj = obj[key];
        }
      }
      const lastKey = keys[keys.length - 1];
      if (lastKey.match(/^\d+$/)) {
        obj[parseInt(lastKey)] = value;
      } else {
        obj[lastKey] = value;
      }
      return copy;
    });
    setDirty(true);
  }, []);

  const handleSave = async () => {
    if (!config || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/salon/${slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (Array.isArray(data?.issues)) {
          const mapped: Record<string, string> = {};
          for (const issue of data.issues) {
            if (issue?.path && issue?.message) mapped[String(issue.path)] = String(issue.message);
          }
          setValidationErrors(mapped);
          toast(`Validation failed (${data.issues.length} issue${data.issues.length === 1 ? "" : "s"})`, "error");
          return;
        }
        throw new Error(data?.error || "Save failed");
      }
      setValidationErrors({});
      setDirty(false);
      initialConfigRef.current = JSON.stringify(config);
      toast("Changes saved", "success");
    } catch {
      toast("Failed to save changes", "error");
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!config || publishing) return;
    setPublishing(true);
    toast("Building and deploying...", "info");
    try {
      // Save first
      await fetch(`/api/salon/${slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      setDirty(false);

      const res = await fetch(`/api/salon/${slug}/publish`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast(data.message || "Publish failed", "error");
      } else {
        toast("Published to staging!", "success");
      }
    } catch {
      toast("Publish failed — check server logs", "error");
    } finally {
      setPublishing(false);
    }
  };

  // Service helpers
  const addServiceCategory = () => {
    setConfig((prev) => {
      if (!prev) return prev;
      const copy = JSON.parse(JSON.stringify(prev));
      copy.services.push({ category: "New Category", items: [] });
      return copy;
    });
    setDirty(true);
  };

  const removeServiceCategory = (index: number) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const copy = JSON.parse(JSON.stringify(prev));
      copy.services.splice(index, 1);
      return copy;
    });
    setDirty(true);
  };

  const addService = (catIdx: number) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const copy = JSON.parse(JSON.stringify(prev));
      copy.services[catIdx].items.push({ name: "", price: "", description: "" });
      return copy;
    });
    setDirty(true);
  };

  const removeService = (catIdx: number, itemIdx: number) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const copy = JSON.parse(JSON.stringify(prev));
      copy.services[catIdx].items.splice(itemIdx, 1);
      return copy;
    });
    setDirty(true);
  };

  // Gallery helpers
  const addGalleryImage = () => {
    setConfig((prev) => {
      if (!prev) return prev;
      const copy = JSON.parse(JSON.stringify(prev));
      copy.gallery.push({ src: "", alt: "" });
      return copy;
    });
    setDirty(true);
  };

  const removeGalleryImage = (index: number) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const copy = JSON.parse(JSON.stringify(prev));
      copy.gallery.splice(index, 1);
      return copy;
    });
    setDirty(true);
  };

  const moveGalleryImage = (index: number, direction: -1 | 1) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const copy = JSON.parse(JSON.stringify(prev));
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= copy.gallery.length) return prev;
      [copy.gallery[index], copy.gallery[newIndex]] = [copy.gallery[newIndex], copy.gallery[index]];
      return copy;
    });
    setDirty(true);
  };

  const uploadGalleryImage = async (index: number, file: File) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast("Only JPG, PNG, and WebP files are allowed", "error");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast("Image must be smaller than 5MB", "error");
      return;
    }

    setUploadingIndex(index);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("slug", slug);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Upload failed");

      updateField(`gallery.${index}.src`, data.url);
      if (!config?.gallery?.[index]?.alt) {
        updateField(`gallery.${index}.alt`, `${config?.name || "Salon"} gallery image`);
      }
      toast("Image uploaded", "success");
    } catch {
      toast("Image upload failed", "error");
    } finally {
      setUploadingIndex(null);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex">
        <div className="w-64 border-r border-border/60 p-6">
          <Skeleton className="h-6 w-32 mb-2" />
          <Skeleton className="h-4 w-24 mb-6" />
          <Skeleton className="h-8 w-full" />
        </div>
        <div className="flex-1 p-8">
          <Skeleton className="h-10 w-96 mb-8" />
          <Skeleton className="h-[500px] rounded-xl" />
        </div>
      </div>
    );
  }

  // Not found
  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-semibold mb-2">Salon not found</p>
          <p className="text-sm text-muted-foreground mb-4">
            No config found for &ldquo;{slug}&rdquo;
          </p>
          <Link href="/">
            <Button variant="outline">Back to salons</Button>
          </Link>
        </div>
      </div>
    );
  }

  const stagingUrl = `https://${slug}.web.app`;

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex flex-1 overflow-hidden">
        {/* ===== LEFT SIDEBAR ===== */}
        <aside className="w-64 border-r border-border/60 bg-[oklch(0.14_0_0)] flex flex-col shrink-0">
          <div className="p-5 border-b border-border/60">
            <Link
              href="/"
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              All Salons
            </Link>
            <h2 className="font-semibold text-sm truncate">{config.name}</h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {config.address?.city}, {config.address?.state}
            </p>

            <div className="mt-3 flex items-center gap-2">
              {dirty && (
                <Badge variant="outline" className="bg-amber-500/15 text-amber-400 border-amber-500/25 text-[10px]">
                  Unsaved
                </Badge>
              )}
            </div>
          </div>

          {/* Staging URL */}
          <div className="px-5 py-3 border-b border-border/60">
            <a
              href={stagingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              <span className="truncate">Preview Site</span>
            </a>
          </div>

          {/* Tab navigation */}
          <nav className="flex-1 p-3">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all mb-0.5 ${
                    activeTab === tab.id
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* Keyboard shortcuts hint */}
          <div className="p-4 border-t border-border/60">
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground/60 flex items-center justify-between">
                <span>Save</span>
                <kbd className="font-mono bg-muted/50 px-1.5 py-0.5 rounded text-[9px]">Cmd+S</kbd>
              </p>
              <p className="text-[10px] text-muted-foreground/60 flex items-center justify-between">
                <span>Publish</span>
                <kbd className="font-mono bg-muted/50 px-1.5 py-0.5 rounded text-[9px]">Cmd+P</kbd>
              </p>
            </div>
          </div>
        </aside>

        {/* ===== MAIN CONTENT ===== */}
        <main className="flex-1 overflow-y-auto pb-20">
          <div className="max-w-3xl mx-auto px-8 py-8">
            {/* Tab header */}
            <div className="mb-8">
              <h2 className="text-lg font-semibold">
                {TABS.find((t) => t.id === activeTab)?.label}
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                {activeTab === "info" && "Basic salon details and contact info"}
                {activeTab === "hours" && "Set your business hours for each day"}
                {activeTab === "services" && "Manage service categories and pricing"}
                {activeTab === "gallery" && "Manage gallery photos"}
                {activeTab === "design" && "Colors, fonts, and template selection"}
                {activeTab === "settings" && "Booking URL and social media links"}
              </p>
            </div>

            {/* ===== INFO TAB ===== */}
            {activeTab === "info" && (
              <div className="space-y-8">
                <Section title="Salon Details">
                  {Object.keys(validationErrors).length > 0 && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      Fix validation errors before saving.
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Salon Name">
                      <Input value={config.name} onChange={(e) => updateField("name", e.target.value)} />
                      {validationErrors["name"] && <p className="text-xs text-destructive">{validationErrors["name"]}</p>}
                    </Field>
                    <Field label="Tagline">
                      <Input value={config.tagline} onChange={(e) => updateField("tagline", e.target.value)} />
                    </Field>
                  </div>
                  <Field label="Description">
                    <Textarea
                      value={config.description}
                      onChange={(e) => updateField("description", e.target.value)}
                      rows={3}
                    />
                  </Field>
                </Section>

                <Section title="Contact">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Phone">
                      <Input value={config.phone} onChange={(e) => updateField("phone", e.target.value)} />
                      {validationErrors["phone"] && <p className="text-xs text-destructive">{validationErrors["phone"]}</p>}
                    </Field>
                    <Field label="Email">
                      <Input type="email" value={config.email} onChange={(e) => updateField("email", e.target.value)} />
                      {validationErrors["email"] && <p className="text-xs text-destructive">{validationErrors["email"]}</p>}
                    </Field>
                  </div>
                </Section>

                <Section title="Address">
                  <Field label="Street">
                    <Input
                      value={config.address?.street || ""}
                      onChange={(e) => updateField("address.street", e.target.value)}
                    />
                  </Field>
                  <div className="grid grid-cols-3 gap-4">
                    <Field label="City">
                      <Input
                        value={config.address?.city || ""}
                        onChange={(e) => updateField("address.city", e.target.value)}
                      />
                    </Field>
                    <Field label="State">
                      <Input
                        value={config.address?.state || ""}
                        onChange={(e) => updateField("address.state", e.target.value)}
                      />
                    </Field>
                    <Field label="ZIP">
                      <Input
                        value={config.address?.zip || ""}
                        onChange={(e) => updateField("address.zip", e.target.value)}
                      />
                    </Field>
                  </div>
                </Section>
              </div>
            )}

            {/* ===== HOURS TAB ===== */}
            {activeTab === "hours" && (
              <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
                {(config.hours || []).map((h, i) => (
                  <div
                    key={h.day}
                    className={`grid grid-cols-[140px_1fr_1fr] gap-4 items-center px-5 py-3.5 ${
                      i < config.hours.length - 1 ? "border-b border-border/40" : ""
                    }`}
                  >
                    <span className="text-sm font-medium">{h.day}</span>
                    <Input
                      value={h.open}
                      onChange={(e) => updateField(`hours.${i}.open`, e.target.value)}
                      placeholder="9:00 AM"
                      className="bg-background"
                    />
                    <Input
                      value={h.close}
                      onChange={(e) => updateField(`hours.${i}.close`, e.target.value)}
                      placeholder="7:00 PM"
                      className="bg-background"
                    />
                  </div>
                ))}
                {(!config.hours || config.hours.length === 0) && (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    No hours configured yet
                  </div>
                )}
              </div>
            )}

            {/* ===== SERVICES TAB ===== */}
            {activeTab === "services" && (
              <div className="space-y-6">
                {(config.services || []).length === 0 && (
                  <div className="rounded-xl border border-dashed border-border/60 py-12 text-center">
                    <Scissors className="h-8 w-8 text-muted-foreground/50 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground mb-1">No services yet</p>
                    <p className="text-xs text-muted-foreground/60 mb-4">Add your first service category</p>
                    <Button variant="outline" size="sm" onClick={addServiceCategory}>
                      <Plus className="h-3.5 w-3.5 mr-1.5" />
                      Add Category
                    </Button>
                  </div>
                )}

                {(config.services || []).map((cat, catIdx) => (
                  <div key={catIdx} className="rounded-xl border border-border/60 bg-card overflow-hidden">
                    {/* Category header */}
                    <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border/40 bg-muted/30">
                      <Input
                        value={cat.category}
                        onChange={(e) => updateField(`services.${catIdx}.category`, e.target.value)}
                        className="bg-transparent border-none text-sm font-semibold p-0 h-auto focus-visible:ring-0 shadow-none"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive/60 hover:text-destructive shrink-0 h-7 w-7 p-0"
                        onClick={() => removeServiceCategory(catIdx)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {/* Service items */}
                    <div className="divide-y divide-border/30">
                      {cat.items.map((item, itemIdx) => (
                        <div key={itemIdx} className="grid grid-cols-[1fr_1fr_80px_32px] gap-3 items-center px-5 py-3">
                          <Input
                            value={item.name}
                            onChange={(e) => updateField(`services.${catIdx}.items.${itemIdx}.name`, e.target.value)}
                            placeholder="Service name"
                            className="bg-background text-sm"
                          />
                          <Input
                            value={item.description || ""}
                            onChange={(e) => updateField(`services.${catIdx}.items.${itemIdx}.description`, e.target.value)}
                            placeholder="Description"
                            className="bg-background text-sm"
                          />
                          <Input
                            value={item.price}
                            onChange={(e) => updateField(`services.${catIdx}.items.${itemIdx}.price`, e.target.value)}
                            placeholder="$0"
                            className="bg-background text-sm font-mono"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive/40 hover:text-destructive h-8 w-8 p-0"
                            onClick={() => removeService(catIdx, itemIdx)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>

                    {/* Add service button */}
                    <div className="px-5 py-3 border-t border-border/30">
                      <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => addService(catIdx)}>
                        <Plus className="h-3.5 w-3.5 mr-1.5" />
                        Add Service
                      </Button>
                    </div>
                  </div>
                ))}

                {(config.services || []).length > 0 && (
                  <Button variant="outline" onClick={addServiceCategory}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Category
                  </Button>
                )}
              </div>
            )}

            {/* ===== GALLERY TAB ===== */}
            {activeTab === "gallery" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {config.gallery?.length || 0} photo{(config.gallery?.length || 0) !== 1 ? "s" : ""}
                  </p>
                  <Button variant="outline" size="sm" onClick={addGalleryImage}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    Add Image
                  </Button>
                </div>

                {(!config.gallery || config.gallery.length === 0) && (
                  <div className="rounded-xl border border-dashed border-border/60 py-12 text-center">
                    <ImageIcon className="h-8 w-8 text-muted-foreground/50 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground mb-1">No gallery images yet</p>
                    <p className="text-xs text-muted-foreground/60">Add photos to showcase the salon</p>
                  </div>
                )}

                <div className="space-y-2">
                  {(config.gallery || []).map((img, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-border/60 bg-card flex items-center gap-3 px-4 py-3"
                    >
                      <div className="flex items-center gap-1 text-muted-foreground/40">
                        <GripVertical className="h-4 w-4" />
                      </div>
                      <span className="text-xs text-muted-foreground font-mono w-6 text-center shrink-0">
                        {i + 1}
                      </span>
                      {img.src && (
                        <div className="h-10 w-10 rounded bg-muted/50 overflow-hidden shrink-0">
                          <img
                            src={img.src.startsWith("/") ? `${stagingUrl}${img.src}` : img.src}
                            alt={img.alt}
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        </div>
                      )}
                      <Input
                        value={img.src}
                        onChange={(e) => updateField(`gallery.${i}.src`, e.target.value)}
                        placeholder="/assets/gallery/photo.jpg"
                        className="bg-background text-sm flex-1"
                      />
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="text-xs w-44"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void uploadGalleryImage(i, file);
                          e.currentTarget.value = "";
                        }}
                        disabled={uploadingIndex === i}
                      />
                      <Input
                        value={img.alt}
                        onChange={(e) => updateField(`gallery.${i}.alt`, e.target.value)}
                        placeholder="Alt text"
                        className="bg-background text-sm w-40"
                      />
                      <div className="flex items-center gap-0.5 shrink-0">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => moveGalleryImage(i, -1)} disabled={i === 0}>
                          <ChevronUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => moveGalleryImage(i, 1)} disabled={i === config.gallery.length - 1}>
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-destructive/40 hover:text-destructive"
                          onClick={() => removeGalleryImage(i)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ===== DESIGN TAB ===== */}
            {activeTab === "design" && (
              <div className="space-y-10">
                {/* Colors */}
                <Section title="Brand Colors">
                  <div className="grid grid-cols-3 gap-5">
                    {[
                      { label: "Primary", key: "primaryColor" },
                      { label: "Accent", key: "accentColor" },
                      { label: "Background", key: "backgroundColor" },
                      { label: "Primary Light", key: "primaryLight" },
                      { label: "Primary Dark", key: "primaryDark" },
                      { label: "Surface", key: "surfaceColor" },
                      { label: "Text", key: "textColor" },
                      { label: "Text Muted", key: "textMuted" },
                      { label: "Surface Light", key: "surfaceLight" },
                    ].map(({ label, key }) => (
                      <div key={key} className="space-y-2">
                        <Label className="text-xs text-muted-foreground">{label}</Label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={(config.branding as Record<string, string>)?.[key] || "#000000"}
                            onChange={(e) => updateField(`branding.${key}`, e.target.value)}
                            className="h-9 w-9 rounded-lg border border-border/60 cursor-pointer bg-transparent"
                          />
                          <Input
                            value={(config.branding as Record<string, string>)?.[key] || ""}
                            onChange={(e) => updateField(`branding.${key}`, e.target.value)}
                            className="font-mono text-xs bg-background"
                            placeholder="#000000"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>

                {/* Fonts */}
                <Section title="Typography">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Heading Font">
                      <Input
                        value={config.branding?.fontHeading || ""}
                        onChange={(e) => updateField("branding.fontHeading", e.target.value)}
                        placeholder="e.g., Playfair Display"
                      />
                    </Field>
                    <Field label="Body Font">
                      <Input
                        value={config.branding?.fontBody || ""}
                        onChange={(e) => updateField("branding.fontBody", e.target.value)}
                        placeholder="e.g., Inter"
                      />
                    </Field>
                  </div>
                </Section>

                {/* Color preview */}
                <Section title="Preview">
                  <div
                    className="rounded-xl p-6 space-y-3 border border-border/30"
                    style={{ backgroundColor: config.branding?.backgroundColor || "#fff" }}
                  >
                    <h3
                      className="text-lg font-bold"
                      style={{
                        color: config.branding?.textColor || "#000",
                        fontFamily: config.branding?.fontHeading || "inherit",
                      }}
                    >
                      {config.name}
                    </h3>
                    <p
                      className="text-sm"
                      style={{
                        color: config.branding?.textMuted || "#666",
                        fontFamily: config.branding?.fontBody || "inherit",
                      }}
                    >
                      {config.tagline}
                    </p>
                    <div className="flex gap-2">
                      <span
                        className="inline-block px-3 py-1 rounded-md text-sm text-white"
                        style={{ backgroundColor: config.branding?.primaryColor || "#000" }}
                      >
                        Primary
                      </span>
                      <span
                        className="inline-block px-3 py-1 rounded-md text-sm text-white"
                        style={{ backgroundColor: config.branding?.accentColor || "#333" }}
                      >
                        Accent
                      </span>
                    </div>
                  </div>
                </Section>

                <Separator />

                {/* Template Switcher */}
                <div>
                  <h3 className="text-sm font-semibold mb-1">Design Template</h3>
                  <p className="text-xs text-muted-foreground mb-5">
                    Switch the entire site design. Your content is always preserved.
                  </p>
                  <TemplateSwitcher
                    slug={slug}
                    currentTemplate={(config as Record<string, unknown>).currentTemplate as string | undefined}
                  />
                </div>
              </div>
            )}

            {/* ===== SETTINGS TAB ===== */}
            {activeTab === "settings" && (
              <div className="space-y-8">
                <Section title="Booking">
                  <Field label="Booking URL">
                    <Input
                      value={config.booking?.url || ""}
                      onChange={(e) => updateField("booking.url", e.target.value)}
                      placeholder="https://..."
                    />
                  </Field>
                </Section>

                <Section title="Social Links">
                  {[
                    { label: "Instagram", key: "instagram", icon: Instagram },
                    { label: "Facebook", key: "facebook", icon: Facebook },
                    { label: "Google", key: "google", icon: Globe },
                    { label: "Yelp", key: "yelp", icon: Globe },
                  ].map(({ label, key, icon: Icon }) => (
                    <Field key={key} label={label}>
                      <div className="relative">
                        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          value={(config.social as Record<string, string>)?.[key] || ""}
                          onChange={(e) => updateField(`social.${key}`, e.target.value)}
                          placeholder={`https://${key}.com/...`}
                          className="pl-10"
                        />
                      </div>
                    </Field>
                  ))}
                </Section>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* ===== STICKY FOOTER BAR ===== */}
      <div className="sticky bottom-0 border-t border-border/60 bg-[oklch(0.14_0_0)] backdrop-blur-sm z-10">
        <div className="max-w-3xl mx-auto px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSave}
              disabled={saving || !dirty}
              className="gap-2"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {saving ? "Saving..." : "Save Changes"}
            </Button>
            {dirty && (
              <span className="text-[11px] text-amber-400">Unsaved changes</span>
            )}
          </div>
          <Button
            size="sm"
            onClick={handlePublish}
            disabled={publishing}
            className="gap-2"
          >
            {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
            {publishing ? "Publishing..." : "Publish to Staging"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ===== REUSABLE LAYOUT COMPONENTS ===== */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
