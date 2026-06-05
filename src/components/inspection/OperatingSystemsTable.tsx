import { Button } from "@/components/ui/button";
import { VoiceRichTextEditor } from "@/components/ui/voice-rich-text-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import ResultSelect from "@/components/ResultSelect";
import SystemTypeSelect from "@/components/SystemTypeSelect";
import { GlobalAutocomplete } from "@/components/GlobalAutocomplete";
import { Plus, Trash2, Minus } from "lucide-react";
import ItemPhotoUpload from "./ItemPhotoUpload";
import { Input } from "@/components/ui/input";
import { DebouncedInput } from "./DebouncedInput";
import { focusNextCell, preserveScroll } from "@/lib/table-focus-utils";
import { useState, useCallback, useEffect, memo } from "react";
import { addChildTombstone, clearChildTombstone } from "@/lib/child-row-tombstones";
import { osBusinessKey } from "@/lib/form-loaders/inspectionLoader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DraggableTableRow, DraggableMobileCard } from "./DraggableTableRow";
import { useNativeDrag } from "@/hooks/useNativeDrag";
import { useSystemTypeOptions } from "@/hooks/useSystemTypeOptions";
import { useElementNameOptions } from "@/hooks/useElementNameOptions";
import { useMemo } from "react";

import { isPhotoTraceEnabled } from "@/lib/photo-trace";
interface OperatingSystemsTableProps {
  systems: any[];
  onUpdate: (systemsOrUpdater: any[] | ((prev: any[]) => any[])) => void;
  onImmediateSave?: () => void;
  inspectionId?: string;
  onGalleryRefresh?: () => void;
}

const OS_GRID_COLS = "grid-cols-[40px_88px_minmax(180px,1fr)_minmax(160px,1fr)_192px_minmax(150px,1fr)_64px]";

