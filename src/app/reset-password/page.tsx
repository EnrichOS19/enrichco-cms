"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Globe, Loader2, AlertCircle, CheckCircle2, Eye, EyeOff } from "lucide-react";

function ResetForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(true);
  const [tokenError, setTokenError] = useState("");

  useEffect(() => {
    if (!token) { setTokenError("No reset token provided"); setValidating(false); return; }
    fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(data => { if (data.email) setEmail(data.email); else setTokenError(data.error ?? "Invalid or expired token"); })
      .catch(() => setTokenError("Could not validate token — please try again"))
      .finally(() => setValidating(false));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Reset failed — please try again");
        return;
      }
      // 202 = admin must complete the reset; 200 = fully reset
      if (data.admin_reset_required) {
        setError("Online password reset is not yet available. Please contact your system administrator to complete the reset.");
        return;
      }
      setSuccess(true);
    } catch { setError("Network error — please try again"); }
    finally { setLoading(false); }
  }

  if (validating) return (
    <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
  );

  if (tokenError) return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center mb-4"><Globe className="h-6 w-6 text-primary-foreground" /></div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Password Reset</h1>
        </div>
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20 mb-4">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div><p className="text-sm font-medium text-destructive">Link expired</p><p className="text-xs text-muted-foreground mt-1">{tokenError}</p></div>
          </div>
          <Button variant="outline" className="w-full" onClick={() => (window.location.href = "/login")}>Back to Login</Button>
        </div>
      </div>
    </div>
  );

  if (success) return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center mb-4"><Globe className="h-6 w-6 text-primary-foreground" /></div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Password Reset</h1>
        </div>
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center"><CheckCircle2 className="h-6 w-6 text-green-600" /></div>
            <p className="text-sm font-medium text-foreground text-center">Password updated successfully</p>
            <p className="text-xs text-muted-foreground text-center">Your password has been changed. You can now log in with your new password.</p>
          </div>
          <Button className="w-full mt-2" onClick={() => (window.location.href = "/login")}>Go to Login</Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center mb-4"><Globe className="h-6 w-6 text-primary-foreground" /></div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Set New Password</h1>
          <p className="text-sm text-muted-foreground mt-1 text-center">for {email}</p>
        </div>
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password" className="text-foreground">New Password</Label>
              <div className="relative">
                <Input id="password" type={showPw ? "text" : "password"} value={password}
                  onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required minLength={8}
                  placeholder="At least 8 characters" className="bg-background border-border/60 pr-10" />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" tabIndex={-1}>
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm" className="text-foreground">Confirm Password</Label>
              <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password" required minLength={8} placeholder="Same as above"
                className="bg-background border-border/60" />
            </div>
            {error && <div className="flex items-center gap-2 text-sm text-destructive"><AlertCircle className="h-4 w-4 shrink-0" /><span>{error}</span></div>}
            <Button type="submit" disabled={loading || !password || !confirm} className="w-full">
              {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Resetting…</> : "Reset Password"}
            </Button>
          </form>
        </div>
        <p className="text-xs text-center text-muted-foreground mt-6">
          <button onClick={() => (window.location.href = "/login")}
            className="hover:text-foreground transition-colors underline underline-offset-2">← Back to login</button>
        </p>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}><ResetForm /></Suspense>;
}
