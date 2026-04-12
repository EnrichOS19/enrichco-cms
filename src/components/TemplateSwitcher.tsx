"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/Toast";
import { CheckCircle2, Loader2, Palette } from "lucide-react";

interface Template {
  id: string;
  name: string;
  path: string;
  tags: string[];
  palette: string[];
  bestFor: string;
  addedDate: string;
  source: string;
}

const TAG_FILTERS = ["All", "Luxury", "Modern", "Vibrant", "Spa", "Boutique", "Classic", "Specialty"] as const;

const TAG_COLORS: Record<string, string> = {
  luxury: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  modern: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  vibrant: "bg-pink-500/15 text-pink-400 border-pink-500/20",
  spa: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  boutique: "bg-purple-500/15 text-purple-400 border-purple-500/20",
  classic: "bg-orange-500/15 text-orange-400 border-orange-500/20",
  dark: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
  editorial: "bg-rose-500/15 text-rose-400 border-rose-500/20",
  minimal: "bg-slate-500/15 text-slate-400 border-slate-500/20",
  "booking-first": "bg-teal-500/15 text-teal-400 border-teal-500/20",
};

export function TemplateSwitcher({
  slug,
  currentTemplate,
}: {
  slug: string;
  currentTemplate?: string;
}) {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState("All");
  const [confirmTemplate, setConfirmTemplate] = useState<Template | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => r.json())
      .then((data) => {
        setTemplates(data.templates || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered =
    activeFilter === "All"
      ? templates
      : templates.filter((t) =>
          t.tags.some((tag) => tag.toLowerCase() === activeFilter.toLowerCase())
        );

  const handleSwitch = async (template: Template) => {
    setSwitching(template.id);
    setConfirmTemplate(null);

    try {
      const res = await fetch(`/api/salon/${slug}/switch-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template.id }),
      });
      const data = await res.json();
      if (data.success) {
        toast("Template switched and deployed!", "success");
      } else {
        toast(data.message || "Switch failed", "error");
      }
    } catch {
      toast("Network error — could not reach the server.", "error");
    } finally {
      setSwitching(null);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-48 rounded-xl bg-muted/50 animate-pulse" />
        ))}
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Palette className="h-8 w-8 text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground">No templates available</p>
      </div>
    );
  }

  return (
    <>
      {/* Tag filter pills */}
      <div className="flex flex-wrap gap-2 mb-5">
        {TAG_FILTERS.map((tag) => (
          <button
            key={tag}
            onClick={() => setActiveFilter(tag)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
              activeFilter === tag
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {tag}
          </button>
        ))}
      </div>

      {/* Template grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((template) => {
          const isCurrent = template.id === currentTemplate;
          const isSwitching = switching === template.id;
          return (
            <div
              key={template.id}
              className={`relative rounded-xl border overflow-hidden transition-all ${
                isCurrent
                  ? "border-emerald-500/40 ring-1 ring-emerald-500/20"
                  : "border-border/60 hover:border-primary/40"
              }`}
            >
              {/* Palette swatch header */}
              <div className="h-16 flex">
                {template.palette.slice(0, 5).map((color, i) => (
                  <div
                    key={i}
                    className="flex-1"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>

              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <h3 className="text-sm font-semibold">{template.name}</h3>
                  {isCurrent && (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  )}
                </div>

                {/* Tags */}
                <div className="flex flex-wrap gap-1">
                  {template.tags.map((tag) => (
                    <span
                      key={tag}
                      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${TAG_COLORS[tag] || "bg-zinc-500/15 text-zinc-400 border-zinc-500/20"}`}
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                  {template.bestFor}
                </p>

                <Button
                  variant={isCurrent ? "outline" : "default"}
                  size="sm"
                  className="w-full text-xs"
                  disabled={isCurrent || switching !== null}
                  onClick={() => setConfirmTemplate(template)}
                >
                  {isSwitching ? (
                    <>
                      <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                      Rebuilding...
                    </>
                  ) : isCurrent ? (
                    "Active Template"
                  ) : (
                    "Apply Template"
                  )}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No templates match this filter.
        </p>
      )}

      {/* Confirmation dialog */}
      <Dialog
        open={confirmTemplate !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmTemplate(null);
        }}
      >
        {confirmTemplate && (
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Switch to {confirmTemplate.name}?</DialogTitle>
              <DialogDescription>
                This changes the design only. All your content (hours, services,
                photos) will be kept.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmTemplate(null)}>
                Cancel
              </Button>
              <Button onClick={() => handleSwitch(confirmTemplate)}>
                Apply Template
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