function OperatingSystemsTable({ systems, onUpdate, onImmediateSave: rawOnImmediateSave, inspectionId, onGalleryRefresh }: OperatingSystemsTableProps) {
  const [itemToDelete, setItemToDelete] = useState<{ id: string; name: string } | null>(null);
  const [newItemId, setNewItemId] = useState<string | null>(null);
  const effectiveInspectionId = inspectionId || window.location.pathname.split('/').pop() || '';

  // Wrap onImmediateSave so blur/Enter-driven re-renders never lose the scroll position.
  const onImmediateSave = useCallback(() => {
    if (!rawOnImmediateSave) return;
    preserveScroll(() => rawOnImmediateSave());
  }, [rawOnImmediateSave]);

  const { getDragProps } = useNativeDrag(systems, (reordered) => onUpdate(reordered));

  // Collect existing system_name values for persistent auto-populate
  const existingSystemNames = useMemo(() => {
    return [...new Set(systems.filter(s => !s.is_divider && s.system_name?.trim()).map(s => s.system_name.trim()))];
  }, [systems]);

  // Collect existing element name values from in-progress rows; the hook
  // merges these with the seeded/server-backed options.
  const existingElementNames = useMemo(() => {
    return [...new Set(systems.filter(s => !s.is_divider && s.name?.trim()).map(s => s.name.trim()))];
  }, [systems]);

  const { options: systemTypeOptions, addOption: addSystemTypeOption } = useSystemTypeOptions(existingSystemNames);
  const { options: elementNameOptions } = useElementNameOptions(existingElementNames);

  useEffect(() => {
    if (!newItemId) return;
    requestAnimationFrame(() => {
      const row = document.querySelector(`[data-row-id="${newItemId}"]`);
      if (row) {
        const input = row.querySelector<HTMLElement>(
          'input:not([disabled]):not([type="file"]), [contenteditable="true"], [tabindex="0"]'
        );
        if (input) {
          input.focus();
          if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
            const len = input.value.length;
            input.setSelectionRange(len, len);
          }
        }
      }
      setNewItemId(null);
    });
  }, [newItemId]);

  const addSystem = useCallback(() => {
    const id = `temp-${crypto.randomUUID()}`;
    setNewItemId(id);
    onUpdate(prev => {
      const minOrder = prev.reduce(
        (m, p) => Math.min(m, typeof p.display_order === 'number' ? p.display_order : 0),
        0
      );
      return [
        {
          id,
          inspection_id: window.location.pathname.split('/').pop(),
          system_name: "",
          result: "",
          comments: "",
          is_divider: false,
          display_order: minOrder - 1,
        },
        ...prev
      ];
    });
  }, [onUpdate]);

  const addDivider = useCallback(() => {
    onUpdate(prev => {
      const minOrder = prev.reduce(
        (m, p) => Math.min(m, typeof p.display_order === 'number' ? p.display_order : 0),
        0
      );
      return [
        {
          id: `temp-${crypto.randomUUID()}`,
          inspection_id: window.location.pathname.split('/').pop(),
          system_name: null,
          result: null,
          comments: null,
          is_divider: true,
          divider_text: "",
          display_order: minOrder - 1,
        },
        ...prev
      ];
    });
  }, [onUpdate]);

  // Dropdown / select-style fields commit on selection (no blur event), so we
  // defer an immediate save by one tick to flush IDB before navigation.
  const COMMIT_FIELDS = new Set(['result', 'system_name']);

  const updateSystem = useCallback((item: any, field: string, value: any) => {
    onUpdate(prev => {
      const next = prev.map(s => s.id === item.id ? { ...s, [field]: value } : s);
      if (isPhotoTraceEnabled()) {
        const before = prev.find(s => s.id === item.id);
        const after = next.find(s => s.id === item.id);
        // eslint-disable-next-line no-console
        console.debug('[photo-trace updater system]', {
          itemId: item.id,
          itemName: before?.system_name,
          field, value,
          beforePhoto: before?.photo_url ?? null,
          afterPhoto: after?.photo_url ?? null,
          identityChanged: before !== after,
          arrayLen: next.length,
        });
        try {
          (window as any).__photoTrace = (window as any).__photoTrace || [];
          (window as any).__photoTrace.push({ ts: Date.now(), event: 'updater.system', itemId: item.id, field, value, beforePhoto: before?.photo_url ?? null, afterPhoto: after?.photo_url ?? null });
        } catch { /* ignore */ }
      }
      return next;
    });
    if (COMMIT_FIELDS.has(field) && onImmediateSave) {
      setTimeout(() => onImmediateSave(), 0);
    }
    // Re-add heal: if the user is typing a name/system_name that matches a
    // prior delete tombstone (same businessKey) or restoring a tombstoned
    // server-id row, lift the tombstone so the row survives reload.
    if ((field === "name" || field === "system_name") && effectiveInspectionId) {
      const merged = { ...item, [field]: value };
      const bk = osBusinessKey(merged);
      if (bk) {
        clearChildTombstone("inspection_operating_system", effectiveInspectionId, { businessKey: bk });
      }
      if (item.id && !String(item.id).startsWith("temp-")) {
        clearChildTombstone("inspection_operating_system", effectiveInspectionId, { id: item.id });
      }
    }
  }, [onUpdate, onImmediateSave, effectiveInspectionId]);


  const handleDeleteConfirm = useCallback(() => {
    if (itemToDelete) {
      // Persistent tombstone — survives reload, server refetch, default-seed
      // imports, and "ensure ≥1 row" merge defaults. Anchored to both server
      // id (when present) and a stable businessKey (name+systemName) so
      // unsynced temp-id rows are also covered.
      const target = systems.find((s: any) => s.id === itemToDelete.id);
      const businessKey = target
        ? [(target.name ?? "").toString().trim().toLowerCase(),
           (target.system_name ?? "").toString().trim().toLowerCase()]
            .filter(Boolean).join("|") || null
        : null;
      addChildTombstone(
        "inspection_operating_system",
        effectiveInspectionId,
        {
          id: itemToDelete.id?.startsWith("temp-") ? null : itemToDelete.id,
          businessKey,
        },
        "explicit-user-delete",
      );
      onUpdate(prev => prev.filter(s => s.id !== itemToDelete.id));
      onImmediateSave?.();
      setItemToDelete(null);
    }
  }, [itemToDelete, onUpdate, onImmediateSave, systems, effectiveInspectionId]);

  return (
    <Card>
      <CardHeader className="px-4 lg:px-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <CardTitle>Operating Systems</CardTitle>
          <div className="flex gap-2 w-full lg:w-auto">
            <Button onClick={addDivider} size="sm" variant="outline" className="flex-1 lg:flex-none shrink-0">
              <Minus className="w-4 h-4 mr-2" />
              Divider
            </Button>
            <Button onClick={addSystem} size="sm" className="flex-1 lg:flex-none shrink-0">
              <Plus className="w-4 h-4 mr-2" />
              Add System
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3 lg:px-6">
        {/* Desktop grid view */}
        <div className="hidden lg:block overflow-x-auto scrollbar-prominent pb-3">
          {/* Header */}
          <div className={`grid ${OS_GRID_COLS} bg-blue-50 dark:bg-blue-950/20 border-b border-border`}>
            <div className="p-3 text-center font-semibold text-sm border-r border-border"></div>
            <div className="p-3 text-center font-semibold text-sm border-r border-border">Photo</div>
            <div className="p-3 text-left font-semibold text-sm border-r border-border">Element Name</div>
            <div className="p-3 text-left font-semibold text-sm border-r border-border">Operating System</div>
            <div className="p-3 text-left font-semibold text-sm border-r border-border">Result</div>
            <div className="p-3 text-left font-semibold text-sm border-r border-border break-words">Comments and/or Required Changes</div>
            <div className="p-3 text-center font-semibold text-sm"></div>
          </div>
          {/* Rows */}
          <div className="border border-t-0 border-border rounded-b">
            {systems.map((system) => (
              <DraggableTableRow
                key={system.id}
                id={system.id}
                className="hover:bg-muted/50"
                gridCols={OS_GRID_COLS}
                {...getDragProps(system.id)}
              >
                {system.is_divider ? (
                  <div className="col-span-6 flex items-center bg-blue-100 dark:bg-blue-900/30">
                    <div className="p-2 flex-1">
                      <DebouncedInput
                        value={system.divider_text || ""}
                        onChange={(value) => updateSystem(system, "divider_text", value)}
                        onBlur={onImmediateSave}
                        placeholder="Enter divider text..."
                        className="border-0 bg-transparent text-center font-bold text-base"
                      />
                    </div>
                    <div className="p-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setItemToDelete({ id: system.id, name: system.divider_text || "this divider" })}
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="p-2 border-r border-border flex items-center justify-center">
                      <ItemPhotoUpload
                        itemId={system.id}
                        inspectionId={effectiveInspectionId}
                        photoUrl={system.photo_url || null}
                        onPhotoChange={(url) => updateSystem(system, "photo_url", url)}
                        onImmediateSave={onImmediateSave}
                        itemName={system.name || system.system_name || 'Operating System'}
                        photoSection="systems"
                        onGalleryRefresh={onGalleryRefresh}
                      />
                    </div>
                    <div className="p-2 border-r border-border">
                      <GlobalAutocomplete
                        value={system.name || ""}
                        onChange={(value) => updateSystem(system, "name", value)}
                        onBlur={onImmediateSave}
                        fieldType="operating_system_element"
                        placeholder="Enter or select name"
                        className="border-0 bg-transparent"
                        existingValues={elementNameOptions}
                      />
                    </div>
                    <div className="p-2 border-r border-border">
                      <SystemTypeSelect
                        value={system.system_name}
                        onChange={(value) => updateSystem(system, "system_name", value)}
                        options={systemTypeOptions}
                        onAddOption={addSystemTypeOption}
                      />
                    </div>
                    <div className="p-2 border-r border-border">
                      <ResultSelect
                        value={system.result}
                        onChange={(value) => updateSystem(system, "result", value)}
                      />
                    </div>
                    <div className="p-2 border-r border-border min-w-0 overflow-hidden">
                      <VoiceRichTextEditor
                        content={system.comments || ""}
                        onChange={(value) => updateSystem(system, "comments", value)}
                        onBlur={onImmediateSave}
                        placeholder="Enter comments..."
                        className="border-0 bg-transparent"
                      />
                    </div>
                    <div className="p-2 text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setItemToDelete({ id: system.id, name: system.name || system.system_name || "this system" })}
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </>
                )}
              </DraggableTableRow>
            ))}
          </div>
        </div>
        
        {/* Mobile card view */}
        <div className="lg:hidden space-y-3">
          {systems.map((system) => (
            <DraggableMobileCard key={system.id} id={system.id} {...getDragProps(system.id)}>
              {system.is_divider ? (
                <div className="p-4 pl-12 relative rounded-lg bg-blue-100 dark:bg-blue-900/30 border border-border flex items-center">
                   <DebouncedInput
                     value={system.divider_text || ""}
                     onChange={(value) => updateSystem(system, "divider_text", value)}
                     onBlur={onImmediateSave}
                     placeholder="Enter divider text..."
                     className="border-0 bg-transparent text-center font-bold text-base flex-1"
                   />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setItemToDelete({ id: system.id, name: system.divider_text || "this divider" })}
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10 ml-2"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="p-4 pl-12 relative border-l-4 border-l-primary/20 rounded-lg bg-muted/30 border border-border">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setItemToDelete({ id: system.id, name: system.name || system.system_name || "this system" })}
                    className="absolute top-3 right-3 h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <div className="space-y-3 pr-10">
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-3">
                        <ItemPhotoUpload
                          itemId={system.id}
                          inspectionId={effectiveInspectionId}
                          photoUrl={system.photo_url || null}
                          onPhotoChange={(url) => updateSystem(system, "photo_url", url)}
                          onImmediateSave={onImmediateSave}
                          itemName={system.name || system.system_name || 'Operating System'}
                          photoSection="systems"
                          onGalleryRefresh={onGalleryRefresh}
                        />
                        <div className="flex-1 min-w-0">
                          <Label className="text-xs text-muted-foreground">Element Name</Label>
                          <GlobalAutocomplete
                            value={system.name || ""}
                            onChange={(value) => updateSystem(system, "name", value)}
                            onBlur={onImmediateSave}
                            fieldType="operating_system_element"
                            placeholder="Enter or select name"
                            existingValues={elementNameOptions}
                          />
                        </div>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Operating System</Label>
                      <SystemTypeSelect
                        value={system.system_name}
                        onChange={(value) => updateSystem(system, "system_name", value)}
                        options={systemTypeOptions}
                        onAddOption={addSystemTypeOption}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Result</Label>
                      <ResultSelect
                        value={system.result}
                        onChange={(value) => updateSystem(system, "result", value)}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Comments / Changes</Label>
                      <VoiceRichTextEditor
                        content={system.comments || ""}
                        onChange={(value) => updateSystem(system, "comments", value)}
                        onBlur={onImmediateSave}
                        placeholder="Enter comments..."
                      />
                    </div>
                  </div>
                </div>
              )}
            </DraggableMobileCard>
          ))}
        </div>
        
        <div className="mt-6 text-xs text-muted-foreground border-t pt-4">
          <p>
            The information contained in this report has been documented by a Qualified Professional. 
            This report is effective for one year from the date of inspection. Issued by: 
            Rope Works Inc., PO Box 1074, Dripping Springs, TX 78620
          </p>
        </div>
      </CardContent>

      <AlertDialog open={!!itemToDelete} onOpenChange={(open) => !open && setItemToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Operating System</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{itemToDelete?.name || "this system"}</strong>?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default memo(OperatingSystemsTable);
