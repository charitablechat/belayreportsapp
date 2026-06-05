import { describe, it, expect } from "vitest";
import { osBusinessKey } from "../inspectionLoader";

describe("osBusinessKey", () => {
  it("lowercases and trims name|system_name", () => {
    expect(osBusinessKey({ name: "  Main Gate ", system_name: "Zipline" }))
      .toBe("main gate|zipline");
  });

  it("returns the same key for equivalent casing/whitespace", () => {
    expect(osBusinessKey({ name: "Top Rope", system_name: "Crate Stacking" }))
      .toBe(osBusinessKey({ name: "top rope", system_name: "  crate stacking" }));
  });

  it("falls back to name-only when system_name is empty", () => {
    expect(osBusinessKey({ name: "Auto Belay", system_name: "" })).toBe("auto belay");
  });

  it("falls back to system_name-only when name is empty", () => {
    expect(osBusinessKey({ name: "", system_name: "Climbing Wall" }))
      .toBe("climbing wall");
  });

  it("returns null for empty/nullish input", () => {
    expect(osBusinessKey({})).toBeNull();
    expect(osBusinessKey({ name: "  ", system_name: null as unknown as string })).toBeNull();
    expect(osBusinessKey(null)).toBeNull();
    expect(osBusinessKey(undefined)).toBeNull();
  });
});
