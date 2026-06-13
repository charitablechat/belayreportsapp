import ExcelJS from "exceljs";
import JSZip from "jszip";
import { saveToDeviceAsync } from "@/lib/save-to-device";

interface BackupData {
  version: string;
  exported_at: string;
  data: Record<string, any[]>;
}

function parseBackupBlob(blob: Blob): Promise<BackupData> {
  return blob.text().then((t) => JSON.parse(t));
}

function backupTimestamp(exported_at: string): string {
  try {
    return new Date(exported_at).toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Sanitize a worksheet name per Excel rules:
 * - Max 31 chars
 * - Cannot contain: : \ / ? * [ ]
 * - Cannot be empty
 */
function sanitizeSheetName(name: string, fallback: string): string {
  const cleaned = name.replace(/[:\\/?*\[\]]/g, "_").slice(0, 31);
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Collect a stable, ordered set of column keys from an array of row objects.
 * Preserves first-seen ordering across all rows so sparse fields still appear.
 */
function collectColumns(rows: any[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const row of rows) {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) {
          seen.add(key);
          ordered.push(key);
        }
      }
    }
  }
  return ordered;
}

/**
 * Coerce a cell value into something Excel/CSV can render safely.
 * Objects and arrays are JSON-stringified; null/undefined become empty.
 */
function toCellValue(v: unknown): string | number | boolean | Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") {
    return v as string | number | boolean;
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export async function downloadBackupAsExcel(blob: Blob): Promise<void> {
  const backup = await parseBackupBlob(blob);
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  let sheetIndex = 0;
  for (const [table, rows] of Object.entries(backup.data)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    sheetIndex += 1;
    const ws = wb.addWorksheet(sanitizeSheetName(table, `sheet_${sheetIndex}`));
    const columns = collectColumns(rows);
    if (columns.length === 0) continue;
    ws.columns = columns.map((key) => ({ header: key, key }));
    for (const row of rows) {
      const mapped: Record<string, ReturnType<typeof toCellValue>> = {};
      for (const key of columns) mapped[key] = toCellValue(row?.[key]);
      ws.addRow(mapped);
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  const outBlob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const ts = backupTimestamp(backup.exported_at);
  await saveToDeviceAsync(outBlob, `belayreports-backup-${ts}.xlsx`);
}

/**
 * RFC 4180 CSV field escaping. Wraps in quotes when the value contains
 * a comma, quote, CR, or LF, and doubles embedded quotes.
 */
function csvEscape(value: ReturnType<typeof toCellValue>): string {
  if (value === null) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function rowsToCsv(rows: any[]): string {
  const columns = collectColumns(rows);
  if (columns.length === 0) return "";
  const lines: string[] = [columns.map((c) => csvEscape(c)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(toCellValue(row?.[c]))).join(","));
  }
  return lines.join("\r\n");
}

export async function downloadBackupAsCsv(blob: Blob): Promise<void> {
  const backup = await parseBackupBlob(blob);
  const zip = new JSZip();

  for (const [table, rows] of Object.entries(backup.data)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const csv = rowsToCsv(rows);
    if (csv.length === 0) continue;
    zip.file(`${table}.csv`, csv);
  }

  const content = await zip.generateAsync({ type: "blob" });
  const ts = backupTimestamp(backup.exported_at);
  await saveToDeviceAsync(content, `belayreports-backup-${ts}.zip`);
}
