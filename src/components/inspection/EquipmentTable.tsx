import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LazyRichTextEditor } from "@/components/ui/lazy-rich-text-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import ResultSelect from "@/components/ResultSelect";
import { GlobalAutocomplete } from "@/components/GlobalAutocomplete";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, X, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useMemo, useCallback, memo } from "react";
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
import {
  DndContext,
  closestCenter,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { DraggableTableRow, DraggableMobileCard } from "./DraggableTableRow";

interface EquipmentTableProps {
  category: string;
  displayName: string;
  equipment: any[];
  onUpdate: (equipmentOrUpdater: any[] | ((prev: any[]) => any[])) => void;
  onImmediateSave?: () => void;
  typeOptions?: string[];
}

const EQ_GRID_COLS = "grid-cols-[40px_minmax(160px,1fr)_128px_96px_192px_1fr_64px]";

function EquipmentTable({ category, displayName, equipment, onUpdate, onImmediateSave, typeOptions }: EquipmentTableProps) {
  const isMobile = useIsMobile();
  
  const categoryEquipment = useMemo(
    () => equipment.filter((item) => item.equipment_category === category),
    [equipment, category]
  );

  const categoryIds = useMemo(() => categoryEquipment.map(e => e.id), [categoryEquipment]);
  
  const [itemToDelete, setItemToDelete] = useState<{ item: any; name: string } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const collisionDetection: CollisionDetection = useCallback((args) => {
    const filtered = args.droppableContainers.filter(c => c.id !== args.active.id);
    return closestCenter({ ...args, droppableContainers: filtered });
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 8 } })
  );

  const addEquipment = useCallback(() => {
    onUpdate(prev => [
      {
        id: `temp-${crypto.randomUUID()}`,
        inspection_id: window.location.pathname.split('/').pop(),
        equipment_category: category,
        equipment_type: "",
        production_year: null,
        quantity: null,
        result: "pass",
        comments: "",
      },
      ...prev,
    ]);
  }, [category, onUpdate]);

  const updateEquipment = useCallback((item: any, field: string, value: any) => {
    onUpdate(prev => prev.map((eq) =>
      eq.id === item.id ? { ...eq, [field]: value } : eq
    ));
  }, [onUpdate]);

  const handleDeleteConfirm = useCallback(() => {
    if (itemToDelete) {
      onUpdate(prev => prev.filter((eq) => eq.id !== itemToDelete.item.id));
      onImmediateSave?.();
      setItemToDelete(null);
    }
  }, [itemToDelete, onUpdate, onImmediateSave]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null);
    setOverId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    onUpdate(prev => {
      const catItems = prev.filter(e => e.equipment_category === category);
      const otherItems = prev.filter(e => e.equipment_category !== category);
      const oldIndex = catItems.findIndex(e => e.id === active.id);
      const newIndex = catItems.findIndex(e => e.id === over.id);
      const reorderedCat = arrayMove(catItems, oldIndex, newIndex);
      
      const result: any[] = [];
      let catIdx = 0;
      for (const item of prev) {
        if (item.equipment_category === category) {
          result.push(reorderedCat[catIdx++]);
        } else {
          result.push(item);
        }
      }
      return result;
    });
  }, [onUpdate, category]);

  const activeEquipment = useMemo(() => activeId ? categoryEquipment.find(e => e.id === activeId) : null, [activeId, categoryEquipment]);

  return (
    <Card>
      <CardHeader className="px-4 md:px-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <CardTitle className="text-base md:text-lg">
            EQUIPMENT - {displayName.toUpperCase()}
          </CardTitle>
          <Button onClick={addEquipment} size="sm" className="w-full md:w-auto shrink-0">
            <Plus className="w-4 h-4 mr-2" />
            <span className="md:hidden">Add</span>
            <span className="hidden md:inline">Add {displayName}</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-3 md:px-6">
        <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragOver={(e) => setOverId(e.over?.id as string | null)} onDragCancel={() => { setActiveId(null); setOverId(null); }}>
          <SortableContext items={categoryIds} strategy={verticalListSortingStrategy}>
            {/* Desktop grid view */}
            <div className="hidden md:block overflow-visible">
              {/* Header */}
              <div className={`grid ${EQ_GRID_COLS} bg-blue-50 dark:bg-blue-950/20 border-b border-border`}>
                <div className="p-3 text-center font-semibold text-sm border-r border-border"></div>
                <div className="p-3 text-left font-semibold text-sm border-r border-border">Type</div>
                <div className="p-3 text-left font-semibold text-sm border-r border-border">Production Year</div>
                <div className="p-3 text-left font-semibold text-sm border-r border-border">Quantity</div>
                <div className="p-3 text-left font-semibold text-sm border-r border-border">Result</div>
                <div className="p-3 text-left font-semibold text-sm border-r border-border">Comments and/or Required Changes</div>
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
                    isDropTarget={overId === item.id && activeId !== item.id}
                  >
                    <div className="p-2 border-r border-border">
                      {typeOptions ? (
                        (() => {
                          const currentVal = item.equipment_type || "";
                          return currentVal.trim() !== "" ? (
                            <div className="flex items-center gap-1">
                              <Input
                                value={currentVal}
                                onChange={(e) => updateEquipment(item, "equipment_type", e.target.value)}
                                onBlur={onImmediateSave}
                                onKeyDown={(e) => e.key === 'Enter' && onImmediateSave?.()}
                                placeholder="Edit type..."
                                className="border-0 bg-transparent flex-1"
                              />
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => { updateEquipment(item, "equipment_type", ""); onImmediateSave?.(); }} title="Re-select type">
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <Select onValueChange={(v) => { updateEquipment(item, "equipment_type", v); onImmediateSave?.(); }}>
                              <SelectTrigger className={cn("border-0 bg-transparent", "ring-2 ring-destructive")}><SelectValue placeholder="Select type" /></SelectTrigger>
                              <SelectContent>
                                {typeOptions.map((opt) => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}
                              </SelectContent>
                            </Select>
                          );
                        })()
                      ) : (
                        <GlobalAutocomplete
                          value={item.equipment_type}
                          onChange={(value) => updateEquipment(item, "equipment_type", value)}
                          onBlur={onImmediateSave}
                          fieldType="equipment_type"
                          placeholder="Enter or select type"
                          className={cn("border-0 bg-transparent", !item.equipment_type || item.equipment_type.trim() === "" ? "ring-2 ring-destructive" : "")}
                        />
                      )}
                    </div>
                    <div className="p-2 border-r border-border">
                      <div className="flex items-center gap-1">
                        {item.production_year === "0" ? (
                          <div className="flex items-center gap-1 px-2 py-1 bg-muted rounded text-sm flex-1">
                            <span className="text-muted-foreground font-medium">N/A</span>
                            <Button variant="ghost" size="sm" className="h-5 w-5 p-0 ml-auto" onClick={() => { updateEquipment(item, "production_year", null); onImmediateSave?.(); }}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <Input
                              type="text"
                              inputMode="text"
                              value={item.production_year || ""}
                              onChange={(e) => {
                                const raw = e.target.value;
                                if (raw === "") { updateEquipment(item, "production_year", null); return; }
                                if (/^\d{0,4}(-\d{0,4})?$/.test(raw)) { updateEquipment(item, "production_year", raw); }
                              }}
                              onBlur={() => {
                                const val = item.production_year;
                                if (val && !/^(0|\d{4}(-\d{4})?)$/.test(val)) { updateEquipment(item, "production_year", null); }
                                onImmediateSave?.();
                              }}
                              onKeyDown={(e) => e.key === 'Enter' && onImmediateSave?.()}
                              placeholder="Year"
                              className="border-0 bg-transparent flex-1"
                            />
                            <Button variant="outline" size="sm" className="h-7 px-2 text-xs shrink-0" onClick={() => { updateEquipment(item, "production_year", "0"); onImmediateSave?.(); }}>N/A</Button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="p-2 border-r border-border">
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={item.quantity || ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === "") { updateEquipment(item, "quantity", null); return; }
                          if (/^\d+\+?$/.test(raw)) { updateEquipment(item, "quantity", raw); }
                        }}
                        onBlur={onImmediateSave}
                        onKeyDown={(e) => e.key === 'Enter' && onImmediateSave?.()}
                        placeholder="Qty"
                        className="border-0 bg-transparent"
                      />
                    </div>
                    <div className="p-2 border-r border-border">
                      <ResultSelect value={item.result} onChange={(value) => updateEquipment(item, "result", value)} />
                    </div>
                    <div className="p-2 border-r border-border">
                      <LazyRichTextEditor
                        content={item.comments || ""}
                        onChange={(value) => updateEquipment(item, "comments", value)}
                        placeholder="Enter comments..."
                        className="border-0 bg-transparent"
                      />
                    </div>
                    <div className="p-2 text-center">
                      <Button variant="ghost" size="sm" onClick={() => setItemToDelete({ item, name: item.equipment_type || "this equipment" })} className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </DraggableTableRow>
                ))}
              </div>
            </div>
            
            {/* Mobile card view */}
            <div className="md:hidden space-y-3">
              {categoryEquipment.map((item) => (
                <DraggableMobileCard key={item.id} id={item.id} isDropTarget={overId === item.id && activeId !== item.id}>
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
                       <div>
                        <Label className="text-xs text-muted-foreground">Type *</Label>
                        {typeOptions ? (
                          (() => {
                            const currentVal = item.equipment_type || "";
                            return currentVal.trim() !== "" ? (
                              <div className="flex items-center gap-1">
                                <Input value={currentVal} onChange={(e) => updateEquipment(item, "equipment_type", e.target.value)} onBlur={onImmediateSave} onKeyDown={(e) => e.key === 'Enter' && onImmediateSave?.()} placeholder="Edit type..." />
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => { updateEquipment(item, "equipment_type", ""); onImmediateSave?.(); }} title="Re-select type">
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <Select onValueChange={(v) => { updateEquipment(item, "equipment_type", v); onImmediateSave?.(); }}>
                                <SelectTrigger className="ring-2 ring-destructive"><SelectValue placeholder="Select type" /></SelectTrigger>
                                <SelectContent>
                                  {typeOptions.map((opt) => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}
                                </SelectContent>
                              </Select>
                            );
                          })()
                        ) : (
                          <GlobalAutocomplete
                            value={item.equipment_type}
                            onChange={(value) => updateEquipment(item, "equipment_type", value)}
                            onBlur={onImmediateSave}
                            fieldType="equipment_type"
                            placeholder="Enter or select type"
                            className={cn(!item.equipment_type || item.equipment_type.trim() === "" ? "ring-2 ring-destructive" : "")}
                          />
                        )}
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label className="text-xs text-muted-foreground">Production Year</Label>
                          <div className="flex items-center gap-1">
                            {item.production_year === "0" ? (
                              <div className="flex items-center gap-1 px-2 py-1 bg-muted rounded text-sm flex-1 h-10">
                                <span className="text-muted-foreground font-medium">N/A</span>
                                <Button variant="ghost" size="sm" className="h-5 w-5 p-0 ml-auto" onClick={() => { updateEquipment(item, "production_year", null); onImmediateSave?.(); }}>
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <>
                                <Input
                                  type="text" inputMode="text" value={item.production_year || ""}
                                  onChange={(e) => { const raw = e.target.value; if (raw === "") { updateEquipment(item, "production_year", null); return; } if (/^\d{0,4}(-\d{0,4})?$/.test(raw)) { updateEquipment(item, "production_year", raw); } }}
                                  onBlur={() => { const val = item.production_year; if (val && !/^(0|\d{4}(-\d{4})?)$/.test(val)) { updateEquipment(item, "production_year", null); } onImmediateSave?.(); }}
                                  onKeyDown={(e) => e.key === 'Enter' && onImmediateSave?.()}
                                  placeholder="Year" className="flex-1"
                                />
                                <Button variant="outline" size="sm" className="h-10 px-2 text-xs shrink-0" onClick={() => { updateEquipment(item, "production_year", "0"); onImmediateSave?.(); }}>N/A</Button>
                              </>
                            )}
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Quantity</Label>
                          <Input
                            type="text" inputMode="numeric" value={item.quantity || ""}
                            onChange={(e) => { const raw = e.target.value; if (raw === "") { updateEquipment(item, "quantity", null); return; } if (/^\d+\+?$/.test(raw)) { updateEquipment(item, "quantity", raw); } }}
                            onBlur={onImmediateSave} onKeyDown={(e) => e.key === 'Enter' && onImmediateSave?.()} placeholder="Qty"
                          />
                        </div>
                      </div>
                      
                      <div>
                        <Label className="text-xs text-muted-foreground">Result</Label>
                        <ResultSelect value={item.result} onChange={(value) => updateEquipment(item, "result", value)} />
                      </div>
                      
                      <div>
                        <Label className="text-xs text-muted-foreground">Comments / Changes</Label>
                        <LazyRichTextEditor content={item.comments || ""} onChange={(value) => updateEquipment(item, "comments", value)} placeholder="Enter comments..." />
                      </div>
                    </div>
                  </div>
                </DraggableMobileCard>
              ))}
            </div>
          </SortableContext>
          <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' }}>
            {activeEquipment ? (
              <div className="flex items-center gap-3 px-4 py-3 w-full min-w-[400px] rounded-lg border-l-4 border-l-primary bg-background shadow-2xl ring-2 ring-primary/30 scale-[1.02]">
                <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="font-medium text-sm truncate flex-1">{activeEquipment.equipment_type || 'Equipment'}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{activeEquipment.result}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
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
