import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DebouncedInput } from "./DebouncedInput";
import { LazyRichTextEditor } from "@/components/ui/lazy-rich-text-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import ResultSelect from "@/components/ResultSelect";
import { EquipmentTypeCombobox } from "./EquipmentTypeCombobox";
import { Plus, Trash2, X, Minus } from "lucide-react";
import ItemPhotoUpload from "./ItemPhotoUpload";
import { cn } from "@/lib/utils";
import { focusNextCell, preserveScroll } from "@/lib/table-focus-utils";
import { useState, useMemo, useCallback, useEffect, memo, useRef } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
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

interface EquipmentTableProps {
  category: string;
  displayName: string;
  equipment: any[];
  onUpdate: (equipmentOrUpdater: any[] | ((prev: any[]) => any[])) => void;
  onImmediateSave?: () => void;
  categoryOptions?: string[];
  onAddCategoryOption?: (label: string) => void;
  inspectionId?: string;
  onGalleryRefresh?: () => void;
}

const EQ_GRID_COLS = "grid-cols-[40px_88px_minmax(120px,1fr)_128px_96px_160px_minmax(150px,1fr)_64px]";

function EquipmentTable({ category, displayName, equipment, onUpdate, onImmediateSave: rawOnImmediateSave, categoryOptions = [], onAddCategoryOption, inspectionId, onGalleryRefresh }: EquipmentTableProps) {
  const isMobile = useIsMobile();
  const effectiveInspectionId = inspectionId || window.location.pathname.split('/').pop() || '';

  // Wrap onImmediateSave so blur/Enter-driven re-renders never lose the scroll position.
  const onImmediateSave = useCallback(() => {
    if (!rawOnImmediateSave) return;
    preserveScroll(() => rawOnImmediateSave());
  }, [rawOnImmediateSave]);
  
  const categoryEquipment = useMemo(
    () => equipment.filter((item) => item.equipment_category === category),
    [equipment, category]
  );

  const [itemToDelete, setItemToDelete] = useState<{ item: any; name: string } | null>(null);
  const [newItemId, setNewItemId] = useState<string | null>(null);

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
          // Place cursor at end to prevent select-all on iPad Safari
          if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
            const len = input.value.length;
            input.setSelectionRange(len, len);
          }
        }
      }
      setNewItemId(null);
    });
  }, [newItemId]);

  // Native drag state
  const draggedIdRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<'above' | 'below' | null>(null);

  // Refs mirroring state for synchronous access in handleTouchEnd
  const dragOverIdRef = useRef<string | null>(null);
  const dropPositionRef = useRef<'above' | 'below' | null>(null);

  const [isTouchMode, setIsTouchMode] = useState(false);

  // Touch-specific refs
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchActiveRef = useRef(false);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  // --- Auto-scroll engine ---
  const scrollRafRef = useRef<number | null>(null);
  const pointerYRef = useRef<number | null>(null);
  const edgeEnteredAtRef = useRef<number | null>(null);
  const globalDragHandlerRef = useRef<((e: DragEvent) => void) | null>(null);
  const EDGE_ZONE = 80;
  const MAX_SCROLL_SPEED = 25;

  const startAutoScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    edgeEnteredAtRef.current = null;
    const tick = () => {
      const y = pointerYRef.current;
      if (y !== null) {
        const vh = window.innerHeight;
        let speed = 0;
        let ratio = 0;
        let direction = 0;
        if (y < EDGE_ZONE) { ratio = (EDGE_ZONE - y) / EDGE_ZONE; direction = -1; }
        else if (y > vh - EDGE_ZONE) { ratio = (y - (vh - EDGE_ZONE)) / EDGE_ZONE; direction = 1; }
        if (direction !== 0) {
          const now = performance.now();
          if (edgeEnteredAtRef.current === null) edgeEnteredAtRef.current = now;
          const elapsed = now - edgeEnteredAtRef.current;
          const accel = Math.min(3, 1 + (elapsed / 500));
          const eased = Math.pow(ratio, 1.5);
          speed = direction * MAX_SCROLL_SPEED * eased * accel;
        } else {
          edgeEnteredAtRef.current = null;
        }
        if (speed !== 0) window.scrollBy({ top: speed, behavior: 'instant' as ScrollBehavior });
      } else {
        edgeEnteredAtRef.current = null;
      }
      scrollRafRef.current = requestAnimationFrame(tick);
    };
    scrollRafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (scrollRafRef.current !== null) { cancelAnimationFrame(scrollRafRef.current); scrollRafRef.current = null; }
    pointerYRef.current = null;
  }, []);

  const removeGlobalDragListener = useCallback(() => {
    if (globalDragHandlerRef.current) {
      document.removeEventListener('dragover', globalDragHandlerRef.current);
      globalDragHandlerRef.current = null;
    }
  }, []);

  const addGlobalDragListener = useCallback(() => {
    removeGlobalDragListener();
    const handler = (e: DragEvent) => {
      pointerYRef.current = e.clientY;
    };
    globalDragHandlerRef.current = handler;
    document.addEventListener('dragover', handler);
  }, [removeGlobalDragListener]);

  const clearDragState = useCallback(() => {
    draggedIdRef.current = null;
    dragOverIdRef.current = null;
    dropPositionRef.current = null;
    touchActiveRef.current = false;
    touchStartPosRef.current = null;
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    removeGlobalDragListener();
    stopAutoScroll();
    setDraggingId(null);
    setDragOverId(null);
    setDropPosition(null);
    setIsTouchMode(false);
  }, [stopAutoScroll, removeGlobalDragListener]);

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    draggedIdRef.current = id;
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    addGlobalDragListener();
    startAutoScroll();
  }, [startAutoScroll, addGlobalDragListener]);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id === draggedIdRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    setDragOverId(id);
    setDropPosition(e.clientY < midpoint ? 'above' : 'below');
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverId(null);
    setDropPosition(null);
  }, []);

  const performCategoryReorder = useCallback((targetId: string, pos: 'above' | 'below' | null) => {
    const dragId = draggedIdRef.current;
    if (!dragId || dragId === targetId || !pos) return;

    onUpdate(prev => {
      const catItems = prev.filter(eq => eq.equipment_category === category);
      const dragIdx = catItems.findIndex(eq => eq.id === dragId);
      if (dragIdx === -1) return prev;
      const [draggedItem] = catItems.splice(dragIdx, 1);
      const targetIdx = catItems.findIndex(eq => eq.id === targetId);
      const insertIdx = pos === 'below' ? targetIdx + 1 : targetIdx;
      catItems.splice(insertIdx, 0, draggedItem);

      const result: any[] = [];
      let catIdx = 0;
      for (const item of prev) {
        if (item.equipment_category === category) {
          result.push(catItems[catIdx++]);
        } else {
          result.push(item);
        }
      }
      return result;
    });
  }, [category, onUpdate]);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    performCategoryReorder(targetId, dropPosition);
    clearDragState();
  }, [dropPosition, performCategoryReorder, clearDragState]);

  const handleDragEnd = useCallback(() => {
    clearDragState();
  }, [clearDragState]);

  // --- Touch handlers ---

  const handleTouchStart = useCallback((e: React.TouchEvent, id: string) => {
    e.preventDefault();
    const touch = e.touches[0];
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
    longPressTimerRef.current = setTimeout(() => {
      draggedIdRef.current = id;
      touchActiveRef.current = true;
      setDraggingId(id);
      setIsTouchMode(true);
      startAutoScroll();
    }, 200);
  }, [startAutoScroll]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touchActiveRef.current && longPressTimerRef.current) {
      const start = touchStartPosRef.current;
      if (start && (Math.abs(touch.clientX - start.x) > 10 || Math.abs(touch.clientY - start.y) > 10)) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
        return;
      }
    }
    if (!touchActiveRef.current) return;
    e.preventDefault();
    pointerYRef.current = touch.clientY;
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const rowEl = el?.closest('[data-drag-id]') as HTMLElement | null;
    if (rowEl) {
      const tid = rowEl.getAttribute('data-drag-id')!;
      if (tid !== draggedIdRef.current) {
        const rect = rowEl.getBoundingClientRect();
        const pos = touch.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
        dragOverIdRef.current = tid;
        dropPositionRef.current = pos;
        setDragOverId(tid);
        setDropPosition(pos);
      }
    } else {
      dragOverIdRef.current = null;
      dropPositionRef.current = null;
      setDragOverId(null);
      setDropPosition(null);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
    if (touchActiveRef.current && dragOverIdRef.current && dropPositionRef.current) {
      performCategoryReorder(dragOverIdRef.current, dropPositionRef.current);
    }
    clearDragState();
  }, [performCategoryReorder, clearDragState]);

  const handleTouchCancel = useCallback(() => {
    clearDragState();
  }, [clearDragState]);

  const getDragProps = useCallback((id: string) => ({
    isDragging: draggingId === id,
    dropIndicator: dragOverId === id ? dropPosition : null,
    onRowDragStart: handleDragStart,
    onRowDragOver: handleDragOver,
    onRowDragLeave: handleDragLeave,
    onRowDrop: handleDrop,
    onRowDragEnd: handleDragEnd,
    onTouchDragStart: handleTouchStart,
    onTouchDragMove: handleTouchMove,
    onTouchDragEnd: handleTouchEnd,
    onTouchDragCancel: handleTouchCancel,
    isTouchDragging: isTouchMode && draggingId === id,
  }), [draggingId, dragOverId, dropPosition, isTouchMode, handleDragStart, handleDragOver, handleDragLeave, handleDrop, handleDragEnd, handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel]);

  const addEquipment = useCallback(() => {
    const id = `temp-${crypto.randomUUID()}`;
    setNewItemId(id);
    onUpdate(prev => {
      // Assign display_order lower than any existing row so new rows stay at the top
      // and have a STABLE, distinct value (prevents jumping when sort runs after autosave).
      const minOrder = prev.reduce(
        (m, p) => Math.min(m, typeof p.display_order === 'number' ? p.display_order : 0),
        0
      );
      return [
        {
          id,
          inspection_id: window.location.pathname.split('/').pop(),
          equipment_category: category,
          equipment_type: "",
          production_year: null,
          quantity: null,
          result: "",
          comments: "",
          is_divider: false,
          display_order: minOrder - 1,
        },
        ...prev,
      ];
    });
  }, [category, onUpdate]);

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
          equipment_category: category,
          equipment_type: "",
          result: "",
          is_divider: true,
          divider_text: "",
          display_order: minOrder - 1,
        },
        ...prev,
      ];
    });
  }, [category, onUpdate]);

  // Fields whose change is a "commit gesture" (dropdown selection / category
  // pick) — they have no blur event to trigger persistence, so we defer an
  // immediate save by one tick (after React flushes setState) so the parent's
  // performSave reads fresh state. Without this, picking a value and
  // navigating away within the 1.5s debounce window silently drops the change.
  const COMMIT_FIELDS = new Set(['result', 'equipment_category', 'equipment_type']);

  const updateEquipment = useCallback((item: any, field: string, value: any) => {
    onUpdate(prev => {
      const next = prev.map((eq) => eq.id === item.id ? { ...eq, [field]: value } : eq);
      if (isPhotoTraceEnabled()) {
        const before = prev.find(e => e.id === item.id);
        const after = next.find(e => e.id === item.id);
        // eslint-disable-next-line no-console
        console.debug('[photo-trace updater equipment]', {
          itemId: item.id,
          itemName: before?.equipment_type || before?.divider_text,
          field, value,
          beforePhoto: before?.photo_url ?? null,
          afterPhoto: after?.photo_url ?? null,
          identityChanged: before !== after,
          arrayLen: next.length,
        });
        try {
          (window as any).__photoTrace = (window as any).__photoTrace || [];
          (window as any).__photoTrace.push({ ts: Date.now(), event: 'updater.equipment', itemId: item.id, field, value, beforePhoto: before?.photo_url ?? null, afterPhoto: after?.photo_url ?? null });
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
      onUpdate(prev => prev.filter((eq) => eq.id !== itemToDelete.item.id));
      onImmediateSave?.();
      setItemToDelete(null);
    }
  }, [itemToDelete, onUpdate, onImmediateSave]);

  return (
    <Card>
      <CardHeader className="px-4 lg:px-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <CardTitle className="text-base lg:text-lg">
            EQUIPMENT - {displayName.toUpperCase()}
          </CardTitle>
          <div className="flex gap-2 w-full lg:w-auto">
            <Button onClick={addDivider} size="sm" variant="outline" className="flex-1 lg:flex-none shrink-0">
              <Minus className="w-4 h-4 mr-2" />
              Divider
            </Button>
            <Button onClick={addEquipment} size="sm" className="flex-1 lg:flex-none shrink-0">
              <Plus className="w-4 h-4 mr-2" />
              <span className="lg:hidden">Add</span>
              <span className="hidden lg:inline">Add {displayName}</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3 lg:px-6">
        {/* Desktop grid view */}
        <div className="hidden lg:block overflow-x-auto">
          {/* Header */}
          <div className={`grid ${EQ_GRID_COLS} bg-blue-50 dark:bg-blue-950/20 border-b border-border`}>
            <div className="p-3 text-center font-semibold text-sm border-r border-border"></div>
            <div className="p-3 text-center font-semibold text-sm border-r border-border">Photo</div>
            <div className="p-3 text-left font-semibold text-sm border-r border-border">Type</div>
            <div className="p-3 text-left font-semibold text-sm border-r border-border break-words">Manufacture Year(s)</div>
            <div className="p-3 text-left font-semibold text-sm border-r border-border">Quantity</div>
            <div className="p-3 text-left font-semibold text-sm border-r border-border">Result</div>
            <div className="p-3 text-left font-semibold text-sm border-r border-border break-words">Comments and/or Required Changes</div>
            <div className="p-3 text-center font-semibold text-sm"></div>
          </div>
          {/* Rows */}
          <div className="border border-t-0 border-border rounded-b">
            {categoryEquipment.map((item) => (
              <DraggableTableRow
                key={item.id}
                id={item.id}
                className="hover:bg-muted/50"
                gridCols={EQ_GRID_COLS}
                {...getDragProps(item.id)}
              >
                {item.is_divider ? (
                  <div className="col-span-7 flex items-center bg-blue-100 dark:bg-blue-900/30">
                    <div className="p-2 flex-1">
                      <DebouncedInput
                        value={item.divider_text || ""}
                        onChange={(value) => updateEquipment(item, "divider_text", value)}
                        onBlur={onImmediateSave}
                        placeholder="Enter divider text..."
                        className="border-0 bg-transparent text-center font-bold text-base"
                      />
                    </div>
                    <div className="p-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setItemToDelete({ item, name: item.divider_text || "this divider" })}
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
                    itemId={item.id}
                    inspectionId={effectiveInspectionId}
                    photoUrl={item.photo_url || null}
                    onPhotoChange={(url) => updateEquipment(item, "photo_url", url)}
                    onImmediateSave={onImmediateSave}
                    itemName={item.equipment_type || displayName}
                    photoSection="equipment"
                    onGalleryRefresh={onGalleryRefresh}
                  />
                </div>
                <div className="p-2 border-r border-border">
                  <EquipmentTypeCombobox
                    value={item.equipment_type || ""}
                    onChange={(value) => updateEquipment(item, "equipment_type", value)}
                    onBlur={onImmediateSave}
                    options={categoryOptions}
                    onAddOption={onAddCategoryOption || (() => {})}
                    placeholder="Enter or select type"
                    className={cn("border-0 bg-transparent", !item.equipment_type || item.equipment_type.trim() === "" ? "ring-2 ring-destructive" : "")}
                  />
                </div>
                <div className="p-2 border-r border-border">
                  <div className="flex flex-col gap-1">
                    {item.production_year === "0" ? (
                      <div className="flex items-center gap-1 px-2 py-1 bg-muted rounded text-sm">
                        <span className="text-muted-foreground font-medium">N/A</span>
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0 ml-auto" onClick={() => { updateEquipment(item, "production_year", null); onImmediateSave?.(); }}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <DebouncedInput
                          type="text"
                          inputMode="text"
                          value={item.production_year || ""}
                          validate={(raw) => {
                            if (raw === "") return "";
                            if (/^\d{0,4}(-\d{0,4})?$/.test(raw)) return raw;
                            return null;
                          }}
                          onChange={(value) => updateEquipment(item, "production_year", value === "" ? null : value)}
                          onBlur={() => {
                            const val = item.production_year;
                            if (val && !/^(0|\d{4}(-\d{4})?)$/.test(val)) { updateEquipment(item, "production_year", null); }
                            onImmediateSave?.();
                          }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onImmediateSave?.(); focusNextCell(e.currentTarget as HTMLElement); } }}
                          placeholder="e.g. 2018-2026"
                          className="border-0 bg-transparent w-full"
                        />
                        <Button variant="outline" size="sm" className="h-7 w-full text-xs" onClick={() => { updateEquipment(item, "production_year", "0"); onImmediateSave?.(); }}>N/A</Button>
                      </>
                    )}
                  </div>
                </div>
                <div className="p-2 border-r border-border">
                  <DebouncedInput
                    type="text"
                    inputMode="numeric"
                    value={item.quantity || ""}
                    validate={(raw) => {
                      if (raw === "") return "";
                      if (/^\d+\+?$/.test(raw)) return raw;
                      return null;
                    }}
                    onChange={(value) => updateEquipment(item, "quantity", value === "" ? null : value)}
                    onBlur={onImmediateSave}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onImmediateSave?.(); focusNextCell(e.currentTarget as HTMLElement); } }}
                    placeholder="Qty"
                    className="border-0 bg-transparent"
                  />
                </div>
                <div className="p-2 border-r border-border">
                  <ResultSelect value={item.result} onChange={(value) => updateEquipment(item, "result", value)} />
                </div>
                <div className="p-2 border-r border-border min-w-0 overflow-hidden">
                  <LazyRichTextEditor
                    content={item.comments || ""}
                    onChange={(value) => updateEquipment(item, "comments", value)}
                    onBlur={onImmediateSave}
                    placeholder="Enter comments..."
                    className="border-0 bg-transparent"
                  />
                </div>
                <div className="p-2 text-center">
                  <Button variant="ghost" size="sm" onClick={() => setItemToDelete({ item, name: item.equipment_type || "this equipment" })} className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10">
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
          {categoryEquipment.map((item) => (
            <DraggableMobileCard key={item.id} id={item.id} {...getDragProps(item.id)}>
              {item.is_divider ? (
                <div className="p-4 pl-12 relative rounded-lg bg-blue-100 dark:bg-blue-900/30 border border-border flex items-center">
                  <DebouncedInput
                    value={item.divider_text || ""}
                    onChange={(value) => updateEquipment(item, "divider_text", value)}
                    onBlur={onImmediateSave}
                    placeholder="Enter divider text..."
                    className="border-0 bg-transparent text-center font-bold text-base flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setItemToDelete({ item, name: item.divider_text || "this divider" })}
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
                  onClick={() => setItemToDelete({ item, name: item.equipment_type || "this equipment" })}
                  className="absolute top-3 right-3 h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                <div className="space-y-3 pr-10">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <ItemPhotoUpload
                        itemId={item.id}
                        inspectionId={effectiveInspectionId}
                        photoUrl={item.photo_url || null}
                        onPhotoChange={(url) => updateEquipment(item, "photo_url", url)}
                        onImmediateSave={onImmediateSave}
                        itemName={item.equipment_type || displayName}
                        photoSection="equipment"
                        onGalleryRefresh={onGalleryRefresh}
                      />
                      <div className="flex-1 min-w-0">
                        <Label className="text-xs text-muted-foreground">Type *</Label>
                        <EquipmentTypeCombobox
                          value={item.equipment_type || ""}
                          onChange={(value) => updateEquipment(item, "equipment_type", value)}
                          onBlur={onImmediateSave}
                          options={categoryOptions}
                          onAddOption={onAddCategoryOption || (() => {})}
                          placeholder="Enter or select type"
                          className={cn(!item.equipment_type || item.equipment_type.trim() === "" ? "ring-2 ring-destructive" : "")}
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs text-muted-foreground">Manufacture Year(s)</Label>
                      <div className="flex flex-col gap-1">
                        {item.production_year === "0" ? (
                          <div className="flex items-center gap-1 px-2 py-1 bg-muted rounded text-sm h-10">
                            <span className="text-muted-foreground font-medium">N/A</span>
                            <Button variant="ghost" size="sm" className="h-5 w-5 p-0 ml-auto" onClick={() => { updateEquipment(item, "production_year", null); onImmediateSave?.(); }}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <DebouncedInput
                              type="text" inputMode="text" value={item.production_year || ""}
                              validate={(raw) => { if (raw === "") return ""; if (/^\d{0,4}(-\d{0,4})?$/.test(raw)) return raw; return null; }}
                              onChange={(value) => updateEquipment(item, "production_year", value === "" ? null : value)}
                              onBlur={() => { const val = item.production_year; if (val && !/^(0|\d{4}(-\d{4})?)$/.test(val)) { updateEquipment(item, "production_year", null); } onImmediateSave?.(); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onImmediateSave?.(); focusNextCell(e.currentTarget as HTMLElement); } }}
                              placeholder="e.g. 2018-2026" className="w-full"
                            />
                            <Button variant="outline" size="sm" className="h-8 w-full text-xs" onClick={() => { updateEquipment(item, "production_year", "0"); onImmediateSave?.(); }}>N/A</Button>
                          </>
                        )}
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Quantity</Label>
                      <DebouncedInput
                        type="text" inputMode="numeric" value={item.quantity || ""}
                        validate={(raw) => { if (raw === "") return ""; if (/^\d+\+?$/.test(raw)) return raw; return null; }}
                        onChange={(value) => updateEquipment(item, "quantity", value === "" ? null : value)}
                        onBlur={onImmediateSave} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onImmediateSave?.(); focusNextCell(e.currentTarget as HTMLElement); } }} placeholder="Qty"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <Label className="text-xs text-muted-foreground">Result</Label>
                    <ResultSelect value={item.result} onChange={(value) => updateEquipment(item, "result", value)} />
                  </div>
                  
                  <div>
                    <Label className="text-xs text-muted-foreground">Comments / Changes</Label>
                    <LazyRichTextEditor content={item.comments || ""} onChange={(value) => updateEquipment(item, "comments", value)} onBlur={onImmediateSave} placeholder="Enter comments..." />
                  </div>
                </div>
              </div>
              )}
            </DraggableMobileCard>
          ))}
        </div>
      </CardContent>

      {itemToDelete && (
        <AlertDialog open={true} onOpenChange={(open) => !open && setItemToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Equipment</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete <strong>{itemToDelete.name}</strong>?
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Card>
  );
}

export default memo(EquipmentTable);
