"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Globe, Loader2, AlertCircle, CheckCircle2, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const [step, setStep] = useState<"credentials" | "otp">("credentials");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [otpEmail, setOtpEmail] = useState("");
  const [code, setCode] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);

  // Preferences
  const [rememberMe, setRememberMe] = useState(true);
  const [trustBrowser, setTrustBrowser] = useState(true);

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

      // Trusted device — OTP was skipped, session already created
      if (data.step === "complete") {
        window.location.href = "/";
        return;
      }

      if (data.step === "otp_required") {
        setOtpEmail(data.email);
        setStep("otp");
      }
    } catch {
      setError("Network error — is the server running?");
    } finally {
      setLoading(false);
    }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setOtpError("");
    setOtpLoading(true);

    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: otpEmail,
          code: code.trim(),
          rememberMe,
          trustBrowser,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setOtpError(data.error || "Verification failed");
        return;
      }

      window.location.href = "/";
    } catch {
      setOtpError("Network error — please try again");
    } finally {
      setOtpLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="w-full max-w-sm">

        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center mb-4">
            <Globe className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Salon CMS</h1>
          <p className="text-sm text-muted-foreground mt-1">EnrichCo Employee Login</p>
        </div>

        {step === "credentials" && (
          <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
            <form onSubmit={handleCredentialsSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-foreground">Email</Label>
                <Input
                  id="email" type="email" placeholder="you@enrichco.us"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email" required className="bg-background border-border/60" autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-foreground">Password</Label>
                <Input
                  id="password" type="password" value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password" required className="bg-background border-border/60"
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" /><span>{error}</span>
                </div>
              )}

              <Button type="submit" disabled={loading || !email || !password} className="w-full">
                {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Signing in...</> : "Continue"}
              </Button>

              {/* Forgot password hidden until IMS password change API is available
              <div className="text-center">
                <a href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2">
                  Forgot password?
                </a>
              </div>
              */}
            </form>
          </div>
        )}

        {step === "otp" && (
          <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm">
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

            <form onSubmit={handleOtpSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code" className="text-foreground">Verification code</Label>
                <Input
                  id="code" type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
                  placeholder="000000" value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  autoComplete="one-time-code" required
                  className="bg-background border-border/60 text-center text-xl font-mono tracking-[0.3em]"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground text-center">6-digit code · expires in 5 minutes</p>
              </div>

              {/* Remember options */}
              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox" checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 rounded border-border/60 bg-background accent-primary"
                  />
                  <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                    Keep me logged in for 30 days
                  </span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox" checked={trustBrowser}
                    onChange={(e) => setTrustBrowser(e.target.checked)}
                    className="h-4 w-4 rounded border-border/60 bg-background accent-primary"
                  />
                  <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                    Trust this browser — skip code next time
                  </span>
                </label>
              </div>

              {otpError && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" /><span>{otpError}</span>
                </div>
              )}

              <Button type="submit" disabled={otpLoading || code.length !== 6} className="w-full">
                {otpLoading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Verifying...</> : <><CheckCircle2 className="h-4 w-4 mr-2" />Verify &amp; Sign In</>}
              </Button>

              <div className="text-center">
                <button type="button"
                  onClick={() => { setStep("credentials"); setCode(""); setOtpError(""); }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2">
                  ← Use a different account
                </button>
              </div>
            </form>
          </div>
        )}

        <p className="text-xs text-center text-muted-foreground mt-6">
          Protected by EnrichCo auth
        </p>
      </div>
    </div>
  );
}
