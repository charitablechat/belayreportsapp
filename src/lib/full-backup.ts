import { supabase } from "@/integrations/supabase/client";
import { saveToDevice } from "@/lib/save-to-device";

export async function triggerFullBackup(): Promise<{
  file_path: string;
  file_size_bytes: number;
  table_counts: Record<string, number>;
}> {
  const { data, error } = await supabase.functions.invoke("export-full-backup");
  if (error) throw new Error(error.message || "Backup failed");
  if (!data?.success) throw new Error(data?.error || "Backup failed");
  return data;
}

export async function downloadBackupFileRaw(filePath: string): Promise<Blob> {
  const { data, error } = await supabase.storage
    .from("database-backups")
    .download(filePath);

  if (error || !data) throw new Error("Failed to download backup file");
  return data;
}

export async function downloadBackupFile(filePath: string): Promise<void> {
  const data = await downloadBackupFileRaw(filePath);
  const timestamp = filePath.replace(/backup-/g, "").replace(/\.json/g, "").replace(/daily\//g, "");
  const ext = filePath.endsWith(".zip") ? "zip" : "json";
  saveToDevice(data, `belayreports-full-backup-${timestamp}.${ext}`);
}

export async function listServerBackups(): Promise<
  Array<{
    id: string;
    file_path: string;
    file_size_bytes: number | null;
    table_counts: Record<string, number> | null;
    created_at: string;
    created_by: string | null;
  }>
> {
  const { data, error } = await supabase
    .from("backup_history" as any)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;
  return (data as any) || [];
}

export async function getLatestBackup(): Promise<{
  id: string;
  file_path: string;
  created_at: string;
} | null> {
  const { data, error } = await supabase
    .from("backup_history" as any)
    .select("id, file_path, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data as any;
}

export async function restoreFromServer(filePath: string): Promise<any> {
  const { data, error } = await supabase.functions.invoke("restore-full-backup", {
    body: { file_path: filePath },
  });
  if (error) throw new Error(error.message || "Restore failed");
  if (!data?.success) throw new Error(data?.error || "Restore failed");
  return data;
}

export async function restoreFromFile(file: File): Promise<any> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!parsed.version || !parsed.data) {
    throw new Error("Invalid backup file format");
  }

  const { data, error } = await supabase.functions.invoke("restore-full-backup", {
    body: parsed,
  });
  if (error) throw new Error(error.message || "Restore failed");
  if (!data?.success) throw new Error(data?.error || "Restore failed");
  return data;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
