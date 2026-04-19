"use client";

import { Button } from "@/components/ui/button";
import { Globe } from "lucide-react";
import Link from "next/link";

const POS_LOGIN_URL = "https://login.mangoforsalon.com";

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center mb-4">
            <Globe className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Forgot Password?</h1>
          <p className="text-sm text-muted-foreground mt-1 text-center">Reset it through Mango POS</p>
        </div>
        <div className="bg-card border border-border/60 rounded-xl p-6 shadow-sm space-y-4">
          <p className="text-sm text-foreground leading-relaxed">
            Reset your password at{" "}
            <a
              href={POS_LOGIN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
            >
              login.mangoforsalon.com
            </a>
            {" "}using the same email you log in with here. Then come back and log in.
          </p>
          <p className="text-xs text-muted-foreground">
            Your CMS password is your Mango POS password — there&apos;s only one to remember.
          </p>
          <a href={POS_LOGIN_URL} target="_blank" rel="noopener noreferrer" className="block">
            <Button className="w-full gap-2" variant="default">
              Go to Mango POS Login
            </Button>
          </a>
        </div>
        <p className="text-xs text-center text-muted-foreground mt-6">
          <Link href="/login" className="hover:text-foreground transition-colors underline underline-offset-2">
            ← Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
