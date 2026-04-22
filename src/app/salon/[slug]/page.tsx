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
import { PublishStatusBar } from "@/components/PublishStatusBar";
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
  FileText,
  Search,
  Eye,
  History,
  RotateCcw,
  X,
} from "lucide-react";
import {
  shouldShowTab,
  shouldShowField,
  canPublishToProduction,
  canSwitchTemplate,
} from "@/lib/roles";

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
    logo?: string;
    logoHasName?: boolean;
  };
  about?: {
    welcome?: string;
    mission?: string;
    sanitation?: string;
    values?: string[];
  };
  meta?: {
    title?: string;
    description?: string;
    keywords?: string;
    ogImage?: string;
    url?: string;
  };
  services: {
    category: string;
    subtitle?: string;
    icon?: string;
    image?: string;
    description?: string;
    items: { name: string; description?: string; price: string; duration?: string }[];
  }[];
  gallery: { src: string; alt: string }[];
  domain?: string;
  stagingDomain?: string;
  siteStatus?: "staging" | "production";
  domainOwnership?: "enrichco" | "client";
  websiteManager?: "ai-team" | "marketing-team";
  currentTemplate?: string;
  [key: string]: unknown;
}

type TabId = "info" | "hours" | "services" | "gallery" | "design" | "about" | "blog" | "seo" | "history" | "settings";

const TABS: { id: TabId; label: string; icon: typeof ClipboardList }[] = [
  { id: "info", label: "Info", icon: ClipboardList },
  { id: "hours", label: "Hours", icon: Clock },
  { id: "services", label: "Services", icon: Scissors },
  { id: "gallery", label: "Gallery", icon: ImageIcon },
  { id: "design", label: "Design", icon: Palette },
  { id: "about", label: "About", icon: FileText },
  { id: "blog", label: "Blog", icon: FileText },
  { id: "seo", label: "SEO", icon: Search },
  { id: "history", label: "History", icon: History },
  { id: "settings", label: "Settings", icon: Settings },
];

