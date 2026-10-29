"use client";

import Link from "next/link";
import type { AuthReadiness } from "../types";
import { useAuthEmail } from "./AuthEmail";
import { AuthField } from "./AuthField";
import { SignInForm } from "./SignInForm";

export function LoginPage({ readiness }: { readiness: AuthReadiness }) {
  const [email, setEmail] = useAuthEmail();
  return (
    <>
      <p className="text-sm font-semibold text-brand">Welcome back</p>
      <h1 className="mt-2 font-display text-3xl font-bold">Sign in to Anar</h1>
      <p className="mt-3 text-muted">
        We’ll email you a six-digit sign-in code.
      </p>
      <SignInForm screen="login" readiness={readiness}>
        <AuthField
          id="login-email"
          name="email"
          label="Email address"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          hint="Use the address your company invited."
        />
      </SignInForm>
      <p className="mt-6 text-sm text-muted">
        Already have a code?{" "}
        <Link
          href="/login/code"
          className="font-semibold text-brand underline underline-offset-4"
        >
          Enter your code
        </Link>
      </p>
    </>
  );
}
