import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { Download, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

interface AuditLog {
  id: string;
  created_at: string;
  user_id: string | null;
  action_type: string;
  table_name: string;
  record_id: string | null;
  old_values: any;
  new_values: any;
  metadata: any;
  ip_address: string | null;
  user_agent: string | null;
}

const PAGE_SIZE = 50;

const ACTION_VARIANTS: Record<string, "default" | "destructive" | "secondary" | "outline"> = {
  insert: "default",
  update: "secondary",
  complete: "default",
  reassign: "outline",
  soft_delete: "destructive",
  restore: "outline",
  hard_delete: "destructive",
  grant: "default",
  revoke: "destructive",
};

function getActionVariant(action: string) {
  const suffix = action.split(".").pop() || "";
  return ACTION_VARIANTS[suffix] || "secondary";
}

function shortId(id: string | null) {
  if (!id) return "—";
  return id.slice(0, 8);
}

export function AuditLogPanel() {
  const [page, setPage] = useState(0);
  const [tableFilter, setTableFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs", page, tableFilter, actionFilter, search],
    queryFn: async () => {
      let query = supabase
        .from("audit_logs")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (tableFilter !== "all") query = query.eq("table_name", tableFilter);
      if (actionFilter !== "all") query = query.eq("action_type", actionFilter);
      if (search.trim()) {
        // Try as UUID match on record_id; fall back to action substring
        const term = search.trim();
        query = query.or(`action_type.ilike.%${term}%,record_id.eq.${term}`);
      }

      const { data, error, count } = await query;
      if (error) {
        // record_id.eq.<non-uuid> can throw; retry without it
        if (search.trim()) {
          const retry = await supabase
            .from("audit_logs")
            .select("*", { count: "exact" })
            .order("created_at", { ascending: false })
            .ilike("action_type", `%${search.trim()}%`)
            .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
          if (retry.error) throw retry.error;
          return { rows: (retry.data || []) as AuditLog[], total: retry.count || 0 };
        }
        throw error;
      }
      return { rows: (data || []) as AuditLog[], total: count || 0 };
    },
  });

  const rows = data?.rows || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Resolve user names
  const userIds = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.user_id && set.add(r.user_id));
    return Array.from(set);
  }, [rows]);

  const { data: userMap } = useQuery({
    queryKey: ["audit-users", userIds.sort().join(",")],
    queryFn: async () => {
      if (userIds.length === 0) return {} as Record<string, string>;
      const { data, error } = await supabase.rpc("audit_resolve_users", { _user_ids: userIds });
      if (error) return {} as Record<string, string>;
      const map: Record<string, string> = {};
      (data || []).forEach((u: any) => {
        map[u.id] = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.id.slice(0, 8);
      });
      return map;
    },
    enabled: userIds.length > 0,
  });

  const exportCsv = async () => {
    try {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;

      const header = ["timestamp", "user_id", "action_type", "table_name", "record_id", "old_values", "new_values"];
      const csv = [
        header.join(","),
        ...(data || []).map((r: any) =>
          [
            r.created_at,
            r.user_id || "",
            r.action_type,
            r.table_name,
            r.record_id || "",
            JSON.stringify(r.old_values || ""),
            JSON.stringify(r.new_values || ""),
          ]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(",")
        ),
      ].join("\n");

      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-logs-${format(new Date(), "yyyy-MM-dd")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${data?.length || 0} rows`);
    } catch (e: any) {
      toast.error(e?.message || "Export failed");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="w-5 h-5 text-primary" />
            Audit Trail
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Tamper-evident log of every sensitive action. Records are immutable — they cannot be edited or deleted by anyone.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search action or record ID…"
                value={search}
                onChange={(e) => {
                  setPage(0);
                  setSearch(e.target.value);
                }}
                className="pl-8"
              />
            </div>

            <Select value={tableFilter} onValueChange={(v) => { setPage(0); setTableFilter(v); }}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Table" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tables</SelectItem>
                <SelectItem value="inspections">Inspections</SelectItem>
                <SelectItem value="trainings">Trainings</SelectItem>
                <SelectItem value="daily_assessments">Daily Assessments</SelectItem>
                <SelectItem value="profiles">Profiles</SelectItem>
                <SelectItem value="user_roles">User Roles</SelectItem>
                <SelectItem value="admin_edit_snapshots">Admin Edits</SelectItem>
              </SelectContent>
            </Select>

            <Select value={actionFilter} onValueChange={(v) => { setPage(0); setActionFilter(v); }}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Action" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                <SelectItem value="role.grant">Role Granted</SelectItem>
                <SelectItem value="role.revoke">Role Revoked</SelectItem>
                <SelectItem value="inspections.complete">Inspection Completed</SelectItem>
                <SelectItem value="inspections.soft_delete">Inspection Deleted</SelectItem>
                <SelectItem value="inspections.reassign">Inspection Reassigned</SelectItem>
                <SelectItem value="trainings.complete">Training Completed</SelectItem>
                <SelectItem value="daily_assessments.complete">Assessment Completed</SelectItem>
              </SelectContent>
            </Select>

            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="w-4 h-4 mr-2" /> Export CSV
            </Button>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Table</TableHead>
                  <TableHead>Record</TableHead>
                  <TableHead className="w-20">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No audit entries found.</TableCell></TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {format(new Date(r.created_at), "yyyy-MM-dd HH:mm:ss")}
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.user_id ? (userMap?.[r.user_id] || shortId(r.user_id)) : <span className="text-muted-foreground">system</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getActionVariant(r.action_type)} className="font-mono text-xs">{r.action_type}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.table_name}</TableCell>
                      <TableCell className="font-mono text-xs">{shortId(r.record_id)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => setSelected(r)}>View</Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {rows.map((r) => (
              <Card key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                <CardContent className="p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={getActionVariant(r.action_type)} className="font-mono text-xs">{r.action_type}</Badge>
                    <span className="text-xs text-muted-foreground font-mono">{format(new Date(r.created_at), "MM-dd HH:mm")}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.user_id ? (userMap?.[r.user_id] || shortId(r.user_id)) : "system"} · {r.table_name} · {shortId(r.record_id)}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-muted-foreground">
              {total.toLocaleString()} entries · Page {page + 1} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Badge variant={selected ? getActionVariant(selected.action_type) : "secondary"} className="font-mono">
                {selected?.action_type}
              </Badge>
            </SheetTitle>
            <SheetDescription>
              {selected && format(new Date(selected.created_at), "PPpp")}
            </SheetDescription>
          </SheetHeader>

          {selected && (
            <div className="space-y-4 mt-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">User</div>
                  <div className="font-mono break-all">{selected.user_id ? (userMap?.[selected.user_id] || selected.user_id) : "system"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Table</div>
                  <div className="font-mono">{selected.table_name}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-xs text-muted-foreground">Record ID</div>
                  <div className="font-mono break-all">{selected.record_id || "—"}</div>
                </div>
                {selected.ip_address && (
                  <div>
                    <div className="text-xs text-muted-foreground">IP</div>
                    <div className="font-mono">{String(selected.ip_address)}</div>
                  </div>
                )}
              </div>

              {selected.metadata && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Metadata</div>
                  <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">{JSON.stringify(selected.metadata, null, 2)}</pre>
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Old values</div>
                  <pre className="text-xs bg-destructive/5 border border-destructive/20 p-2 rounded overflow-x-auto max-h-96">
{selected.old_values ? JSON.stringify(selected.old_values, null, 2) : "—"}
                  </pre>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">New values</div>
                  <pre className="text-xs bg-primary/5 border border-primary/20 p-2 rounded overflow-x-auto max-h-96">
{selected.new_values ? JSON.stringify(selected.new_values, null, 2) : "—"}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
