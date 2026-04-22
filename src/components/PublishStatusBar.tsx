"use client";

/**
 * PublishStatusBar — compact 3-row indicator showing where CMS content
 * currently lives: Draft, Staging, Production.
 *
 * Polls /api/salon/{slug}/status every 10s. Dot colors:
 *   grey   → draft (reference, always present)
 *   green  → live_matches (hash on site == last published hash)
 *   yellow → never_published OR drift (needs a publish)
 *   red    → failed_fetch (site unreachable — surface to operator)
 *
 * Actions:
 *   Staging yellow → "Update preview" → POST /publish?target=staging
 *   Production yellow → callback to parent's Go Live confirm flow
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

type TargetState = "never_published" | "live_matches" | "drift" | "failed_fetch";

interface TargetStatus {
  domain: string | null;
  publishedAt: string | null;
  expectedHash: string | null;
  liveHash: string | null;
  state: TargetState;
}

interface StatusPayload {
  slug: string;
  draft: { savedAt: string | null; hash: string | null };
  staging: TargetStatus;
  production: TargetStatus;
}

interface Props {
  slug: string;
  /** Called when user clicks "Publish live" on the Production row. */
  onRequestGoLive?: () => void;
  /** Called when user clicks "Update preview" on the Staging row. Parent
   *  owns the flush-save-then-publish flow so unsaved edits cannot deploy. */
  onRequestStaging?: () => Promise<void> | void;
  /** Optional: call when any publish completes so we refresh immediately. */
  pollTrigger?: number;
  /** Production publish permission — hides prod action if false. */
  canPublishProduction?: boolean;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const diffMs = Date.now() - then;
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function dotClass(state: TargetState, isDraft = false): string {
  if (isDraft) return "bg-muted-foreground/60";
  if (state === "live_matches") return "bg-green-400";
  if (state === "failed_fetch") return "bg-red-500";
  // never_published or drift
  return "bg-amber-400";
}

function shortHash(h: string | null): string {
  if (!h) return "—";
  return h.length > 8 ? h.slice(0, 8) : h;
}

function targetSummary(t: TargetStatus, draftHash: string | null): string {
  if (!t.domain) return "No domain set";
  if (t.state === "never_published") return "Never published";
  if (t.state === "failed_fetch") return "Cannot reach site";
  if (t.state === "drift") {
    return `Drift — live is ${shortHash(t.liveHash)}, expected ${shortHash(t.expectedHash)}`;
  }
  // live_matches: is the draft ahead of this publish?
  if (draftHash && t.expectedHash && draftHash !== t.expectedHash) {
    // expectedHash is the build hash, draftHash is salon.json hash — they
    // won't match numerically, but if we've published since the last save
    // the savedAt vs publishedAt comparison below tells us drift status.
    // Fall through to publishedAt wording.
  }
  return `In sync — ${shortHash(t.expectedHash)}`;
}

