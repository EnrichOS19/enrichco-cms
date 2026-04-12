"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  Globe,
  CheckCircle2,
  Clock,
  Sparkles,
  ExternalLink,
  Pencil,
  Eye,
  Phone,
  Layers,
  Image as ImageIcon,
  LogOut,
} from "lucide-react";

interface SalonSummary {
  slug: string;
  name: string;
  city: string;
  state: string;
  status: "Demo Ready" | "Approved" | "New";
  phone: string;
  serviceCount: number;
  galleryCount: number;
}

const STATUS_CONFIG = {
  Approved: {
    badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
    dot: "bg-emerald-400",
    icon: CheckCircle2,
  },
  "Demo Ready": {
    badge: "bg-amber-500/15 text-amber-400 border-amber-500/25",
    dot: "bg-amber-400",
    icon: Clock,
  },
  New: {
    badge: "bg-zinc-500/15 text-zinc-400 border-zinc-500/25",
    dot: "bg-zinc-400",
    icon: Sparkles,
  },
} as const;

type StatusFilter = "All" | "Approved" | "Demo Ready" | "New";

const FILTERS: StatusFilter[] = ["All", "Approved", "Demo Ready", "New"];

export default function DashboardPage() {
  const [salons, setSalons] = useState<SalonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("All");
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/salons")
      .then((r) => r.json())
      .then((data) => {
        setSalons(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.email) setUserEmail(data.email);
      })
      .catch(() => {});
  }, []);

  const filtered = salons.filter((s) => {
    const matchesSearch =
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.city.toLowerCase().includes(search.toLowerCase()) ||
      s.state.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "All" || s.status === filter;
    return matchesSearch && matchesFilter;
  });

  const counts = {
    total: salons.length,
    approved: salons.filter((s) => s.status === "Approved").length,
    demoReady: salons.filter((s) => s.status === "Demo Ready").length,
    new: salons.filter((s) => s.status === "New").length,
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-border/60 bg-[oklch(0.14_0_0)] sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <Globe className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight">Salon CMS</h1>
              <p className="text-[11px] text-muted-foreground leading-none">EnrichCo Website Manager</p>
            </div>
          </div>
          {userEmail && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{userEmail}</span>
              <button
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  window.location.href = "/login";
                }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        {/* Stat bar */}
        <div className="grid grid-cols-4 gap-3 mb-8">
          {[
            { label: "Total Sites", value: counts.total, color: "text-foreground" },
            { label: "Approved", value: counts.approved, color: "text-emerald-400" },
            { label: "Demo Ready", value: counts.demoReady, color: "text-amber-400" },
            { label: "Needs Attention", value: counts.new, color: "text-zinc-400" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-border/60 bg-card px-5 py-4"
            >
              <p className={`text-2xl font-semibold font-mono tabular-nums ${stat.color}`}>
                {loading ? "-" : stat.value}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Search + Filters */}
        <div className="flex items-center gap-4 mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search salons..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-10 bg-card border-border/60"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-card p-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  filter === f
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f}
                {f !== "All" && (
                  <span className="ml-1.5 opacity-60">
                    {f === "Approved" ? counts.approved : f === "Demo Ready" ? counts.demoReady : counts.new}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Salon cards */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <Search className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">No salons found</p>
            <p className="text-xs text-muted-foreground">
              {search ? `No results for "${search}"` : "No salons match this filter"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((salon) => {
              const statusCfg = STATUS_CONFIG[salon.status];
              return (
                <Link key={salon.slug} href={`/salon/${salon.slug}`} className="group">
                  <div className="relative rounded-xl border border-border/60 bg-card overflow-hidden transition-all hover:border-primary/40 hover:shadow-[0_0_0_1px_oklch(0.585_0.233_264/0.15)]">
                    {/* Top color strip */}
                    <div className="h-1 bg-gradient-to-r from-primary/60 to-primary/20" />

                    <div className="p-5">
                      {/* Name + Status */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0 mr-3">
                          <h3 className="font-semibold text-sm leading-tight truncate group-hover:text-primary transition-colors">
                            {salon.name}
                          </h3>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {salon.city}, {salon.state}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className={`text-[10px] shrink-0 ${statusCfg.badge}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${statusCfg.dot} mr-1.5`} />
                          {salon.status}
                        </Badge>
                      </div>

                      {/* Meta row */}
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Layers className="h-3 w-3" />
                          {salon.serviceCount} services
                        </span>
                        <span className="flex items-center gap-1.5">
                          <ImageIcon className="h-3 w-3" />
                          {salon.galleryCount} photos
                        </span>
                      </div>

                      {salon.phone && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
                          <Phone className="h-3 w-3" />
                          <span className="font-mono">{salon.phone}</span>
                        </div>
                      )}

                      {/* Quick actions — show on hover */}
                      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/40 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="flex items-center gap-1 text-[11px] text-primary font-medium">
                          <Pencil className="h-3 w-3" /> Edit
                        </span>
                        <span className="text-border/60">|</span>
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Eye className="h-3 w-3" /> Preview
                        </span>
                        <span className="text-border/60">|</span>
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <ExternalLink className="h-3 w-3" /> Live
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
