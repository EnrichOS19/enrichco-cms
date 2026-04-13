"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Globe, Loader2, AlertCircle, CheckCircle2, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  // ── Step state ────────────────────────────────────────────────────────────
  // "credentials" → "otp" → done
  const [step, setStep] = useState<"credentials" | "otp">("credentials");

  // ── Credentials step ───────────────────────────────────────────────────────
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // ── OTP step ───────────────────────────────────────────────────────────────
  const [otpEmail, setOtpEmail] = useState(""); // confirmed email
  const [code, setCode] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [debugCode, setDebugCode] = useState(""); // shown in dev mode

  // ── Step 1: Submit credentials ─────────────────────────────────────────────
  async function handleCredentialsSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Login failed — check your credentials");
        return;
      }

      if (data.step === "otp_required") {
        setOtpEmail(data.email);
        // In dev/console mode, the code is returned for testing
        if (data._debug_code) setDebugCode(data._debug_code);
        setStep("otp");
      }
    } catch {
      setError("Network error — is the server running?");
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: Submit OTP ─────────────────────────────────────────────────────
  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setOtpError("");
    setOtpLoading(true);

    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: otpEmail, code: code.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setOtpError(data.error || "Verification failed");
        return;
      }

      // Success — session cookie is set, redirect to dashboard
      window.location.href = "/";
    } catch {
      setOtpError("Network error — please try again");
    } finally {
      setOtpLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center mb-4">
            <Globe className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Salon CMS
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            EnrichCo Employee Login
          </p>
        </div>

        {/* ── Step 1: Credentials ─────────────────────────────────────────── */}
        {step === "credentials" && (
          <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
            <form onSubmit={handleCredentialsSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-foreground">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@enrichco.us"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  className="bg-background border-border/60"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-foreground">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="bg-background border-border/60"
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                disabled={loading || !email || !password}
                className="w-full"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Signing in…
                  </>
                ) : (
                  "Continue"
                )}
              </Button>

              <div className="text-center">
                <a
                  href="/forgot-password"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
                >
                  Forgot password?
                </a>
              </div>
            </form>
          </div>
        )}

        {/* ── Step 2: OTP ───────────────────────────────────────────────────── */}
        {step === "otp" && (
          <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border/60">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <ShieldCheck className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Check your email</p>
                <p className="text-xs text-muted-foreground">
                  We sent a 6-digit code to<br />
                  <span className="text-foreground font-medium">{otpEmail}</span>
                </p>
              </div>
            </div>

            {/* Dev mode: show the code */}
            {debugCode && (
              <div className="mb-4 p-3 rounded-lg bg-muted border border-border/60">
                <p className="text-xs text-muted-foreground mb-1">Dev mode — OTP code:</p>
                <p className="text-lg font-mono font-bold text-foreground tracking-widest">{debugCode}</p>
              </div>
            )}

            <form onSubmit={handleOtpSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code" className="text-foreground">Verification code</Label>
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  autoComplete="one-time-code"
                  required
                  className="bg-background border-border/60 text-center text-xl font-mono tracking-[0.3em] placeholder:text-muted-foreground/50"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground text-center">
                  6-digit code · expires in 5 minutes
                </p>
              </div>

              {otpError && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{otpError}</span>
                </div>
              )}

              <Button
                type="submit"
                disabled={otpLoading || code.length !== 6}
                className="w-full"
              >
                {otpLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Verifying…
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Verify &amp; Sign In
                  </>
                )}
              </Button>

              {/* Resend link */}
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setStep("credentials");
                    setCode("");
                    setOtpError("");
                    setDebugCode("");
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
                >
                  ← Use a different account
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Footer */}
        <p className="text-xs text-center text-muted-foreground mt-6">
          Protected by EnrichCo auth · Sessions expire after 8 hours
        </p>
      </div>
    </div>
  );
}
