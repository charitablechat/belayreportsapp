import { describe, it, expect } from "vitest";
import { rowsToCsv } from "@/lib/backup-export";

describe("backup-export rowsToCsv", () => {
  it("returns empty string for empty input", () => {
    expect(rowsToCsv([])).toBe("");
  });

  it("emits a header row from union of all keys (first-seen order)", () => {
    const csv = rowsToCsv([
      { a: 1, b: 2 },
      { b: 3, c: 4 },
    ]);
    const [header] = csv.split("\r\n");
    expect(header).toBe("a,b,c");
  });

  it("escapes commas, quotes, and newlines per RFC 4180", () => {
    const csv = rowsToCsv([
      { name: 'He said "hi"', note: "a,b", multi: "line1\nline2" },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("name,note,multi");
    expect(lines[1]).toBe('"He said ""hi""","a,b","line1\nline2"');
  });

  it("renders null/undefined as empty and stringifies objects", () => {
    const csv = rowsToCsv([
      { a: null, b: undefined, c: { x: 1 }, d: [1, 2] },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("a,b,c,d");
    expect(lines[1]).toBe(',,"{""x"":1}","[1,2]"');
  });

  it("preserves numbers and booleans as bare values", () => {
    const csv = rowsToCsv([{ n: 42, b: true, f: false }]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe("42,true,false");
  });

  it("handles sparse rows by emitting empties for missing keys", () => {
    const csv = rowsToCsv([{ a: 1 }, { b: 2 }]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("a,b");
    expect(lines[1]).toBe("1,");
    expect(lines[2]).toBe(",2");
  });
});