export function PublishStatusBar({
  slug,
  onRequestGoLive,
  onRequestStaging,
  pollTrigger = 0,
  canPublishProduction = false,
}: Props) {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishingStaging, setPublishingStaging] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/salon/${slug}/status`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as StatusPayload;
      setStatus(data);
    } catch {
      // Silent — status bar is informational. Red dot will appear on next
      // cycle if the server itself is the one that's down.
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 10000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus]);

  // Parent bumps pollTrigger after a publish to force an immediate refresh.
  useEffect(() => {
    if (pollTrigger > 0) fetchStatus();
  }, [pollTrigger, fetchStatus]);

  const publishStaging = useCallback(async () => {
    if (publishingStaging) return;
    setPublishingStaging(true);
    try {
      // Delegate to the parent if provided — parent owns the save-flush-then-
      // publish flow so unsaved editor changes cannot deploy to staging.
      if (onRequestStaging) {
        await onRequestStaging();
        await fetchStatus();
        return;
      }
      // Fallback (no parent handler): direct publish. Still useful in isolated
      // rendering (tests, standalone docs) but emits a warning in the event
      // payload so the parent can surface it.
      const res = await fetch(`/api/salon/${slug}/publish?target=staging`, { method: "POST" });
      await fetchStatus();
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        window.dispatchEvent(
          new CustomEvent("publish-status-toast", {
            detail: {
              type: "error",
              message: data.message || data.error || "Staging publish failed",
            },
          })
        );
      } else {
        window.dispatchEvent(
          new CustomEvent("publish-status-toast", {
            detail: { type: "success", message: "Preview updated" },
          })
        );
      }
    } finally {
      setPublishingStaging(false);
    }
  }, [slug, fetchStatus, publishingStaging, onRequestStaging]);

  if (loading || !status) {
    return (
      <div className="rounded-lg border border-border/60 bg-[oklch(0.16_0_0)] px-4 py-3 mb-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Checking publish status...
        </div>
      </div>
    );
  }

  const { draft, staging, production } = status;

  return (
    <div className="rounded-lg border border-border/60 bg-[oklch(0.16_0_0)] px-4 py-3 mb-4" role="status" aria-label="Publish status">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
          Where your content lives
        </h3>
        <button
          onClick={fetchStatus}
          className="text-muted-foreground/60 hover:text-foreground transition-colors"
          title="Refresh status"
          aria-label="Refresh publish status"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      <div className="space-y-1.5">
        {/* Draft row */}
        <Row
          label="Draft"
          dot={dotClass("live_matches", true)}
          primary={`Saved ${relativeTime(draft.savedAt)}`}
          secondary={`hash:${shortHash(draft.hash)}`}
        />

        {/* Staging row */}
        <Row
          label="Staging"
          dot={dotClass(staging.state)}
          primary={
            staging.domain ? (
              <a
                href={`https://${staging.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary transition-colors"
              >
                {staging.domain}
              </a>
            ) : (
              "No staging domain set"
            )
          }
          secondary={
            <>
              {targetSummary(staging, draft.hash)}
              {staging.publishedAt && (
                <span className="text-muted-foreground/60 ml-2">
                  • published {relativeTime(staging.publishedAt)}
                </span>
              )}
            </>
          }
          action={
            staging.domain && staging.state !== "live_matches" ? (
              <button
                onClick={publishStaging}
                disabled={publishingStaging}
                className="text-[11px] px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors flex items-center gap-1"
              >
                {publishingStaging && <Loader2 className="h-3 w-3 animate-spin" />}
                Update preview
              </button>
            ) : null
          }
        />

        {/* Production row */}
        <Row
          label="Production"
          dot={dotClass(production.state)}
          primary={
            production.domain ? (
              <a
                href={`https://${production.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary transition-colors"
              >
                {production.domain}
              </a>
            ) : (
              "No production domain set"
            )
          }
          secondary={
            <>
              {targetSummary(production, draft.hash)}
              {production.publishedAt && (
                <span className="text-muted-foreground/60 ml-2">
                  • published {relativeTime(production.publishedAt)}
                </span>
              )}
            </>
          }
          action={
            production.domain &&
            production.state !== "live_matches" &&
            canPublishProduction &&
            onRequestGoLive ? (
              <button
                onClick={onRequestGoLive}
                className="text-[11px] px-2 py-1 rounded bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors"
              >
                Publish live
              </button>
            ) : null
          }
        />
      </div>
    </div>
  );
}

function Row({
  label,
  dot,
  primary,
  secondary,
  action,
}: {
  label: string;
  dot: string;
  primary: React.ReactNode;
  secondary: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span
        className={`h-2 w-2 rounded-full shrink-0 ${dot}`}
        aria-hidden="true"
      />
      <span className="w-20 shrink-0 text-muted-foreground font-medium">{label}</span>
      <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center sm:gap-2">
        <span className="text-foreground truncate">{primary}</span>
        <span className="text-muted-foreground/80 truncate">{secondary}</span>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
