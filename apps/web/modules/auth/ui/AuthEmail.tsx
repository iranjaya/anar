"use client";

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useState,
} from "react";

const EmailContext = createContext<
  [string, Dispatch<SetStateAction<string>>] | null
>(null);

export function AuthEmail({ children }: { children: ReactNode }) {
  const email = useState("");
  return (
    <EmailContext.Provider value={email}>{children}</EmailContext.Provider>
  );
}

export function useAuthEmail() {
  const value = useContext(EmailContext);
  if (!value) throw new Error("Auth email state is missing");
  return value;
}
