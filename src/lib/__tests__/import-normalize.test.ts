import { describe, it, expect } from "vitest";
import {
  mapImportedPreviousInspectionDate,
  normalizeImportedChildData,
} from "../import-normalize";

describe("mapImportedPreviousInspectionDate", () => {
  it("prefers the imported report's actual inspection date over its previous_inspection_date", () => {
    expect(
      mapImportedPreviousInspectionDate(
        { report_inspection_date: "2025-05-12", previous_inspection_date: "2024-06-01" },
        "",
      ),
    ).toBe("2025-05-12");
  });

  it("falls back to previous_inspection_date when actual date missing", () => {
    expect(
      mapImportedPreviousInspectionDate(
        { previous_inspection_date: "2024-06-01" },
        "",
      ),
    ).toBe("2024-06-01");
  });

  it("falls back to current form value when neither parsed date is available", () => {
    expect(mapImportedPreviousInspectionDate({}, "2023-01-01")).toBe("2023-01-01");
  });

  it("ignores empty strings", () => {
    expect(
      mapImportedPreviousInspectionDate(
        { report_inspection_date: "   ", previous_inspection_date: "2024-06-01" },
        "",
      ),
    ).toBe("2024-06-01");
  });
});

describe("normalizeImportedChildData", () => {
  it("drops zipline-named system when same zipline already exists", () => {
    const out = normalizeImportedChildData({
      systems: [{ name: "Racing Zipline" }, { name: "Swing Element" }],
      ziplines: [{ zipline_name: "racing zipline" }],
    });
    expect(out.systems.map((s) => s.name)).toEqual(["Swing Element"]);
    expect(out.ziplines).toHaveLength(1);
  });

  it("moves zipline-named system into ziplines when no match exists", () => {
    const out = normalizeImportedChildData({
      systems: [{ name: "Canopy Zip Line", result: "Pass", comments: "ok" }],
      ziplines: [],
    });
    expect(out.systems).toHaveLength(0);
    expect(out.ziplines).toEqual([
      { zipline_name: "Canopy Zip Line", result: "Pass", comments: "ok" },
    ]);
  });

  it("leaves non-zipline systems in Other Elements", () => {
    const out = normalizeImportedChildData({
      systems: [{ name: "Giant Swing" }, { name: "Climbing Wall" }],
      ziplines: [],
    });
    expect(out.systems).toHaveLength(2);
    expect(out.ziplines).toHaveLength(0);
  });

  it("dedupes ziplines by case/whitespace", () => {
    const out = normalizeImportedChildData({
      systems: [],
      ziplines: [
        { zipline_name: "  Main Zipline " },
        { zipline_name: "main zipline" },
      ],
    });
    expect(out.ziplines).toHaveLength(1);
  });

  it("detects zip-line via system_name field", () => {
    const out = normalizeImportedChildData({
      systems: [{ name: "Element 4", system_name: "Zip-Line" }],
      ziplines: [],
    });
    expect(out.systems).toHaveLength(0);
    expect(out.ziplines).toHaveLength(1);
  });
});