export default function SalonEditorPage() {
  const params = useParams();
  const slug = params.slug as string;
  const { toast } = useToast();

  const [config, setConfig] = useState<SalonConfig | null>(null);
  const isProduction = (config?.siteStatus ?? "staging") === "production";
  const [userRole, setUserRole] = useState<string | null>(null);
  const canPublish = canPublishToProduction(userRole);
  const canSwitchTpl = canSwitchTemplate(userRole);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [activeTab, setActiveTab] = useState<TabId>("info");
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [validationWarning, setValidationWarning] = useState<string | null>(null);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [showGoLiveConfirm, setShowGoLiveConfirm] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  // Incremented after any publish so <PublishStatusBar /> refetches immediately
  // instead of waiting for its 10s poll.
  const [statusRefreshTrigger, setStatusRefreshTrigger] = useState(0);
  const initialConfigRef = useRef<string>("");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRevisionRef = useRef(0);

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

        // Preflight: check if this config would pass validation on save
        fetch(`/api/salon/${slug}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-Dry-Run": "true" },
          body: JSON.stringify(data),
        }).then(r => {
          if (!r.ok) {
            r.json().then(d => {
              if (d.issues) {
                setValidationWarning(`${d.issues.length} field(s) may need fixing before you can save.`);
              }
            }).catch(() => {});
          }
        }).catch(() => {});
      })
      .catch(() => setLoading(false));

    // Fetch user role
    fetch("/api/auth/session")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.role) setUserRole(data.role); })
      .catch(() => {});

    // Fetch logo status
    fetch(`/api/salon/${slug}/logo`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.hasLogo) setLogoUrl(`/api/salon/${slug}/logo?raw=1&t=${Date.now()}`); })
      .catch(() => {});
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

  // Bridge: PublishStatusBar emits a CustomEvent when its "Update preview"
  // button succeeds/fails. Relay those to our toast so feedback is consistent
  // without prop-drilling the useToast hook into the status bar.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { type?: string; message?: string } | undefined;
      if (!detail?.message) return;
      toast(detail.message, (detail.type as "success" | "error" | "info") ?? "info");
    };
    window.addEventListener("publish-status-toast", handler);
    return () => window.removeEventListener("publish-status-toast", handler);
  }, [toast]);

  // Keyboard shortcut: Cmd+S forces immediate save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        flushSave();
      }
      // Cmd+P disabled (was publish, browser print is more useful)
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
          if (obj[key] === undefined || obj[key] === null) {
            obj[key] = {};
          }
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

  // ── Address field updater — keeps address.full in sync ────────────────
  const updateAddressField = useCallback((field: "street" | "city" | "state" | "zip", value: string) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const copy = JSON.parse(JSON.stringify(prev)) as typeof prev;
      if (!copy.address) copy.address = { street: "", city: "", state: "", zip: "", full: "" };
      (copy.address as Record<string, unknown>)[field] = value;
      const { street = "", city = "", state = "", zip = "" } = copy.address as { street?: string; city?: string; state?: string; zip?: string };
      const parts = [street.trim(), [city.trim(), state.trim()].filter(Boolean).join(", "), zip.trim()].filter(Boolean);
      (copy.address as Record<string, unknown>).full = parts.join(", ");
      return copy;
    });
    setDirty(true);
  }, []);

  // ── Autosave: flush current config to server ──────────────────────────
  const flushSave = useCallback(async (): Promise<boolean> => {
    if (!config) return false;
    const rev = ++saveRevisionRef.current;
    setSaving(true);
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/salon/${slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      // Ignore if a newer save has already started
      if (rev !== saveRevisionRef.current) return false;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (Array.isArray(data?.issues)) {
          const mapped: Record<string, string> = {};
          for (const issue of data.issues) {
            if (issue?.path && issue?.message) mapped[String(issue.path)] = String(issue.message);
          }
          setValidationErrors(mapped);
        }
        setSaveStatus("error");
        return false;
      }
      setValidationErrors({});
      setDirty(false);
      setSaveStatus("saved");
      initialConfigRef.current = JSON.stringify(config);
      return true;
    } catch {
      if (rev === saveRevisionRef.current) setSaveStatus("error");
      return false;
    } finally {
      if (rev === saveRevisionRef.current) setSaving(false);
    }
  }, [config, slug]);

  // ── Autosave: 2-second debounce on dirty changes ────────────────────
  useEffect(() => {
    if (!dirty || !config) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => { flushSave(); }, 2000);
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [dirty, config, flushSave]);

  // Keep legacy handleSave for keyboard shortcut
  const handleSave = () => { flushSave(); };

  // ── Go Live: flush save → confirm → build → deploy to production ────
  const handleGoLive = async () => {
    if (!config || publishing) return;

    // 1. Flush save first
    const saved = await flushSave();
    if (!saved) {
      toast("Cannot go live — save failed. Fix errors first.", "error");
      return;
    }

    // 2. Show confirmation for production
    setShowGoLiveConfirm(true);
  };

  const confirmGoLive = async () => {
    setShowGoLiveConfirm(false);
    setPublishing(true);
    toast("Building and deploying to live...", "info");
    try {
      const res = await fetch(`/api/salon/${slug}/publish`, { method: "POST" });
      const data = await res.json();
      if (res.status === 502 && data?.verified === false) {
        // Build + deploy succeeded on our server, but the live URL is not
        // serving the new build. This is the class of bug where editors
        // think they published but users see stale content. Do NOT say success.
        toast(
          `Publish did NOT reach live users (${data.reason}). ${data.hint ?? ""}`,
          "error"
        );
      } else if (!res.ok) {
        toast(data.message || data.error || "Publish failed", "error");
      } else {
        toast(
          `Live site updated — verified reachable (build ${data.deploy_hash})`,
          "success"
        );
      }
    } catch {
      toast("Publish failed", "error");
    } finally {
      setPublishing(false);
      setStatusRefreshTrigger((n) => n + 1);
    }
  };

  // ── Preview: save → build staging → open staging URL ────────────────
  const handlePreview = async () => {
    if (!config || previewing) return;

    const stagingDomain = config.stagingDomain;
    if (!stagingDomain) {
      toast("No staging domain configured. Set one in Settings.", "error");
      return;
    }

    // Open about:blank synchronously to secure popup permission,
    // then navigate it to staging once the build completes.
    const previewWin = window.open("about:blank", "_blank");
    if (!previewWin) {
      toast("Popup blocked — allow popups for this site and try again.", "error");
      return;
    }
    previewWin.document.write(
      `<!DOCTYPE html><html><head><title>Building preview…</title></head>` +
      `<body style="background:#111;color:#fff;font-family:system-ui;` +
      `display:flex;align-items:center;justify-content:center;height:100vh;margin:0">` +
      `<div style="text-align:center"><h2>Building preview…</h2>` +
      `<p style="color:#888">Saving your changes and rebuilding the staging site.<br>` +
      `This usually takes 1–2 minutes.</p></div></body></html>`
    );
    previewWin.document.close();

    setPreviewing(true);
    try {
      // 1. Save
      const saved = await flushSave();
      if (!saved) {
        toast("Cannot preview — save failed. Fix errors first.", "error");
        previewWin.close();
        return;
      }

      // 2. Build + deploy to staging
      const res = await fetch(`/api/salon/${slug}/publish?target=staging`, { method: "POST" });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (res.status === 502 && data?.verified === false) {
        // Staging build succeeded but live URL doesn't reflect it. Don't
        // silently pop open a stale preview — tell the user so they can fix
        // the config (usually staging DNS or staging dir pathing).
        toast(
          `Preview built but did NOT reach ${stagingDomain} (${data.reason}). ${data.hint ?? ""}`,
          "error"
        );
        previewWin.close();
        return;
      }
      if (!res.ok) {
        toast(
          (data.message as string) || (data.error as string) || "Preview build failed",
          "error"
        );
        previewWin.close();
        return;
      }

      // 3. Navigate the already-open window to the fresh staging site
      previewWin.location.href = `https://${stagingDomain}`;
      toast("Preview ready — verified reachable!", "success");
    } catch {
      toast("Preview build failed", "error");
      previewWin.close();
    } finally {
      setPreviewing(false);
      setStatusRefreshTrigger((n) => n + 1);
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
    if (!window.confirm("Delete this service category and all its services?")) return;
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

  const moveServiceCategory = (index: number, direction: -1 | 1) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const copy = JSON.parse(JSON.stringify(prev));
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= copy.services.length) return prev;
      [copy.services[index], copy.services[newIndex]] = [copy.services[newIndex], copy.services[index]];
      return copy;
    });
    setDirty(true);
  };

  const moveService = (catIdx: number, itemIdx: number, direction: -1 | 1) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const copy = JSON.parse(JSON.stringify(prev));
      const items = copy.services[catIdx].items;
      const newIdx = itemIdx + direction;
      if (newIdx < 0 || newIdx >= items.length) return prev;
      [items[itemIdx], items[newIdx]] = [items[newIdx], items[itemIdx]];
      return copy;
    });
    setDirty(true);
  };

  const removeService = (catIdx: number, itemIdx: number) => {
    if (!window.confirm("Delete this service?")) return;
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
    if (!window.confirm("Remove this gallery image?")) return;
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

  // Category image upload — for homepage featured tiles
  const [uploadingCatImage, setUploadingCatImage] = useState<number | null>(null);
  const uploadCategoryImage = async (catIdx: number, file: File) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast("Image must be JPG, PNG, or WebP", "error");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast("Image must be smaller than 5MB", "error");
      return;
    }
    setUploadingCatImage(catIdx);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("slug", slug);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Upload failed");
      updateField(`services.${catIdx}.image`, data.url);
      toast("Category image uploaded", "success");
    } catch {
      toast("Upload failed", "error");
    } finally {
      setUploadingCatImage(null);
    }
  };

  // Logo upload
  const uploadLogo = async (file: File) => {
    if (!["image/jpeg", "image/png", "image/webp", "image/svg+xml"].includes(file.type)) {
      toast("Logo must be JPG, PNG, WebP, or SVG", "error");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast("Logo must be smaller than 5MB", "error");
      return;
    }
    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/salon/${slug}/logo`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Upload failed");
      setLogoUrl(`/api/salon/${slug}/logo?raw=1&t=${Date.now()}`);
      updateField("branding.logo", "/assets/logo.png");
      toast("Logo updated — Preview or Go Live to publish", "success");
    } catch {
      toast("Logo upload failed", "error");
    } finally {
      setUploadingLogo(false);
    }
  };

  const removeLogo = async () => {
    if (!window.confirm("Remove this salon's logo?")) return;
    try {
      await fetch(`/api/salon/${slug}/logo`, { method: "DELETE" });
      setLogoUrl(null);
      updateField("branding.logo", "");
      toast("Logo removed", "success");
    } catch {
      toast("Failed to remove logo", "error");
    }
  };

  // Hours helpers
  const addDefaultSchedule = () => {
    setConfig((prev) => {
      if (!prev) return prev;
      const copy = JSON.parse(JSON.stringify(prev));
      copy.hours = [
        { day: "Monday", open: "9:30 AM", close: "7:00 PM" },
        { day: "Tuesday", open: "9:30 AM", close: "7:00 PM" },
        { day: "Wednesday", open: "9:30 AM", close: "7:00 PM" },
        { day: "Thursday", open: "9:30 AM", close: "7:00 PM" },
        { day: "Friday", open: "9:30 AM", close: "7:00 PM" },
        { day: "Saturday", open: "9:30 AM", close: "7:00 PM" },
        { day: "Sunday", open: "11:00 AM", close: "5:00 PM" },
      ];
      return copy;
    });
    setDirty(true);
  };

  const addDay = () => {
    setConfig((prev) => {
      if (!prev) return prev;
      const copy = JSON.parse(JSON.stringify(prev));
      if (!copy.hours) copy.hours = [];
      copy.hours.push({ day: "", open: "9:00 AM", close: "5:00 PM" });
      return copy;
    });
    setDirty(true);
  };

  const removeDay = (index: number) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const copy = JSON.parse(JSON.stringify(prev));
      copy.hours.splice(index, 1);
      return copy;
    });
    setDirty(true);
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

  const previewUrl = isProduction
    ? (config.domain ? `https://${config.domain}` : null)
    : (config.stagingDomain ? `https://${config.stagingDomain}` : null);
  const liveUrl = config.domain ? `https://${config.domain}` : null;

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* ===== SIDEBAR (desktop) / TOP NAV (mobile) ===== */}
        <aside className="hidden md:flex w-64 border-r border-border/60 bg-[oklch(0.14_0_0)] flex-col shrink-0">
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

          {/* Domain link */}
          <div className="px-5 py-3 border-b border-border/60">
            {previewUrl ? (
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs hover:text-primary transition-colors group/domain"
              >
                <Globe className="h-3.5 w-3.5 text-muted-foreground group-hover/domain:text-primary shrink-0" />
                <span className="truncate font-medium text-foreground group-hover/domain:text-primary">
                  {isProduction ? config.domain : config.stagingDomain}
                </span>
                <ExternalLink className="h-3 w-3 text-muted-foreground group-hover/domain:text-primary shrink-0" />
              </a>
            ) : (
              <span className="flex items-center gap-2 text-xs text-muted-foreground opacity-50">
                <Globe className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{isProduction ? "No domain set" : "No staging domain set"}</span>
              </span>
            )}
            <div className="mt-1.5">
              <Badge variant="outline" className={`text-[10px] ${isProduction ? "bg-green-500/15 text-green-400 border-green-500/25" : "bg-blue-500/15 text-blue-400 border-blue-500/25"}`}>
                {isProduction ? "Production" : "Staging"}
              </Badge>
            </div>
          </div>

          {/* Tab navigation */}
          <nav className="flex-1 p-3" role="tablist" aria-label="Editor sections">
            {TABS.filter((tab) => shouldShowTab(tab.id, userRole)).map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={activeTab === tab.id}
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
                <span>Force save</span>
                <kbd className="font-mono bg-muted/50 px-1.5 py-0.5 rounded text-[9px]">Cmd+S</kbd>
              </p>
              <p className="text-[10px] text-muted-foreground/60">
                Autosaves 2 sec after you stop typing
              </p>
            </div>
          </div>
        </aside>

        {/* ===== MOBILE TOP NAV ===== */}
        <div className="md:hidden border-b border-border/60 bg-[oklch(0.14_0_0)]">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Link>
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-sm truncate">{config.name}</h2>
              {previewUrl ? (
                <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors">
                  <span className="truncate">{isProduction ? config.domain : config.stagingDomain}</span>
                  <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                </a>
              ) : (
                <span className="text-[10px] text-muted-foreground opacity-50">{isProduction ? "No domain" : "No staging domain"}</span>
              )}
            </div>
            <Badge variant="outline" className={`text-[10px] shrink-0 ${isProduction ? "bg-green-500/15 text-green-400 border-green-500/25" : "bg-blue-500/15 text-blue-400 border-blue-500/25"}`}>
              {isProduction ? "Prod" : "Staging"}
            </Badge>
            {dirty && (
              <Badge variant="outline" className="bg-amber-500/15 text-amber-400 border-amber-500/25 text-[10px] shrink-0">
                Unsaved
              </Badge>
            )}
          </div>
          <nav className="flex overflow-x-auto px-2 py-2 gap-1 scrollbar-none" role="tablist" aria-label="Editor sections">
            {TABS.filter((tab) => shouldShowTab(tab.id, userRole)).map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs whitespace-nowrap transition-all shrink-0 ${
                    activeTab === tab.id
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* ===== MAIN CONTENT ===== */}
        <main className="flex-1 overflow-y-auto pb-20" role="tabpanel" aria-label={`${TABS.find((t) => t.id === activeTab)?.label} tab content`}>
          <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
            {/* Validation warning banner */}
            {validationWarning && (
              <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center gap-2">
                <span className="text-amber-400 text-xs font-medium">{validationWarning}</span>
                <button onClick={() => setValidationWarning(null)} className="text-amber-400/60 hover:text-amber-400 ml-auto text-xs">dismiss</button>
              </div>
            )}
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
                {activeTab === "about" && "Tell visitors about your salon"}
                {activeTab === "blog" && "Create and manage blog posts"}
                {activeTab === "seo" && "Search engine optimization and social sharing"}
                {activeTab === "history" && "Review and restore past versions of this salon's content"}
                {activeTab === "settings" && "Booking URL and social media links"}
              </p>
            </div>

            {/* ===== PUBLISH STATUS BAR =====
                 Always-visible indicator of where CMS content currently lives
                 (Draft / Staging / Production). Polls /api/salon/[slug]/status
                 every 10s so it reflects the moment a publish completes,
                 without the user needing to refresh. */}
            <PublishStatusBar
              slug={slug}
              canPublishProduction={canPublish}
              pollTrigger={statusRefreshTrigger}
              onRequestGoLive={handleGoLive}
              onRequestStaging={handlePreview}
            />

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

                <Section title="Logo">
                  <div className="flex items-start gap-6">
                    {/* Logo preview */}
                    <div className="shrink-0">
                      {logoUrl ? (
                        <div className="h-24 w-24 rounded-xl border border-border/60 bg-muted/30 overflow-hidden flex items-center justify-center">
                          <img
                            src={logoUrl}
                            alt={`${config.name} logo`}
                            className="max-h-full max-w-full object-contain"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        </div>
                      ) : (
                        <div className="h-24 w-24 rounded-xl border border-dashed border-border/60 bg-muted/10 flex items-center justify-center">
                          <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
                        </div>
                      )}
                    </div>
                    {/* Upload controls */}
                    <div className="flex-1 space-y-3">
                      <p className="text-xs text-muted-foreground">
                        {logoUrl ? "Current logo. Upload a new file to replace it." : "No logo uploaded yet. Upload one to show it in the header, footer, and favicon."}
                      </p>
                      <div className="flex items-center gap-2">
                        <label className="cursor-pointer">
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/svg+xml"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void uploadLogo(file);
                              e.currentTarget.value = "";
                            }}
                            disabled={uploadingLogo}
                          />
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                            uploadingLogo
                              ? "bg-muted text-muted-foreground border-border/60 cursor-wait"
                              : "bg-primary/10 text-primary border-primary/25 hover:bg-primary/20"
                          }`}>
                            {uploadingLogo ? (
                              <><Loader2 className="h-3 w-3 animate-spin" /> Uploading...</>
                            ) : (
                              <><Plus className="h-3 w-3" /> {logoUrl ? "Replace Logo" : "Upload Logo"}</>
                            )}
                          </span>
                        </label>
                        {logoUrl && (
                          <button
                            onClick={removeLogo}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            <Trash2 className="h-3 w-3" /> Remove
                          </button>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground/50">
                        JPG, PNG, WebP, or SVG. Max 5MB. Shows in header, footer, and browser tab.
                      </p>

                      {/* Logo has name built-in — controls text visibility */}
                      {logoUrl && (
                        <label className="flex items-start gap-2 pt-2 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={Boolean((config.branding as { logoHasName?: boolean })?.logoHasName)}
                            onChange={(e) => updateField("branding.logoHasName", e.target.checked)}
                            className="h-4 w-4 mt-0.5 rounded border-border/60 bg-background accent-primary"
                          />
                          <div>
                            <span className="text-xs text-foreground group-hover:text-primary transition-colors">
                              My logo already includes the salon name
                            </span>
                            <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                              Check this if your logo image has the salon name in it (so we don&apos;t show the name text beside the logo).
                            </p>
                          </div>
                        </label>
                      )}
                    </div>
                  </div>
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
                      onChange={(e) => updateAddressField("street", e.target.value)}
                    />
                  </Field>
                  <div className="grid grid-cols-3 gap-4">
                    <Field label="City">
                      <Input
                        value={config.address?.city || ""}
                        onChange={(e) => updateAddressField("city", e.target.value)}
                      />
                    </Field>
                    <Field label="State">
                      <Input
                        value={config.address?.state || ""}
                        onChange={(e) => updateAddressField("state", e.target.value)}
                      />
                    </Field>
                    <Field label="ZIP">
                      <Input
                        value={config.address?.zip || ""}
                        onChange={(e) => updateAddressField("zip", e.target.value)}
                      />
                    </Field>
                  </div>
                  {config.address?.full && (
                    <p className="text-[11px] text-muted-foreground/60 mt-1">
                      Full address: {config.address.full}
                    </p>
                  )}
                </Section>
              </div>
            )}

            {/* ===== HOURS TAB ===== */}
            {activeTab === "hours" && (
              <div className="space-y-4">
                <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
                  {(config.hours || []).map((h, i) => (
                    <div
                      key={`${h.day}-${i}`}
                      className={`grid grid-cols-[140px_1fr_1fr_32px] gap-4 items-center px-5 py-3.5 ${
                        i < config.hours.length - 1 ? "border-b border-border/40" : ""
                      }`}
                    >
                      <Input
                        value={h.day}
                        onChange={(e) => updateField(`hours.${i}.day`, e.target.value)}
                        placeholder="Day"
                        className="bg-transparent border-none text-sm font-medium p-0 h-auto focus-visible:ring-0 shadow-none"
                      />
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
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive/40 hover:text-destructive h-8 w-8 p-0"
                        onClick={() => removeDay(i)}
                        aria-label={`Remove ${h.day || "day"}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  {(!config.hours || config.hours.length === 0) && (
                    <div className="py-12 text-center text-sm text-muted-foreground">
                      <Clock className="h-8 w-8 text-muted-foreground/50 mx-auto mb-3" />
                      <p className="mb-1">No hours configured yet</p>
                      <p className="text-xs text-muted-foreground/60 mb-4">Add a default schedule or add days individually</p>
                      <div className="flex items-center justify-center gap-2">
                        <Button variant="outline" size="sm" onClick={addDefaultSchedule}>
                          <Plus className="h-3.5 w-3.5 mr-1.5" />
                          Add Default Schedule
                        </Button>
                        <Button variant="ghost" size="sm" onClick={addDay}>
                          <Plus className="h-3.5 w-3.5 mr-1.5" />
                          Add Day
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                {config.hours && config.hours.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={addDay}>
                      <Plus className="h-3.5 w-3.5 mr-1.5" />
                      Add Day
                    </Button>
                    {config.hours.length === 0 && (
                      <Button variant="ghost" size="sm" onClick={addDefaultSchedule}>
                        Add Default Schedule
                      </Button>
                    )}
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
                    <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border/40 bg-muted/30">
                      <div className="flex items-center gap-0.5 shrink-0">
                        <Button
                          variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-foreground"
                          onClick={() => moveServiceCategory(catIdx, -1)}
                          disabled={catIdx === 0}
                          aria-label="Move category up"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-foreground"
                          onClick={() => moveServiceCategory(catIdx, 1)}
                          disabled={catIdx === config.services.length - 1}
                          aria-label="Move category down"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <Input
                        value={cat.category}
                        onChange={(e) => updateField(`services.${catIdx}.category`, e.target.value)}
                        className="bg-transparent border-none text-sm font-semibold p-0 h-auto focus-visible:ring-0 shadow-none flex-1"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive/60 hover:text-destructive shrink-0 h-7 w-7 p-0"
                        onClick={() => removeServiceCategory(catIdx)}
                        aria-label={`Delete category ${cat.category}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {/* Category meta: image + tagline (shown on homepage featured tile) */}
                    <div className="px-5 py-4 border-b border-border/30 bg-card/50">
                      <div className="flex items-start gap-4">
                        {/* Image preview */}
                        <div className="shrink-0">
                          {cat.image ? (
                            <div className="h-16 w-16 rounded-lg border border-border/60 bg-muted/30 overflow-hidden">
                              <img
                                src={cat.image.startsWith("/") ? `${liveUrl ?? ""}${cat.image}` : cat.image}
                                alt={cat.category}
                                className="h-full w-full object-cover"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                              />
                            </div>
                          ) : (
                            <div className="h-16 w-16 rounded-lg border border-dashed border-border/60 bg-muted/10 flex items-center justify-center">
                              <ImageIcon className="h-5 w-5 text-muted-foreground/40" />
                            </div>
                          )}
                        </div>
                        {/* Tagline + upload */}
                        <div className="flex-1 space-y-2">
                          <Input
                            value={cat.description || ""}
                            onChange={(e) => updateField(`services.${catIdx}.description`, e.target.value)}
                            placeholder="Tagline shown on homepage (e.g. 'Luxury from sole to soul')"
                            className="bg-background text-sm"
                          />
                          <div className="flex items-center gap-2">
                            <label className="cursor-pointer">
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) void uploadCategoryImage(catIdx, f);
                                  e.currentTarget.value = "";
                                }}
                                disabled={uploadingCatImage === catIdx}
                              />
                              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                                uploadingCatImage === catIdx
                                  ? "bg-muted text-muted-foreground border-border/60"
                                  : "bg-primary/10 text-primary border-primary/25 hover:bg-primary/20"
                              }`}>
                                {uploadingCatImage === catIdx ? (
                                  <><Loader2 className="h-3 w-3 animate-spin" /> Uploading...</>
                                ) : (
                                  <><Plus className="h-3 w-3" /> {cat.image ? "Replace Image" : "Upload Image"}</>
                                )}
                              </span>
                            </label>
                            {cat.image && (
                              <button
                                onClick={() => updateField(`services.${catIdx}.image`, "")}
                                className="text-[11px] text-destructive/60 hover:text-destructive transition-colors"
                              >
                                Remove
                              </button>
                            )}
                            <span className="text-[10px] text-muted-foreground/60 ml-auto">
                              Shows in homepage &ldquo;Featured Services&rdquo;
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Service items */}
                    <div className="divide-y divide-border/30">
                      {cat.items.map((item, itemIdx) => (
                        <div key={itemIdx} className="grid grid-cols-[auto_1fr_1fr_80px_auto] gap-2 items-center px-5 py-3">
                          <div className="flex flex-col items-center gap-0 shrink-0">
                            <Button
                              variant="ghost" size="sm" className="h-5 w-5 p-0 text-muted-foreground/40 hover:text-foreground"
                              onClick={() => moveService(catIdx, itemIdx, -1)}
                              disabled={itemIdx === 0}
                              aria-label="Move service up"
                            >
                              <ChevronUp className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost" size="sm" className="h-5 w-5 p-0 text-muted-foreground/40 hover:text-foreground"
                              onClick={() => moveService(catIdx, itemIdx, 1)}
                              disabled={itemIdx === cat.items.length - 1}
                              aria-label="Move service down"
                            >
                              <ChevronDown className="h-3 w-3" />
                            </Button>
                          </div>
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
                            aria-label={`Delete service ${item.name || "item"}`}
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
                            src={img.src.startsWith("/") ? `${liveUrl ?? ""}${img.src}` : img.src}
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
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => moveGalleryImage(i, -1)}
                          disabled={i === 0}
                          aria-label="Move image up"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => moveGalleryImage(i, 1)}
                          disabled={i === config.gallery.length - 1}
                          aria-label="Move image down"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-destructive/40 hover:text-destructive"
                          onClick={() => removeGalleryImage(i)}
                          aria-label="Remove image"
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
                            value={(config.branding as unknown as Record<string, string>)?.[key] || "#000000"}
                            onChange={(e) => updateField(`branding.${key}`, e.target.value)}
                            className="h-9 w-9 rounded-lg border border-border/60 cursor-pointer bg-transparent"
                            aria-label={`${label} color picker`}
                          />
                          <Input
                            value={(config.branding as unknown as Record<string, string>)?.[key] || ""}
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

                {/* Template Switcher — staff only */}
                {canSwitchTpl && (
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
                )}
              </div>
            )}

            {/* ===== ABOUT TAB ===== */}
            {activeTab === "about" && (
              <div className="space-y-8">
                <Section title="About Your Salon">
                  <Field label="Welcome Message" hint="Introduce visitors to your salon">
                    <Textarea
                      value={config.about?.welcome || ""}
                      onChange={(e) => updateField("about.welcome", e.target.value)}
                      rows={4}
                      placeholder="Welcome to our salon..."
                    />
                  </Field>
                  <Field label="Our Mission" hint="What drives your salon">
                    <Textarea
                      value={config.about?.mission || ""}
                      onChange={(e) => updateField("about.mission", e.target.value)}
                      rows={4}
                      placeholder="Our mission is to..."
                    />
                  </Field>
                  <Field label="Sanitation & Safety" hint="Health and safety practices">
                    <Textarea
                      value={config.about?.sanitation || ""}
                      onChange={(e) => updateField("about.sanitation", e.target.value)}
                      rows={4}
                      placeholder="We prioritize your health and safety..."
                    />
                  </Field>
                  <Field label="Our Values" hint="One value per line">
                    <Textarea
                      value={(config.about?.values || []).join("\n")}
                      onChange={(e) => {
                        const lines = e.target.value.split("\n");
                        updateField("about.values", lines);
                      }}
                      rows={4}
                      placeholder={"Quality craftsmanship\nCustomer satisfaction\nCleanliness"}
                    />
                  </Field>
                </Section>
              </div>
            )}

            {/* ===== BLOG TAB ===== */}
            {activeTab === "blog" && (() => {
              const blogPosts = Array.isArray((config as Record<string, unknown>).blog) ? ((config as Record<string, unknown>).blog as Record<string, unknown>[]) : [];
              const [editingPost, setEditingPostState] = [
                (config as Record<string, unknown>).__editingBlogIdx as number | null ?? null,
                (idx: number | null) => {
                  setConfig((prev) => {
                    if (!prev) return prev;
                    const copy = { ...prev };
                    (copy as Record<string, unknown>).__editingBlogIdx = idx;
                    return copy;
                  });
                },
              ];

              const updatePost = (idx: number, field: string, value: string) => {
                setConfig((prev) => {
                  if (!prev) return prev;
                  const copy = JSON.parse(JSON.stringify(prev));
                  copy.blog[idx][field] = value;
                  if (field === "title") {
                    copy.blog[idx].slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                  }
                  return copy;
                });
                setDirty(true);
              };

              const addPost = () => {
                setConfig((prev) => {
                  if (!prev) return prev;
                  const copy = JSON.parse(JSON.stringify(prev));
                  const posts = Array.isArray(copy.blog) ? copy.blog : [];
                  posts.unshift({
                    slug: `new-post-${Date.now()}`,
                    title: "",
                    excerpt: "",
                    content: "",
                    date: new Date().toISOString().split("T")[0],
                    image: "",
                    category: "",
                  });
                  copy.blog = posts;
                  copy.__editingBlogIdx = 0;
                  return copy;
                });
                setDirty(true);
              };

              const deletePost = (idx: number) => {
                if (!window.confirm(`Delete "${blogPosts[idx]?.title || "this post"}"?`)) return;
                setConfig((prev) => {
                  if (!prev) return prev;
                  const copy = JSON.parse(JSON.stringify(prev));
                  copy.blog.splice(idx, 1);
                  copy.__editingBlogIdx = null;
                  return copy;
                });
                setDirty(true);
              };

              // ── EDITING VIEW ──
              if (editingPost !== null && blogPosts[editingPost]) {
                const post = blogPosts[editingPost];
                const idx = editingPost;
                return (
                  <div className="space-y-5">
                    <button
                      onClick={() => setEditingPostState(null)}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ArrowLeft className="h-3 w-3" /> Back to all posts
                    </button>

                    <div className="space-y-4">
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1">Title</Label>
                        <Input value={String(post.title || "")} onChange={(e) => updatePost(idx, "title", e.target.value)} placeholder="Post title" className="bg-background text-lg font-semibold" />
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1">Date</Label>
                          <Input type="date" value={String(post.date || "")} onChange={(e) => updatePost(idx, "date", e.target.value)} className="bg-background" />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1">Category</Label>
                          <Input value={String(post.category || "")} onChange={(e) => updatePost(idx, "category", e.target.value)} placeholder="Nail Care" className="bg-background" />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1">Read Time</Label>
                          <Input value={String(post.readTime || "")} onChange={(e) => updatePost(idx, "readTime", e.target.value)} placeholder="5 min read" className="bg-background" />
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs text-muted-foreground mb-1">Featured Image URL</Label>
                        <Input value={String(post.image || "")} onChange={(e) => updatePost(idx, "image", e.target.value)} placeholder="/assets/images/blog-photo.jpg" className="bg-background" />
                        {post.image && String(post.image).startsWith("http") ? (
                          <div className="mt-2 rounded-lg overflow-hidden h-40 bg-muted">
                            <img src={String(post.image)} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                          </div>
                        ) : null}
                      </div>

                      <div>
                        <Label className="text-xs text-muted-foreground mb-1">Excerpt</Label>
                        <Textarea value={String(post.excerpt || "")} onChange={(e) => updatePost(idx, "excerpt", e.target.value)} placeholder="Brief summary for the blog listing..." rows={3} className="bg-background" />
                      </div>

                      <Separator />

                      <div>
                        <Label className="text-xs text-muted-foreground mb-1">Content (HTML)</Label>
                        <Textarea value={String(post.content || "")} onChange={(e) => updatePost(idx, "content", e.target.value)} placeholder="<p>Write your blog post here...</p>" rows={16} className="bg-background font-mono text-xs leading-relaxed" />
                      </div>

                      {/* Content preview */}
                      {String(post.content || "").length > 0 ? (
                        <div>
                          <Label className="text-xs text-muted-foreground mb-2">Preview</Label>
                          <div className="border border-border/40 rounded-lg p-5 bg-background prose prose-sm prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: String(post.content) }} />
                        </div>
                      ) : null}

                      <div className="flex items-center justify-between pt-2">
                        <button onClick={() => setEditingPostState(null)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                          ← Done editing
                        </button>
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5" onClick={() => deletePost(idx)}>
                          <Trash2 className="h-3.5 w-3.5" /> Delete Post
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              }

              // ── LIST VIEW (overview cards) ──
              return (
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Blog Posts ({blogPosts.length})</h3>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={addPost}>
                      <Plus className="h-3.5 w-3.5" /> New Post
                    </Button>
                  </div>

                  {blogPosts.length === 0 ? (
                    <div className="text-center py-16 text-muted-foreground">
                      <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm font-medium">No blog posts yet</p>
                      <p className="text-xs mt-1 mb-4">Blog posts help with SEO and keep customers engaged</p>
                      <Button variant="outline" size="sm" className="gap-1.5" onClick={addPost}>
                        <Plus className="h-3.5 w-3.5" /> Create First Post
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {blogPosts.map((post, idx) => {
                        const hasImage = post.image && String(post.image).length > 1;
                        const title = String(post.title || "Untitled Post");
                        const excerpt = String(post.excerpt || "").slice(0, 120);
                        const date = post.date ? new Date(String(post.date)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
                        const category = String(post.category || "");
                        const contentLen = String(post.content || "").length;

                        return (
                          <div
                            key={idx}
                            className="group border border-border/50 rounded-xl overflow-hidden hover:border-primary/30 transition-all cursor-pointer bg-card"
                            onClick={() => setEditingPostState(idx)}
                          >
                            <div className="flex">
                              {/* Thumbnail */}
                              {hasImage && String(post.image).startsWith("http") ? (
                                <div className="w-28 h-28 md:w-36 md:h-28 shrink-0 bg-muted">
                                  <img src={String(post.image)} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = "none"; }} />
                                </div>
                              ) : (
                                <div className="w-28 h-28 md:w-36 md:h-28 shrink-0 bg-muted/30 flex items-center justify-center">
                                  <FileText className="h-6 w-6 text-muted-foreground/30" />
                                </div>
                              )}

                              {/* Content */}
                              <div className="flex-1 p-4 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <h4 className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                                      {title}
                                    </h4>
                                    <div className="flex items-center gap-2 mt-1">
                                      {date && <span className="text-[10px] text-muted-foreground">{date}</span>}
                                      {category && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">{category}</span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                    <button
                                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                                      onClick={(e) => { e.stopPropagation(); setEditingPostState(idx); }}
                                      aria-label="Edit post"
                                    >
                                      <ClipboardList className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                      onClick={(e) => { e.stopPropagation(); deletePost(idx); }}
                                      aria-label="Delete post"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                                {excerpt && (
                                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2 leading-relaxed">{excerpt}</p>
                                )}
                                {!excerpt && contentLen > 0 && (
                                  <p className="text-xs text-muted-foreground/50 mt-2 italic">{contentLen} characters of content</p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ===== SEO TAB ===== */}
            {activeTab === "seo" && (
              <div className="space-y-8">
                <Section title="Search Engine Optimization">
                  <Field label="Page Title" hint="Shows in browser tab and search results">
                    <Input
                      value={config.meta?.title || ""}
                      onChange={(e) => updateField("meta.title", e.target.value)}
                      placeholder="e.g., Queen Nail Spa - Best Nail Salon in Houston"
                    />
                  </Field>
                  <Field label="Meta Description" hint="Appears in search result snippets">
                    <Textarea
                      value={config.meta?.description || ""}
                      onChange={(e) => updateField("meta.description", e.target.value)}
                      rows={3}
                      placeholder="A brief description of the salon for search engines..."
                    />
                    <p className="text-[10px] text-muted-foreground/60">
                      {(config.meta?.description || "").length} / 160 characters
                    </p>
                  </Field>
                  <Field label="Keywords" hint="Comma-separated keywords">
                    <Input
                      value={config.meta?.keywords || ""}
                      onChange={(e) => updateField("meta.keywords", e.target.value)}
                      placeholder="nail salon, manicure, pedicure, houston"
                    />
                  </Field>
                  <Field label="Social Share Image URL" hint="Image shown when shared on social media (og:image)">
                    <Input
                      value={config.meta?.ogImage || ""}
                      onChange={(e) => updateField("meta.ogImage", e.target.value)}
                      placeholder="https://example.com/og-image.jpg"
                    />
                  </Field>
                  <Field label="Canonical URL" hint="Preferred URL for this page">
                    <Input
                      value={config.meta?.url || ""}
                      onChange={(e) => updateField("meta.url", e.target.value)}
                      placeholder="https://yoursalon.com"
                    />
                  </Field>
                </Section>
              </div>
            )}

            {/* ===== HISTORY TAB ===== */}
            {activeTab === "history" && (
              <RevisionHistoryPanel
                slug={slug}
                currentConfig={config as unknown as Record<string, unknown>}
                onRestored={(restored) => {
                  setConfig(restored as unknown as SalonConfig);
                  initialConfigRef.current = JSON.stringify(restored);
                  setDirty(false);
                  setSaveStatus("saved");
                  toast("Revision restored. Saved as a new revision so you can undo.", "success");
                }}
              />
            )}

            {/* ===== SETTINGS TAB ===== */}
            {activeTab === "settings" && shouldShowTab("settings", userRole) && (
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

                {shouldShowField("siteStatus", userRole) && (
                  <Section title="Publishing">
                    <Field label="Site Status">
                      <select
                        value={(config.siteStatus as string | undefined) ?? "staging"}
                        onChange={(e) => updateField("siteStatus", e.target.value)}
                        className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        <option value="staging">Staging -- site is under construction</option>
                        <option value="production">Production -- site is live</option>
                      </select>
                    </Field>
                    {shouldShowField("stagingDomain", userRole) && (
                      <Field label="Staging Domain" hint="e.g. nailsalon12.mangotemplates.us">
                        <Input
                          value={(config.stagingDomain as string | undefined) || ""}
                          onChange={(e) => updateField("stagingDomain", e.target.value)}
                          placeholder="nailsalon12.mangotemplates.us"
                        />
                      </Field>
                    )}
                    {shouldShowField("domain", userRole) && (
                      <Field label="Production Domain" hint="e.g. queennailspa.net">
                        <Input
                          value={(config.domain as string | undefined) || ""}
                          onChange={(e) => updateField("domain", e.target.value)}
                          placeholder="yoursalon.com"
                        />
                      </Field>
                    )}
                  </Section>
                )}

                {shouldShowField("domainOwnership", userRole) && (
                  <Section title="Ownership &amp; Management">
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Domain Ownership" hint="Who owns this domain?">
                        <select
                          value={(config.domainOwnership as string | undefined) ?? ""}
                          onChange={(e) => updateField("domainOwnership", e.target.value || undefined)}
                          className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="">Not set</option>
                          <option value="enrichco">EnrichCo — we own the domain</option>
                          <option value="client">Client — salon owns the domain</option>
                        </select>
                      </Field>
                      {shouldShowField("websiteManager", userRole) && (
                        <Field label="Website Manager" hint="Who manages this website?">
                          <select
                            value={(config.websiteManager as string | undefined) ?? ""}
                            onChange={(e) => updateField("websiteManager", e.target.value || undefined)}
                            className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                          >
                            <option value="">Not set</option>
                            <option value="ai-team">AI Team — managed via CMS</option>
                            <option value="marketing-team">Marketing Team — managed via FTP</option>
                          </select>
                        </Field>
                      )}
                    </div>
                  </Section>
                )}

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

      {/* ===== GO LIVE CONFIRMATION DIALOG ===== */}
      {showGoLiveConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-4">
          <div className="bg-card border border-border/60 rounded-xl p-6 max-w-md w-full shadow-xl">
            <h3 className="text-lg font-semibold text-foreground mb-2">Go Live?</h3>
            <p className="text-sm text-muted-foreground mb-1">
              This will update <strong className="text-foreground">{config?.domain || "the production site"}</strong> for customers.
            </p>
            <p className="text-xs text-muted-foreground mb-6">Changes will be visible immediately.</p>
            <div className="flex items-center justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setShowGoLiveConfirm(false)}>Cancel</Button>
              <Button size="sm" onClick={confirmGoLive} className="gap-2 bg-green-600 hover:bg-green-700">
                <Rocket className="h-3.5 w-3.5" /> Go Live
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ===== STICKY FOOTER BAR ===== */}
      <div className="sticky bottom-0 border-t border-border/60 bg-[oklch(0.14_0_0)] backdrop-blur-sm z-10" role="status" aria-live="polite">
        <div className="max-w-3xl mx-auto px-4 md:px-8 py-3 flex items-center justify-between">
          {/* Save status indicator */}
          <div className="flex items-center gap-2 text-xs">
            {saveStatus === "saving" && (
              <><Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Saving...</span></>
            )}
            {saveStatus === "saved" && !dirty && (
              <><Save className="h-3 w-3 text-green-400" /><span className="text-green-400">All changes saved</span></>
            )}
            {saveStatus === "error" && (
              <button onClick={() => flushSave()} className="flex items-center gap-1.5 text-destructive hover:text-destructive/80">
                <Save className="h-3 w-3" /><span>Save failed — click to retry</span>
              </button>
            )}
            {saveStatus === "idle" && !dirty && (
              <span className="text-muted-foreground/50">No changes</span>
            )}
            {dirty && saveStatus !== "saving" && (
              <><Loader2 className="h-3 w-3 text-amber-400" /><span className="text-amber-400">Editing...</span></>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreview}
              disabled={previewing || publishing || saveStatus === "error"}
              className="gap-2"
            >
              {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
              {previewing ? "Building..." : "Publish to Staging"}
            </Button>
            {canPublish && (
              <Button
                size="sm"
                onClick={handleGoLive}
                disabled={publishing || previewing || saveStatus === "error"}
                className="gap-2 bg-green-600 hover:bg-green-700"
              >
                {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
                {publishing ? "Publishing..." : "Go Live"}
              </Button>
            )}
          </div>
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        {hint && <span className="text-[10px] text-muted-foreground/50">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/* ===== REVISION HISTORY PANEL ===== */

interface RevisionRow {
  id: string;
  timestamp: string;
  fileBytes: number;
  author: string | null;
  action: string | null;
  changedFields: string[] | null;
}

const INITIAL_ROWS = 50;

function RevisionHistoryPanel({
  slug,
  currentConfig,
  onRestored,
}: {
  slug: string;
  currentConfig: Record<string, unknown>;
  onRestored: (restored: Record<string, unknown>) => void;
}) {
  const [revisions, setRevisions] = useState<RevisionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [viewRevision, setViewRevision] = useState<RevisionRow | null>(null);
  const [viewContent, setViewContent] = useState<Record<string, unknown> | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<RevisionRow | null>(null);
  const [restoring, setRestoring] = useState(false);

  const loadRevisions = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/salon/${slug}/revisions`);
      if (!res.ok) {
        setError("Failed to load revisions");
        return;
      }
      const data = await res.json();
      setRevisions(data.revisions ?? []);
    } catch {
      setError("Failed to load revisions");
    }
  }, [slug]);

  useEffect(() => {
    void loadRevisions();
  }, [loadRevisions]);

  const openViewModal = async (r: RevisionRow) => {
    setViewRevision(r);
    setViewContent(null);
    setViewLoading(true);
    try {
      const res = await fetch(`/api/salon/${slug}/revisions/${encodeURIComponent(r.id)}`);
      if (!res.ok) {
        setError("Failed to load revision content");
        setViewRevision(null);
        return;
      }
      setViewContent(await res.json());
    } catch {
      setError("Failed to load revision content");
      setViewRevision(null);
    } finally {
      setViewLoading(false);
    }
  };

  const closeViewModal = () => {
    setViewRevision(null);
    setViewContent(null);
  };

  const confirmRestore = async () => {
    if (!restoreTarget || restoring) return;
    setRestoring(true);
    try {
      const res = await fetch(
        `/api/salon/${slug}/revisions/${encodeURIComponent(restoreTarget.id)}/restore`,
        { method: "POST" }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || "Restore failed");
        setRestoreTarget(null);
        return;
      }
      // Fetch new live salon.json so the editor reflects the restored state.
      const refreshed = await fetch(`/api/salon/${slug}`).then((r) => (r.ok ? r.json() : null));
      if (refreshed) onRestored(refreshed);
      setRestoreTarget(null);
      void loadRevisions();
    } catch {
      setError("Restore failed");
      setRestoreTarget(null);
    } finally {
      setRestoring(false);
    }
  };

  if (error && !revisions) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {error} — <button onClick={loadRevisions} className="underline">retry</button>
      </div>
    );
  }
  if (!revisions) {
    return <div className="text-xs text-muted-foreground">Loading history…</div>;
  }
  if (revisions.length === 0) {
    return (
      <div className="rounded-md border border-border/60 bg-muted/10 p-4 text-xs text-muted-foreground">
        No revisions yet. Backups are created automatically every time you save.
      </div>
    );
  }

  const visible = showAll ? revisions : revisions.slice(0, INITIAL_ROWS);

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="underline">dismiss</button>
        </div>
      )}
      <ul className="space-y-2">
        {visible.map((r) => (
          <li
            key={r.id}
            className="rounded-lg border border-border/60 bg-card/30 p-3 flex items-start gap-3"
          >
            <History className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium">{formatRevisionTimestamp(r.timestamp)}</span>
                {r.action === "restore" && (
                  <Badge variant="outline" className="text-[10px] bg-blue-500/15 text-blue-400 border-blue-500/25">
                    Restore
                  </Badge>
                )}
              </div>
              {r.author && <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{r.author}</div>}
              {r.changedFields && r.changedFields.length > 0 && (
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Changed: {r.changedFields.slice(0, 6).join(", ")}{r.changedFields.length > 6 ? ` +${r.changedFields.length - 6}` : ""}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button size="sm" variant="outline" onClick={() => openViewModal(r)} className="gap-1 h-7 text-xs">
                <Eye className="h-3 w-3" /> View
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRestoreTarget(r)} className="gap-1 h-7 text-xs">
                <RotateCcw className="h-3 w-3" /> Restore
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {revisions.length > INITIAL_ROWS && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          Show older ({revisions.length - INITIAL_ROWS} more)
        </button>
      )}

      {viewRevision && (
        <RevisionDiffModal
          revision={viewRevision}
          loading={viewLoading}
          oldContent={viewContent}
          currentContent={currentConfig}
          onClose={closeViewModal}
        />
      )}

      {restoreTarget && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-4">
          <div className="bg-card border border-border/60 rounded-xl p-6 max-w-md w-full shadow-xl">
            <h3 className="text-lg font-semibold text-foreground mb-2">Restore to this revision?</h3>
            <p className="text-sm text-muted-foreground mb-1">
              {formatRevisionTimestamp(restoreTarget.timestamp)} {restoreTarget.author ? `by ${restoreTarget.author}` : ""}
            </p>
            <p className="text-xs text-muted-foreground mb-6">
              Your current draft will be saved as a new revision so you can undo this.
            </p>
            <div className="flex items-center justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setRestoreTarget(null)} disabled={restoring}>Cancel</Button>
              <Button size="sm" onClick={confirmRestore} disabled={restoring} className="gap-2">
                {restoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                {restoring ? "Restoring..." : "Restore"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatRevisionTimestamp(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  // Compact UTC format: YYYY-MM-DD HH:MM UTC
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

function RevisionDiffModal({
  revision,
  loading,
  oldContent,
  currentContent,
  onClose,
}: {
  revision: RevisionRow;
  loading: boolean;
  oldContent: Record<string, unknown> | null;
  currentContent: Record<string, unknown>;
  onClose: () => void;
}) {
  const rows = oldContent ? diffRows(oldContent, currentContent) : [];
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-4">
      <div className="bg-card border border-border/60 rounded-xl max-w-5xl w-full max-h-[85vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">Revision {formatRevisionTimestamp(revision.timestamp)}</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Comparing this revision (left) to your current draft (right)
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted/50" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 text-xs font-mono">
          {loading && <div className="text-muted-foreground">Loading…</div>}
          {!loading && oldContent && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">This revision</div>
                <div className="rounded-md border border-border/60 bg-background/50 p-2 space-y-0.5">
                  {rows.map((row, i) => (
                    <div
                      key={`l-${i}`}
                      className={
                        row.kind === "remove"
                          ? "bg-red-500/10 text-red-300 rounded px-1"
                          : row.kind === "change"
                          ? "bg-amber-500/10 text-amber-200 rounded px-1"
                          : row.kind === "add"
                          ? "text-muted-foreground/30 px-1"
                          : "text-muted-foreground px-1"
                      }
                    >
                      <span className="text-muted-foreground/50 mr-2">{row.key}:</span>
                      <span className="break-all">{row.kind === "add" ? "—" : jsonShort(row.oldVal)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Current draft</div>
                <div className="rounded-md border border-border/60 bg-background/50 p-2 space-y-0.5">
                  {rows.map((row, i) => (
                    <div
                      key={`r-${i}`}
                      className={
                        row.kind === "add"
                          ? "bg-green-500/10 text-green-300 rounded px-1"
                          : row.kind === "change"
                          ? "bg-amber-500/10 text-amber-200 rounded px-1"
                          : row.kind === "remove"
                          ? "text-muted-foreground/30 px-1"
                          : "text-muted-foreground px-1"
                      }
                    >
                      <span className="text-muted-foreground/50 mr-2">{row.key}:</span>
                      <span className="break-all">{row.kind === "remove" ? "—" : jsonShort(row.newVal)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {!loading && rows.length === 0 && oldContent && (
            <div className="text-muted-foreground">No differences.</div>
          )}
        </div>
      </div>
    </div>
  );
}

type DiffKind = "same" | "add" | "remove" | "change";
interface DiffRow { key: string; kind: DiffKind; oldVal: unknown; newVal: unknown }

function diffRows(oldObj: Record<string, unknown>, newObj: Record<string, unknown>): DiffRow[] {
  const keys = Array.from(new Set([...Object.keys(oldObj), ...Object.keys(newObj)])).sort();
  const rows: DiffRow[] = [];
  for (const k of keys) {
    const inOld = Object.prototype.hasOwnProperty.call(oldObj, k);
    const inNew = Object.prototype.hasOwnProperty.call(newObj, k);
    const oldVal = oldObj[k];
    const newVal = newObj[k];
    let kind: DiffKind;
    if (inOld && !inNew) kind = "remove";
    else if (!inOld && inNew) kind = "add";
    else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) kind = "change";
    else kind = "same";
    rows.push({ key: k, kind, oldVal, newVal });
  }
  return rows;
}

function jsonShort(val: unknown): string {
  if (val === undefined) return "undefined";
  const s = JSON.stringify(val);
  if (s === undefined) return String(val);
  if (s.length > 400) return s.slice(0, 400) + "…";
  return s;
}
