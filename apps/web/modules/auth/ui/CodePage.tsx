"use client";

import Link from "next/link";
import { useState } from "react";
import type { AuthReadiness } from "../types";
import { useAuthEmail } from "./AuthEmail";
import { AuthField } from "./AuthField";
import { SignInForm } from "./SignInForm";

export function CodePage({ readiness }: { readiness: AuthReadiness }) {
  const [email, setEmail] = useAuthEmail();
  const [code, setCode] = useState("");
  return (
    <>
      <p className="text-sm font-semibold text-brand">Check your inbox</p>
      <h1 className="mt-2 font-display text-3xl font-bold">Enter your code</h1>
      <p className="mt-3 text-muted">
        Use the latest code sent to your email. It expires after 10 minutes.
      </p>
      <SignInForm screen="code" readiness={readiness}>
        <AuthField
          id="code-email"
          name="email"
          label="Email address"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <AuthField
          id="login-code"
          name="code"
          label="Six-digit code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
          hint="Keep this code private."
        />
      </SignInForm>
      <Link
        href="/login"
        className="mt-6 inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4"
      >
        Use another email or request a new code
      </Link>
    </>
  );
}
