import * as XLSX from "xlsx";
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

export async function downloadBackupAsExcel(blob: Blob): Promise<void> {
  const backup = await parseBackupBlob(blob);
  const wb = XLSX.utils.book_new();

  for (const [table, rows] of Object.entries(backup.data)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const ws = XLSX.utils.json_to_sheet(rows);
    // Sheet names max 31 chars
    const name = table.length > 31 ? table.slice(0, 31) : table;
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const outBlob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const ts = backupTimestamp(backup.exported_at);
  await saveToDeviceAsync(outBlob, `ropeworks-backup-${ts}.xlsx`);
}

export async function downloadBackupAsCsv(blob: Blob): Promise<void> {
  const backup = await parseBackupBlob(blob);
  const zip = new JSZip();

  for (const [table, rows] of Object.entries(backup.data)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const ws = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    zip.file(`${table}.csv`, csv);
  }

  const content = await zip.generateAsync({ type: "blob" });
  const ts = backupTimestamp(backup.exported_at);
  await saveToDeviceAsync(content, `ropeworks-backup-${ts}.zip`);
}
