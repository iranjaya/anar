import "server-only";
import { requireDemoMode } from "@/lib/api/mode";
import { AppError } from "@/lib/errors";
import { db, type MockStore, resetStore } from "./store";

const demo = globalThis as typeof globalThis & { anarDemoFailure?: boolean };

export async function store(): Promise<MockStore> {
  requireDemoMode();
  if (demo.anarDemoFailure) {
    throw new AppError("unavailable", "Couldn't load demo data. Try again.");
  }
  return db();
}

export async function setDemoFailure(on: boolean): Promise<void> {
  requireDemoMode();
  demo.anarDemoFailure = on;
}

export async function resetDemoStore(now: Date): Promise<void> {
  requireDemoMode();
  resetStore(now);
  demo.anarDemoFailure = false;
}
