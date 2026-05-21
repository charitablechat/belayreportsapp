/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  warmShellRoutes,
  SHELL_ROUTES,
  getShellWarmupResults,
} from "@/lib/shell-warmup";

describe("shell-warmup", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("warms every shell route and records ok/failed per route", async () => {
    const fetcher = vi.fn(async (url: string) => {
      // simulate failure on one route
      if (url === "/training/new") return new Response("", { status: 500 });
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    const r = await warmShellRoutes({ force: true, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(SHELL_ROUTES.length);
    expect(r["/dashboard"]).toBe("ok");
    expect(r["/training/new"]).toBe("failed");
  });

  it("does not re-warm when session flag already set (no force)", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 200 })) as unknown as typeof fetch;
    await warmShellRoutes({ force: true, fetcher });
    fetcher.mockClear?.();
    await warmShellRoutes({ fetcher });
    expect(fetcher).not.toHaveBeenCalled();
    expect(getShellWarmupResults()).toBeTruthy();
  });

  it("does not throw when fetcher rejects", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    const r = await warmShellRoutes({ force: true, fetcher });
    expect(Object.values(r).every((v) => v === "failed")).toBe(true);
  });
});
