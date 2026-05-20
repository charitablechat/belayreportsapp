import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DebouncedInput } from "./DebouncedInput";
import { VoiceRichTextEditor } from "@/components/ui/voice-rich-text-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ResultSelect from "@/components/ResultSelect";
import { GlobalAutocomplete } from "@/components/GlobalAutocomplete";
import { Plus, Trash2 } from "lucide-react";
import ItemPhotoUpload from "./ItemPhotoUpload";
import { focusNextCell, preserveScroll } from "@/lib/table-focus-utils";
import { useState, useCallback, useEffect, memo } from "react";
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
import { WideTableScroller } from "@/components/ui/wide-table-scroller";


import { isPhotoTraceEnabled } from "@/lib/photo-trace";
interface ZiplinesTableProps {
  ziplines: any[];
  onUpdate: (ziplinesOrUpdater: any[] | ((prev: any[]) => any[])) => void;
  onImmediateSave?: () => void;
  onDeleteZipline?: (zipline: any) => void;
  inspectionId?: string;
  onGalleryRefresh?: () => void;
}

const ZIP_GRID_COLS = "grid-cols-[40px_88px_minmax(180px,1.5fr)_80px_80px_80px_80px_100px_80px_100px_80px_100px_100px_minmax(220px,1.5fr)_56px]";

