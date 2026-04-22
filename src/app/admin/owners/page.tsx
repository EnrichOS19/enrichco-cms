"use client";

/**
 * /admin/owners — Admin page to view and manage salon owner access grants.
 *
 * Features:
 *  - Table of existing owner→salon grants (email, salon, granted by, granted at, revoke)
 *  - Add-owner form: salon dropdown + email input
 *  - Live IMS lookup (debounced 500 ms) shows merchant name inline before confirm
 *  - Submits to POST /api/admin/salon-access
 *  - Revoke hits DELETE /api/admin/salon-access
 *
 * Access: admin-only. Non-admin users land here and see an access-denied screen.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Shield,
  ShieldCheck,
  Users,
  UserPlus,
  Loader2,
  Trash2,
  CheckCircle,
  AlertCircle,
  Info,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface SalonOption {
  slug: string;
  name: string;
}

interface OwnerGrant {
  email: string;
  slug: string;
  grantedBy: string;
  grantedAt: number;
  imsStoreId: string | null;
}

interface ImsLookupResult {
  found: boolean;
  name?: string;
  businessName?: string;
  storeID?: number;
  suggestedSlug?: string | null;
  warning?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Page Component ────────────────────────────────────────────────────────────

export default function AdminOwnersPage() {
  // ── data state ──────────────────────────────────────────────────────────────
  const [salons, setSalons] = useState<SalonOption[]>([]);
  const [grants, setGrants] = useState<OwnerGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);

  // ── form state ──────────────────────────────────────────────────────────────
  const [selectedSlug, setSelectedSlug] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ ok: boolean; message: string } | null>(null);

  // ── IMS lookup state ────────────────────────────────────────────────────────
  const [imsLooking, setImsLooking] = useState(false);
  const [imsResult, setImsResult] = useState<ImsLookupResult | null>(null);
  // Tracks the email string the current imsResult corresponds to, so stale
  // network responses (e.g. user types `a@b.com` then immediately `c@d.com`
  // and the first request lands last) don't apply mismatched data.
  const [imsResultForEmail, setImsResultForEmail] = useState<string>("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imsRequestIdRef = useRef(0);

  // ── revoke state ────────────────────────────────────────────────────────────
  const [revoking, setRevoking] = useState<string | null>(null); // "email::slug"

  // ── data loading ─────────────────────────────────────────────────────────────

  async function loadData() {
    try {
      const [salonsRes, grantsRes] = await Promise.all([
        fetch("/api/salons"),
        fetch("/api/admin/salon-access?all=true"),
      ]);

      if (salonsRes.status === 403 || grantsRes.status === 403) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      if (salonsRes.ok) {
        const data = await salonsRes.json() as { slug: string; name: string }[];
        setSalons(data.map((s) => ({ slug: s.slug, name: s.name })));
        if (data.length > 0 && !selectedSlug) {
          setSelectedSlug(data[0].slug);
        }
      }

      if (grantsRes.ok) {
        const data = await grantsRes.json() as { grants: OwnerGrant[] };
        setGrants(data.grants ?? []);
      }
    } catch {
      // network error — leave empty state
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── IMS lookup (debounced) ────────────────────────────────────────────────

  const doImsLookup = useCallback(async (emailVal: string) => {
    const trimmed = emailVal.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setImsResult(null);
      setImsResultForEmail("");
      return;
    }
    // Monotonic request ID — drop responses whose request was superseded by a
    // later one so slow/out-of-order responses can't overwrite fresh results
    // or auto-select the wrong salon for the current email.
    const reqId = ++imsRequestIdRef.current;
    setImsLooking(true);
    try {
      const res = await fetch(`/api/admin/ims-lookup?email=${encodeURIComponent(trimmed)}`);
      const data = await res.json() as ImsLookupResult;
      if (reqId !== imsRequestIdRef.current) return; // superseded — drop
      setImsResult(data);
      setImsResultForEmail(trimmed);
      // Auto-select the matching salon when IMS provided one. Admin can still
      // override via the dropdown — this is a suggestion, not a lock.
      if (data.found && data.suggestedSlug) {
        setSelectedSlug(data.suggestedSlug);
      }
    } catch {
      if (reqId !== imsRequestIdRef.current) return;
      setImsResult({ found: false, warning: "IMS lookup failed" });
      setImsResultForEmail(trimmed);
    } finally {
      if (reqId === imsRequestIdRef.current) setImsLooking(false);
    }
  }, []);

  function handleEmailChange(val: string) {
    setEmail(val);
    setImsResult(null);
    setImsResultForEmail("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doImsLookup(val), 500);
  }

  // ── form submit ───────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !selectedSlug) return;
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const body: Record<string, unknown> = { email: email.trim(), slug: selectedSlug };
      // Pass IMS storeID through if we found one — but only if the current
      // imsResult actually corresponds to the email about to be submitted
      // (protects against stale responses where email changed after lookup).
      if (
        imsResult?.found &&
        imsResult.storeID &&
        imsResultForEmail === email.trim()
      ) {
        body.ims_store_id = String(imsResult.storeID);
      }
      const res = await fetch("/api/admin/salon-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setSubmitResult({ ok: true, message: `Access granted for ${email.trim()}` });
        setEmail("");
        setImsResult(null);
        await loadData();
      } else {
        setSubmitResult({ ok: false, message: data.error ?? "Grant failed" });
      }
    } catch {
      setSubmitResult({ ok: false, message: "Network error — please try again" });
    } finally {
      setSubmitting(false);
    }
  }

  // ── revoke ────────────────────────────────────────────────────────────────

  async function handleRevoke(grantEmail: string, slug: string) {
    if (!window.confirm(`Revoke access for ${grantEmail} on ${slug}?`)) return;
    const key = `${grantEmail}::${slug}`;
    setRevoking(key);
    try {
      const res = await fetch("/api/admin/salon-access", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: grantEmail, slug }),
      });
      if (res.ok) {
        await loadData();
      } else {
        const data = await res.json() as { error?: string };
        alert(data.error ?? "Revoke failed");
      }
    } finally {
      setRevoking(null);
    }
  }

  // ── render: access denied ─────────────────────────────────────────────────

  if (!loading && accessDenied) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center">
          <Shield className="h-12 w-12 text-destructive mx-auto mb-4" />
          <p className="text-lg font-semibold text-foreground mb-2">Admin Access Required</p>
          <p className="text-sm text-muted-foreground mb-6">You need admin permissions to manage salon owners.</p>
          <Link href="/"><Button variant="outline">Back to Dashboard</Button></Link>
        </div>
      </div>
    );
  }

  // ── render: loading ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── render: main ──────────────────────────────────────────────────────────

  const salonNameBySlug = Object.fromEntries(salons.map((s) => [s.slug, s.name]));

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="mb-8">
          <Link href="/admin" className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Admin
          </Link>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-green-500/15 flex items-center justify-center">
              <Users className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Salon Owners</h1>
              <p className="text-sm text-muted-foreground">Grant and revoke owner access to salon sites</p>
            </div>
          </div>
        </div>

        {/* Add Owner Form */}
        <div className="border border-border/60 rounded-xl bg-card p-5 mb-8">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Add Owner Access</h2>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Salon dropdown */}
              <div>
                <label className="block text-xs text-muted-foreground mb-1.5">Salon</label>
                <select
                  value={selectedSlug}
                  onChange={(e) => setSelectedSlug(e.target.value)}
                  required
                  className="w-full text-sm bg-background border border-border/60 rounded-md px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="" disabled>Select a salon</option>
                  {salons.map((s) => (
                    <option key={s.slug} value={s.slug}>{s.name} ({s.slug})</option>
                  ))}
                </select>
              </div>

              {/* Email input */}
              <div>
                <label className="block text-xs text-muted-foreground mb-1.5">Owner Email</label>
                <div className="relative">
                  <Input
                    type="email"
                    placeholder="owner@example.com"
                    value={email}
                    onChange={(e) => handleEmailChange(e.target.value)}
                    required
                    className="bg-background text-sm pr-8"
                  />
                  {imsLooking && (
                    <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>
              </div>
            </div>

            {/* IMS lookup result — only show when it matches the current email */}
            {imsResult && !imsLooking && imsResultForEmail === email.trim() && (
              <div className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2.5 ${
                imsResult.found
                  ? "bg-green-500/10 text-green-400 border border-green-500/20"
                  : imsResult.warning
                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  : "bg-muted/50 text-muted-foreground border border-border/40"
              }`}>
                {imsResult.found ? (
                  <>
                    <CheckCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>
                      Found in Mango POS:{" "}
                      <strong className="text-foreground">
                        {imsResult.name}
                        {imsResult.businessName ? ` — ${imsResult.businessName}` : ""}
                      </strong>
                      {imsResult.storeID ? ` (Store #${imsResult.storeID})` : ""}
                      {imsResult.storeID != null && (
                        <span className="block text-[11px] text-muted-foreground mt-1">
                          {imsResult.suggestedSlug
                            ? <>Suggested salon: <strong className="text-foreground">{imsResult.suggestedSlug}</strong> (auto-selected)</>
                            : "No CMS salon has a matching rvcNo yet — select manually."}
                        </span>
                      )}
                    </span>
                  </>
                ) : imsResult.warning ? (
                  <>
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>{imsResult.warning} — you can still grant access but verify manually.</span>
                  </>
                ) : (
                  <>
                    <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>Email not found in Mango POS records — you can still grant access but verify first.</span>
                  </>
                )}
              </div>
            )}

            {/* Submit result */}
            {submitResult && (
              <div className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2.5 ${
                submitResult.ok
                  ? "bg-green-500/10 text-green-400 border border-green-500/20"
                  : "bg-destructive/10 text-destructive border border-destructive/20"
              }`}>
                {submitResult.ok
                  ? <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                  : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
                <span>{submitResult.message}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={submitting || !email.trim() || !selectedSlug}
                className="h-8 text-xs"
              >
                {submitting
                  ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                  : <UserPlus className="h-3 w-3 mr-1.5" />}
                Grant Access
              </Button>
              {imsResult && !imsResult.found && !imsResult.warning && (
                <span className="text-xs text-muted-foreground">
                  Granting anyway — make sure this is the right person.
                </span>
              )}
            </div>
          </form>
        </div>

        {/* Existing Grants Table */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">
              Existing Grants ({grants.length})
            </h2>
            {grants.length > 0 && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                <ShieldCheck className="h-3 w-3 mr-1" />
                {grants.length} active
              </Badge>
            )}
          </div>

          {grants.length === 0 ? (
            <div className="border border-border/60 rounded-xl bg-card px-5 py-10 text-center">
              <Users className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No owner grants yet.</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Use the form above to grant a salon owner access to their site.</p>
            </div>
          ) : (
            <div className="border border-border/60 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Email</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Salon</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground hidden sm:table-cell">Granted by</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground hidden md:table-cell">Granted at</th>
                    <th className="px-4 py-3 text-xs font-medium text-muted-foreground text-right">Revoke</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {grants.map((g) => {
                    const key = `${g.email}::${g.slug}`;
                    const salonName = salonNameBySlug[g.slug] ?? g.slug;
                    return (
                      <tr key={key} className="bg-card hover:bg-muted/10 transition-colors">
                        <td className="px-4 py-3">
                          <span className="text-xs text-foreground font-medium">{g.email}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <span className="text-xs text-foreground">{salonName}</span>
                            <span className="block text-[10px] text-muted-foreground">{g.slug}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className="text-xs text-muted-foreground">{g.grantedBy}</span>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className="text-xs text-muted-foreground">{formatDate(g.grantedAt)}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {revoking === key ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground inline" />
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRevoke(g.email, g.slug)}
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                              title={`Revoke access for ${g.email}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
