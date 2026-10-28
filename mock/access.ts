import "server-only";
import { AppError } from "@/lib/errors";
import { db, type MockStore, resetStore } from "./store";

const demo = globalThis as typeof globalThis & { anarDemoFailure?: boolean };

export async function store(): Promise<MockStore> {
  if (demo.anarDemoFailure) {
    throw new AppError("unavailable", "Couldn't load demo data. Try again.");
  }
  return db();
}

export async function setDemoFailure(on: boolean): Promise<void> {
  demo.anarDemoFailure = on;
}

export async function resetDemoStore(now: Date): Promise<void> {
  resetStore(now);
  demo.anarDemoFailure = false;
}
