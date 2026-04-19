"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Shield,
  ShieldCheck,
  User,
  UserX,
  UserCheck,
  UserPlus,
  Loader2,
  Activity,
  Server,
  Globe,
  Layers,
} from "lucide-react";

interface CmsUser {
  email: string;
  role: "superadmin" | "admin" | "support";
  name: string;
  created_at: number;
  last_login: number;
  active: number;
}

interface AuditEntry {
  id: string;
  timestamp: number;
  email: string;
  action: string;
  slug: string;
  deploy_hash?: string;
}

const ROLE_CONFIG = {
  superadmin: { label: "Super Admin", color: "bg-purple-500/15 text-purple-400 border-purple-500/25", icon: ShieldCheck },
  admin: { label: "Admin", color: "bg-green-500/15 text-green-400 border-green-500/25", icon: Shield },
  support: { label: "Support", color: "bg-blue-500/15 text-blue-400 border-blue-500/25", icon: User },
};

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  save: { label: "Saved", color: "text-blue-400" },
  publish_production: { label: "Published to Live", color: "text-green-400" },
  publish_staging: { label: "Published to Staging", color: "text-amber-400" },
  publish: { label: "Published", color: "text-green-400" },
  upload: { label: "Uploaded Image", color: "text-cyan-400" },
  rollback: { label: "Rolled Back", color: "text-red-400" },
  restore: { label: "Restored Config", color: "text-orange-400" },
  template_switch: { label: "Switched Template", color: "text-purple-400" },
};