function ZiplinesTable({ ziplines, onUpdate, onImmediateSave: rawOnImmediateSave, onDeleteZipline, inspectionId, onGalleryRefresh }: ZiplinesTableProps) {
  const [itemToDelete, setItemToDelete] = useState<{ id: string; name: string; row?: any } | null>(null);
  const [newItemId, setNewItemId] = useState<string | null>(null);
  const effectiveInspectionId = inspectionId || window.location.pathname.split('/').pop() || '';

  // Wrap onImmediateSave so blur/Enter-driven re-renders never lose the scroll position.
  const onImmediateSave = useCallback(() => {
    if (!rawOnImmediateSave) return;
    preserveScroll(() => rawOnImmediateSave());
  }, [rawOnImmediateSave]);

  const { getDragProps } = useNativeDrag(ziplines, (reordered) => onUpdate(reordered));

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

  const addZipline = useCallback(() => {
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
          zipline_name: "",
          cable_type: "",
          cable_length: null,
          unload_tension: null,
          load_tension: null,
          cable_result: "",
          braking_system: "",
          braking_result: "",
          ead_system: "",
          ead_result: "",
          result: "",
          comments: "",
          display_order: minOrder - 1,
        },
        ...prev,
      ];
    });
  }, [onUpdate]);

  // Dropdown / select-style fields commit on selection (no blur event), so we
  // defer an immediate save by one tick to flush IDB before navigation.
  const COMMIT_FIELDS = new Set([
    'cable_type', 'cable_result',
    'braking_system', 'braking_result',
    'ead_system', 'ead_result',
    'result',
  ]);

  const updateZipline = useCallback((item: any, field: string, value: any) => {
    onUpdate(prev => {
      const next = prev.map(z => z.id === item.id ? { ...z, [field]: value } : z);
      if (isPhotoTraceEnabled()) {
        const before = prev.find(z => z.id === item.id);
        const after = next.find(z => z.id === item.id);
        // eslint-disable-next-line no-console
        console.debug('[photo-trace updater zipline]', {
          itemId: item.id,
          itemName: before?.zipline_name,
          field, value,
          beforePhoto: before?.photo_url ?? null,
          afterPhoto: after?.photo_url ?? null,
          identityChanged: before !== after,
          arrayLen: next.length,
        });
        try {
          (window as any).__photoTrace = (window as any).__photoTrace || [];
          (window as any).__photoTrace.push({ ts: Date.now(), event: 'updater.zipline', itemId: item.id, field, value, beforePhoto: before?.photo_url ?? null, afterPhoto: after?.photo_url ?? null });
        } catch { /* ignore */ }
      }
      return next;
    });
    if (COMMIT_FIELDS.has(field) && onImmediateSave) {
      setTimeout(() => onImmediateSave(), 0);
    }
  }, [onUpdate, onImmediateSave]);


  const handleDeleteConfirm = useCallback(() => {
    if (itemToDelete) {
      if (onDeleteZipline && itemToDelete.row) {
        onDeleteZipline(itemToDelete.row);
      } else {
        onUpdate(prev => prev.filter(z => z.id !== itemToDelete.id));
        onImmediateSave?.();
      }
      setItemToDelete(null);
    }
  }, [itemToDelete, onDeleteZipline, onUpdate, onImmediateSave]);

  return (
    <Card>
      <CardHeader className="px-4 lg:px-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <CardTitle>Ziplines</CardTitle>
          <Button onClick={addZipline} size="sm" className="w-full lg:w-auto shrink-0">
            <Plus className="w-4 h-4 mr-2" />
            Add Zipline
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-3 lg:px-6">
        <div className="mb-4 space-y-1 text-xs text-muted-foreground">
          <p><strong>Cable Type KEY:</strong> GAC = Galvanized Aircraft Cable, SS = Super Swaged</p>
          <p><strong>Braking System KEY:</strong> ZS = Zip Stop, FB = Friction Break, SB = Spring Bank, G = Gravity</p>
          <p><strong>Emergency Brake System KEY -</strong> ZS = Zip Stop, AP = Auto Prusik, SB = Spring Bank</p>
        </div>

        {/* Desktop grid view */}
        <div className="hidden lg:block">
          <WideTableScroller ariaLabel="Ziplines table horizontal scroll">
            <div className="min-w-[1440px]">

            {/* Header */}
            <div className={`grid ${ZIP_GRID_COLS} bg-blue-50 dark:bg-blue-950/20 border-b border-border text-xs`}>

              <div className="p-2 text-center font-semibold border-r border-border"></div>
              <div className="p-2 text-center font-semibold border-r border-border text-xs">Photo</div>
              <div className="p-2 text-left font-semibold border-r border-border">Line Name</div>
              <div className="p-2 text-left font-semibold border-r border-border">Cable Type</div>
              <div className="p-2 text-left font-semibold border-r border-border">Length (ft)</div>
              <div className="p-2 text-left font-semibold border-r border-border">Unload (lbf)</div>
              <div className="p-2 text-left font-semibold border-r border-border">Load (lbf)</div>
              <div className="p-2 text-left font-semibold border-r border-border">Cable Result</div>
              <div className="p-2 text-left font-semibold border-r border-border">Braking Sys</div>
              <div className="p-2 text-left font-semibold border-r border-border">Braking Result</div>
              <div className="p-2 text-left font-semibold border-r border-border">EAD Sys</div>
              <div className="p-2 text-left font-semibold border-r border-border">EAD Result</div>
              <div className="p-2 text-left font-semibold border-r border-border">Overall</div>
              <div className="p-2 text-left font-semibold border-r border-border break-words">Comments</div>
              <div className="p-2 text-center font-semibold"></div>
            </div>
            {/* Rows */}
            <div className="border border-t-0 border-border rounded-b">
              {ziplines.map((zipline) => (
                <DraggableTableRow
                  key={zipline.id}
                  id={zipline.id}
                  className="hover:bg-muted/50 text-sm"
                  gridCols={ZIP_GRID_COLS}
                  {...getDragProps(zipline.id)}
                >
                  <div className="p-1 border-r border-border flex items-center justify-center">
                    <ItemPhotoUpload
                      itemId={zipline.id}
                      inspectionId={effectiveInspectionId}
                      photoUrl={zipline.photo_url || null}
                      onPhotoChange={(url) => updateZipline(zipline, "photo_url", url)}
                      onImmediateSave={onImmediateSave}
                      itemName={zipline.zipline_name || 'Zipline'}
                      photoSection="systems"
                      onGalleryRefresh={onGalleryRefresh}
                    />
                  </div>
                  <div className="p-1 border-r border-border min-w-0">
                    <GlobalAutocomplete
                      value={zipline.zipline_name}
                      onChange={(value) => updateZipline(zipline, "zipline_name", value)}
                      onBlur={onImmediateSave}
                      fieldType="zipline_name"
                      placeholder="Name"
                      className="border-0 bg-transparent h-8 text-xs w-full"
                    />
                  </div>
                  <div className="p-1 border-r border-border">
                    <Select value={zipline.cable_type} onValueChange={(value) => updateZipline(zipline, "cable_type", value)}>
                      <SelectTrigger className="h-8 text-xs border-0 bg-transparent"><SelectValue placeholder="Type" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GAC">GAC</SelectItem>
                        <SelectItem value="SS">SS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="p-1 border-r border-border">
                    <DebouncedInput type="number" value={String(zipline.cable_length || "")} onChange={(value) => updateZipline(zipline, "cable_length", parseFloat(value) || null)} onBlur={onImmediateSave} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onImmediateSave?.(); focusNextCell(e.currentTarget as HTMLElement); } }} placeholder="ft" className="border-0 bg-transparent h-8 text-xs" />
                  </div>
                  <div className="p-1 border-r border-border">
                    <DebouncedInput type="number" value={String(zipline.unload_tension || "")} onChange={(value) => updateZipline(zipline, "unload_tension", parseFloat(value) || null)} onBlur={onImmediateSave} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onImmediateSave?.(); focusNextCell(e.currentTarget as HTMLElement); } }} placeholder="lbf" className="border-0 bg-transparent h-8 text-xs" />
                  </div>
                  <div className="p-1 border-r border-border">
                    <DebouncedInput type="number" value={String(zipline.load_tension || "")} onChange={(value) => updateZipline(zipline, "load_tension", parseFloat(value) || null)} onBlur={onImmediateSave} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onImmediateSave?.(); focusNextCell(e.currentTarget as HTMLElement); } }} placeholder="lbf" className="border-0 bg-transparent h-8 text-xs" />
                  </div>
                  <div className="p-1 border-r border-border">
                    <ResultSelect value={zipline.cable_result} onChange={(value) => updateZipline(zipline, "cable_result", value)} />
                  </div>
                  <div className="p-1 border-r border-border">
                    <Select value={zipline.braking_system} onValueChange={(value) => updateZipline(zipline, "braking_system", value)}>
                      <SelectTrigger className="h-8 text-xs border-0 bg-transparent"><SelectValue placeholder="Sys" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ZS">ZS</SelectItem>
                        <SelectItem value="FB">FB</SelectItem>
                        <SelectItem value="SB">SB</SelectItem>
                        <SelectItem value="G">G</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="p-1 border-r border-border">
                    <ResultSelect value={zipline.braking_result} onChange={(value) => updateZipline(zipline, "braking_result", value)} />
                  </div>
                  <div className="p-1 border-r border-border">
                    <Select value={zipline.ead_system} onValueChange={(value) => updateZipline(zipline, "ead_system", value)}>
                      <SelectTrigger className="h-8 text-xs border-0 bg-transparent"><SelectValue placeholder="Sys" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ZS">ZS</SelectItem>
                        <SelectItem value="AP">AP</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="p-1 border-r border-border">
                    <ResultSelect value={zipline.ead_result} onChange={(value) => updateZipline(zipline, "ead_result", value)} />
                  </div>
                  <div className="p-1 border-r border-border">
                    <ResultSelect value={zipline.result} onChange={(value) => updateZipline(zipline, "result", value)} />
                  </div>
                  <div className="p-1 border-r border-border min-w-0 overflow-hidden">
                    <VoiceRichTextEditor content={zipline.comments || ""} onChange={(value) => updateZipline(zipline, "comments", value)} onBlur={onImmediateSave} placeholder="Comments..." className="border-0 bg-transparent" />
                  </div>
                  <div className="p-1 text-center">
                    <Button variant="ghost" size="sm" onClick={() => setItemToDelete({ id: zipline.id, name: zipline.zipline_name || "this zipline" })} className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </DraggableTableRow>
              ))}
            </div>
          </div>
          </WideTableScroller>
        </div>


        

        
        {/* Mobile/Tablet card view */}
        <div className="lg:hidden space-y-3">
          {ziplines.map((zipline) => (
            <DraggableMobileCard key={zipline.id} id={zipline.id} {...getDragProps(zipline.id)}>
              <div className="p-4 pl-12 relative border-l-4 border-l-primary/20 rounded-lg bg-muted/30 border border-border">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setItemToDelete({ id: zipline.id, name: zipline.zipline_name || "this zipline" })}
                  className="absolute top-3 right-3 h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                <div className="space-y-3 pr-10">
                  <div className="flex items-center gap-3">
                    <ItemPhotoUpload
                      itemId={zipline.id}
                      inspectionId={effectiveInspectionId}
                      photoUrl={zipline.photo_url || null}
                      onPhotoChange={(url) => updateZipline(zipline, "photo_url", url)}
                      onImmediateSave={onImmediateSave}
                      itemName={zipline.zipline_name || 'Zipline'}
                      photoSection="systems"
                      onGalleryRefresh={onGalleryRefresh}
                    />
                    <div className="flex-1 min-w-0">
                      <Label className="text-xs text-muted-foreground">Line Name</Label>
                      <GlobalAutocomplete
                      value={zipline.zipline_name}
                      onChange={(value) => updateZipline(zipline, "zipline_name", value)}
                      onBlur={onImmediateSave}
                      fieldType="zipline_name"
                      placeholder="Enter or select name"
                    />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="min-w-0">
                      <Label className="text-xs text-muted-foreground">Cable Type</Label>
                      <Select value={zipline.cable_type} onValueChange={(value) => updateZipline(zipline, "cable_type", value)}>
                        <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="GAC">GAC</SelectItem>
                          <SelectItem value="SS">SS</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="min-w-0">
                      <Label className="text-xs text-muted-foreground">Length (ft)</Label>
                      <DebouncedInput type="number" value={String(zipline.cable_length || "")} onChange={(value) => updateZipline(zipline, "cable_length", parseFloat(value) || null)} onBlur={onImmediateSave} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onImmediateSave?.(); focusNextCell(e.currentTarget as HTMLElement); } }} placeholder="Length" />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="min-w-0">
                      <Label className="text-xs text-muted-foreground">Unload</Label>
                      <DebouncedInput type="number" value={String(zipline.unload_tension || "")} onChange={(value) => updateZipline(zipline, "unload_tension", parseFloat(value) || null)} onBlur={onImmediateSave} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onImmediateSave?.(); focusNextCell(e.currentTarget as HTMLElement); } }} placeholder="Unload" />
                    </div>
                    <div className="min-w-0">
                      <Label className="text-xs text-muted-foreground">Load</Label>
                      <DebouncedInput type="number" value={String(zipline.load_tension || "")} onChange={(value) => updateZipline(zipline, "load_tension", parseFloat(value) || null)} onBlur={onImmediateSave} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onImmediateSave?.(); focusNextCell(e.currentTarget as HTMLElement); } }} placeholder="Load" />
                    </div>
                  </div>
                  
                  <div>
                    <Label className="text-xs text-muted-foreground">Cable Result</Label>
                    <ResultSelect value={zipline.cable_result} onChange={(value) => updateZipline(zipline, "cable_result", value)} />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="min-w-0">
                      <Label className="text-xs text-muted-foreground">Braking Sys</Label>
                      <Select value={zipline.braking_system} onValueChange={(value) => updateZipline(zipline, "braking_system", value)}>
                        <SelectTrigger><SelectValue placeholder="System" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ZS">ZS - Zip Stop</SelectItem>
                          <SelectItem value="FB">FB - Friction Break</SelectItem>
                          <SelectItem value="SB">SB - Spring Bank</SelectItem>
                          <SelectItem value="G">G - Gravity</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="min-w-0">
                      <Label className="text-xs text-muted-foreground">Brake Result</Label>
                      <ResultSelect value={zipline.braking_result} onChange={(value) => updateZipline(zipline, "braking_result", value)} />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="min-w-0">
                      <Label className="text-xs text-muted-foreground">EAD Sys</Label>
                      <Select value={zipline.ead_system} onValueChange={(value) => updateZipline(zipline, "ead_system", value)}>
                        <SelectTrigger><SelectValue placeholder="System" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ZS">ZS - Zip Stop</SelectItem>
                          <SelectItem value="AP">AP - Auto P</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="min-w-0">
                      <Label className="text-xs text-muted-foreground">EAD Result</Label>
                      <ResultSelect value={zipline.ead_result} onChange={(value) => updateZipline(zipline, "ead_result", value)} />
                    </div>
                  </div>
                  
                  <div>
                    <Label className="text-xs text-muted-foreground">Overall Result</Label>
                    <ResultSelect value={zipline.result} onChange={(value) => updateZipline(zipline, "result", value)} />
                  </div>
                  
                  <div>
                    <Label className="text-xs text-muted-foreground">Comments / Changes</Label>
                    <VoiceRichTextEditor content={zipline.comments || ""} onChange={(value) => updateZipline(zipline, "comments", value)} onBlur={onImmediateSave} placeholder="Enter comments..." />
                  </div>
                </div>
              </div>
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
            <AlertDialogTitle>Delete Zipline</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{itemToDelete?.name || "this zipline"}</strong>?
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

export default memo(ZiplinesTable);
