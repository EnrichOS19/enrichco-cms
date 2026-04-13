"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Globe, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setDone(true);
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-background">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-8">
            <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center mb-4">
              <Globe className="h-6 w-6 text-primary-foreground" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Check Your Email</h1>
          </div>
          <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground text-center">
                Reset link sent
              </p>
              <p className="text-xs text-muted-foreground text-center">
                If an account with that email exists, we&apos;ve sent a password reset link. Check your inbox — the link expires in 30 minutes.
              </p>
            </div>
            <Button variant="outline" className="w-full mt-2" onClick={() => (window.location.href = "/login")}>
              Back to Login
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center mb-4">
            <Globe className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Forgot Password</h1>
          <p className="text-sm text-muted-foreground mt-1 text-center">Enter your email and we&apos;ll send you a reset link</p>
        </div>
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-foreground">Email Address</Label>
              <Input id="email" type="email" placeholder="you@enrichco.us" value={email}
                onChange={(e) => setEmail(e.target.value)} autoComplete="email" required
                className="bg-background border-border/60" autoFocus />
            </div>
            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" /><span>{error}</span>
              </div>
            )}
            <Button type="submit" disabled={loading || !email} className="w-full">
              {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Sending…</> : "Send Reset Link"}
            </Button>
          </form>
        </div>
        <p className="text-xs text-center text-muted-foreground mt-6">
          <a href="/login" className="hover:text-foreground transition-colors underline underline-offset-2">← Back to login</a>
        </p>
      </div>
    </div>
  );
}