function timeAgo(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDate(ts: number): string {
  if (!ts) return "Never";
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export default function AdminPage() {
  const [users, setUsers] = useState<CmsUser[]>([]);
  const [activity, setActivity] = useState<AuditEntry[]>([]);
  const [salonCount, setSalonCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"support" | "admin">("support");
  const [inviting, setInviting] = useState(false);

  async function fetchAll() {
    try {
      const [usersRes, activityRes, salonsRes] = await Promise.all([
        fetch("/api/admin/users"),
        fetch("/api/admin/activity?limit=20"),
        fetch("/api/salons"),
      ]);

      if (usersRes.status === 403) {
        setError("Access denied. Super admin role required.");
        setLoading(false);
        return;
      }

      if (usersRes.ok) setUsers(await usersRes.json());
      if (activityRes.ok) setActivity(await activityRes.json());
      if (salonsRes.ok) {
        const salons = await salonsRes.json();
        setSalonCount(Array.isArray(salons) ? salons.length : 0);
      }
    } catch {
      setError("Failed to load admin data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchAll(); }, []);

  async function changeRole(email: string, newRole: "admin" | "support") {
    if (!window.confirm(`Change ${email} to ${newRole}?`)) return;
    setUpdating(email);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: newRole }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error || "Failed"); return; }
      await fetchAll();
    } finally { setUpdating(null); }
  }

  async function toggleActive(email: string, currentlyActive: boolean) {
    const action = currentlyActive ? "deactivate" : "reactivate";
    if (!window.confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} ${email}?`)) return;
    setUpdating(email);
    try {
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, reactivate: !currentlyActive }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error || "Failed"); return; }
      await fetchAll();
    } finally { setUpdating(null); }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail) return;
    setInviting(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, name: inviteName, role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Failed to invite"); return; }
      setInviteEmail("");
      setInviteName("");
      setInviteRole("support");
      setShowInvite(false);
      await fetchAll();
    } finally { setInviting(false); }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center">
          <Shield className="h-12 w-12 text-destructive mx-auto mb-4" />
          <p className="text-lg font-semibold text-foreground mb-2">Admin Access Required</p>
          <p className="text-sm text-muted-foreground mb-6">{error}</p>
          <Link href="/"><Button variant="outline">Back to Dashboard</Button></Link>
        </div>
      </div>
    );
  }

  const activeUsers = users.filter((u) => u.active);
  const inactiveUsers = users.filter((u) => !u.active);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link href="/" className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Dashboard
          </Link>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-purple-500/15 flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Admin Settings</h1>
              <p className="text-sm text-muted-foreground">Manage team, permissions, and monitor activity</p>
            </div>
          </div>
        </div>

        {/* System Overview Cards */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <div className="border border-border/60 rounded-xl bg-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Sites</span>
            </div>
            <p className="text-2xl font-semibold text-foreground">{salonCount}</p>
          </div>
          <div className="border border-border/60 rounded-xl bg-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Team Members</span>
            </div>
            <p className="text-2xl font-semibold text-foreground">{activeUsers.length}</p>
          </div>
          <div className="border border-border/60 rounded-xl bg-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Recent Actions</span>
            </div>
            <p className="text-2xl font-semibold text-foreground">{activity.length}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Members (2/3 width) */}
          <div className="lg:col-span-2">
            {/* Active Members */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-foreground">Team Members ({activeUsers.length})</h2>
                <Button variant="outline" size="sm" onClick={() => setShowInvite(!showInvite)} className="h-8 text-xs gap-1.5">
                  <UserPlus className="h-3.5 w-3.5" />
                  Add Member
                </Button>
              </div>

              {/* Invite Form */}
              {showInvite && (
                <form onSubmit={handleInvite} className="border border-primary/30 rounded-xl bg-primary/5 p-4 mb-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                    <Input
                      placeholder="Email address"
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      required
                      className="bg-background text-sm"
                    />
                    <Input
                      placeholder="Name (optional)"
                      value={inviteName}
                      onChange={(e) => setInviteName(e.target.value)}
                      className="bg-background text-sm"
                    />
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as "admin" | "support")}
                      className="text-sm bg-background border border-border/60 rounded-md px-3 py-2 text-foreground"
                    >
                      <option value="support">Support</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="submit" size="sm" disabled={inviting || !inviteEmail} className="h-8 text-xs">
                      {inviting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <UserPlus className="h-3 w-3 mr-1" />}
                      Add Member
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowInvite(false)} className="h-8 text-xs">
                      Cancel
                    </Button>
                  </div>
                </form>
              )}

              <div className="border border-border/60 rounded-xl overflow-hidden">
                {activeUsers.map((user) => {
                  const cfg = ROLE_CONFIG[user.role];
                  const Icon = cfg.icon;
                  const isSuperAdmin = user.role === "superadmin";
                  return (
                    <div key={user.email} className="flex items-center gap-4 px-5 py-4 border-b border-border/40 last:border-b-0 bg-card">
                      <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground truncate">{user.name || user.email}</span>
                          <Badge variant="outline" className={`text-[10px] ${cfg.color}`}>{cfg.label}</Badge>
                        </div>
                        {user.name && <p className="text-xs text-muted-foreground truncate">{user.email}</p>}
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {user.last_login ? `Last login: ${formatDate(user.last_login)}` : "Invited — has not logged in yet"}
                        </p>
                      </div>
                      {!isSuperAdmin && (
                        <div className="flex items-center gap-2 shrink-0">
                          {updating === user.email ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          ) : (
                            <>
                              <select
                                value={user.role}
                                onChange={(e) => changeRole(user.email, e.target.value as "admin" | "support")}
                                className="text-xs bg-background border border-border/60 rounded-md px-2 py-1.5 text-foreground"
                              >
                                <option value="support">Support</option>
                                <option value="admin">Admin</option>
                              </select>
                              <Button
                                variant="ghost" size="sm"
                                onClick={() => toggleActive(user.email, true)}
                                className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8 p-0"
                                title="Deactivate user"
                              >
                                <UserX className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {activeUsers.length === 0 && (
                  <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No team members yet. Click &quot;Add Member&quot; to invite someone, or members are added automatically on first login.
                  </div>
                )}
              </div>
            </div>

            {/* Deactivated */}
            {inactiveUsers.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground mb-3">Deactivated ({inactiveUsers.length})</h2>
                <div className="border border-border/60 rounded-xl overflow-hidden opacity-60">
                  {inactiveUsers.map((user) => (
                    <div key={user.email} className="flex items-center gap-4 px-5 py-3 border-b border-border/40 last:border-b-0 bg-card">
                      <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <UserX className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-muted-foreground truncate">{user.email}</span>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => toggleActive(user.email, false)}
                        className="text-green-400 hover:text-green-400 hover:bg-green-500/10 h-8 px-3" title="Reactivate">
                        <UserCheck className="h-3.5 w-3.5 mr-1.5" /><span className="text-xs">Reactivate</span>
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Activity Feed (1/3 width) */}
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-3">Recent Activity</h2>
            <div className="border border-border/60 rounded-xl bg-card overflow-hidden">
              {activity.length > 0 ? (
                <div className="divide-y divide-border/40">
                  {activity.map((entry) => {
                    const actionCfg = ACTION_LABELS[entry.action] || { label: entry.action, color: "text-muted-foreground" };
                    return (
                      <div key={entry.id} className="px-4 py-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs font-medium ${actionCfg.color}`}>{actionCfg.label}</span>
                          <span className="text-[10px] text-muted-foreground">{timeAgo(entry.timestamp)}</span>
                        </div>
                        <p className="text-xs text-foreground truncate">{entry.slug}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{entry.email}</p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No activity yet. Actions will appear here as team members edit and publish salons.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Role Legend */}
        <div className="mt-8 p-4 rounded-xl bg-muted/30 border border-border/40">
          <h3 className="text-xs font-semibold text-foreground mb-2">Role Permissions</h3>
          <div className="grid grid-cols-3 gap-4 text-xs text-muted-foreground">
            <div>
              <Badge variant="outline" className="text-[10px] bg-blue-500/15 text-blue-400 border-blue-500/25 mb-1">Support</Badge>
              <p>Can view and edit salon data. Cannot publish or manage users.</p>
            </div>
            <div>
              <Badge variant="outline" className="text-[10px] bg-green-500/15 text-green-400 border-green-500/25 mb-1">Admin</Badge>
              <p>Can edit, publish, rollback, and switch templates. Cannot manage users.</p>
            </div>
            <div>
              <Badge variant="outline" className="text-[10px] bg-purple-500/15 text-purple-400 border-purple-500/25 mb-1">Super Admin</Badge>
              <p>Full access. Can manage team members and all settings. Set via server config.</p>
            </div>
          </div>
        </div>

        {/* Admin How-To Guide */}
        <div className="mt-6 border border-border/40 rounded-xl overflow-hidden">
          <button
            onClick={() => {
              const el = document.getElementById("admin-help");
              if (el) el.style.display = el.style.display === "none" ? "block" : "none";
            }}
            className="w-full flex items-center justify-between px-5 py-3 text-left bg-muted/20 hover:bg-muted/30 transition-colors"
          >
            <span className="text-xs font-semibold text-foreground flex items-center gap-2">
              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
              How to use Admin
            </span>
            <span className="text-xs text-muted-foreground">click to expand</span>
          </button>
          <div id="admin-help" style={{ display: "none" }} className="px-5 py-4 space-y-4 text-xs text-muted-foreground border-t border-border/40">
            <div>
              <h4 className="text-foreground font-semibold mb-1.5">Add a new team member</h4>
              <ol className="list-decimal ml-4 space-y-1">
                <li>Click <strong className="text-foreground">+ Add Member</strong> in the top-right of Team Members.</li>
                <li>Enter their <strong className="text-foreground">email</strong> (must already have an IMS Next account at imsnext.enrichco.us).</li>
                <li>Optionally type their <strong className="text-foreground">name</strong>.</li>
                <li>Pick a role: <strong className="text-foreground">Support</strong> (edit only) or <strong className="text-foreground">Admin</strong> (edit + publish).</li>
                <li>Click <strong className="text-foreground">Add Member</strong>. They can sign in immediately.</li>
              </ol>
            </div>
            <div>
              <h4 className="text-foreground font-semibold mb-1.5">Change someone&apos;s role</h4>
              <ol className="list-decimal ml-4 space-y-1">
                <li>Find the person in the Team Members list.</li>
                <li>Use the <strong className="text-foreground">role dropdown</strong> next to their name.</li>
                <li>Pick Support or Admin. Confirm when prompted.</li>
              </ol>
              <p className="mt-1 text-muted-foreground/70">Super Admin roles are locked and cannot be changed from this page.</p>
            </div>
            <div>
              <h4 className="text-foreground font-semibold mb-1.5">Deactivate a member</h4>
              <ol className="list-decimal ml-4 space-y-1">
                <li>Click the <strong className="text-foreground">red person icon</strong> next to their name. Confirm.</li>
                <li>They move to the Deactivated section and can no longer sign in.</li>
              </ol>
            </div>
            <div>
              <h4 className="text-foreground font-semibold mb-1.5">Reactivate a deactivated member</h4>
              <ol className="list-decimal ml-4 space-y-1">
                <li>Scroll to the <strong className="text-foreground">Deactivated</strong> section at the bottom.</li>
                <li>Click <strong className="text-foreground">Reactivate</strong> next to their name.</li>
              </ol>
            </div>
            <div>
              <h4 className="text-foreground font-semibold mb-1.5">Recent Activity</h4>
              <p>The right panel shows the last 20 actions across all salons: publishes, saves, template switches, image uploads. Each entry shows who did it, what salon, and when.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
