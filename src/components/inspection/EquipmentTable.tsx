import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LazyRichTextEditor } from "@/components/ui/lazy-rich-text-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import ResultSelect from "@/components/ResultSelect";
import HistoryAutocomplete from "@/components/HistoryAutocomplete";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatedTableRow, AnimatedListItem } from "@/components/ui/list-item-animation";
import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
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

interface EquipmentTableProps {
  category: string;
  displayName: string;
  equipment: any[];
  onUpdate: (equipment: any[]) => void;
  onImmediateSave?: () => void;
}

/**
 * PERFORMANCE OPTIMIZATIONS (v2.2.10):
 * 1. LazyRichTextEditor - TipTap only mounts when focused (saves ~1200ms)
 * 2. useMemo for categoryEquipment filter (prevents recalculation on unrelated renders)
 * 3. useCallback for updateEquipment (stable reference for child components)
 * 4. isMobile prop passed to animation components (single hook call vs 25)
 * 5. Conditional AlertDialog rendering (only mounts when needed)
 * 6. React.memo on expensive sub-components
 */

function EquipmentTable({ category, displayName, equipment, onUpdate, onImmediateSave }: EquipmentTableProps) {
  // PERFORMANCE: Single hook call, passed to all animation children
  const isMobile = useIsMobile();
  
  // PERFORMANCE: Memoize filter to prevent recalculation on every render
  const categoryEquipment = useMemo(
    () => equipment.filter((item) => item.equipment_category === category),
    [equipment, category]
  );
  
  const [newItemIds, setNewItemIds] = useState<Set<string>>(new Set());
  const prevEquipmentLengthRef = useRef(categoryEquipment.length);
  const [itemToDelete, setItemToDelete] = useState<{ item: any; name: string } | null>(null);

  // Track newly added items for animation
  useEffect(() => {
    if (categoryEquipment.length > prevEquipmentLengthRef.current) {
      const latestItem = categoryEquipment[0];
      if (latestItem?.id) {
        setNewItemIds(prev => new Set(prev).add(latestItem.id));
        // Clear the "new" status after animation completes
        setTimeout(() => {
          setNewItemIds(prev => {
            const next = new Set(prev);
            next.delete(latestItem.id);
            return next;
          });
        }, 1500);
      }
    }
    prevEquipmentLengthRef.current = categoryEquipment.length;
  }, [categoryEquipment.length]);

  const addEquipment = useCallback(() => {
    onUpdate([
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
      ...equipment,
    ]);
  }, [equipment, category, onUpdate]);

  // PERFORMANCE: Stable callback reference
  const updateEquipment = useCallback((item: any, field: string, value: any) => {
    const updated = equipment.map((eq) =>
      eq === item ? { ...eq, [field]: value } : eq
    );
    onUpdate(updated);
  }, [equipment, onUpdate]);

  const handleDeleteConfirm = useCallback(() => {
    if (itemToDelete) {
      const updated = equipment.filter((eq) => eq !== itemToDelete.item);
      onUpdate(updated);
      onImmediateSave?.();
      setItemToDelete(null);
    }
  }, [itemToDelete, equipment, onUpdate, onImmediateSave]);

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
        {/* Desktop table view */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-blue-50 dark:bg-blue-950/20">
                <th className="border p-3 text-left font-semibold text-sm">Type</th>
                <th className="border p-3 text-left font-semibold text-sm w-32">Production Year</th>
                <th className="border p-3 text-left font-semibold text-sm w-24">Quantity</th>
                <th className="border p-3 text-left font-semibold text-sm w-48">Result</th>
                <th className="border p-3 text-left font-semibold text-sm">Comments and/or Required Changes</th>
                <th className="border p-3 text-center font-semibold text-sm w-16"></th>
              </tr>
            </thead>
            <tbody>
              {categoryEquipment.map((item, index) => (
                <AnimatedTableRow 
                  key={item.id || index} 
                  itemKey={item.id || `equipment-${index}`}
                  isNew={newItemIds.has(item.id)}
                  isMobile={isMobile}
                  className="hover:bg-muted/50"
                >
                  <td className="border p-2">
                    <HistoryAutocomplete
                      value={item.equipment_type}
                      onChange={(value) => updateEquipment(item, "equipment_type", value)}
                      onBlur={onImmediateSave}
                      storageKey="rope-works-equipment-types"
                      syncToDatabase={true}
                      fieldType="equipment_type"
                      placeholder="Enter or select type"
                      className={cn(
                        "border-0 bg-transparent",
                        !item.equipment_type || item.equipment_type.trim() === ""
                          ? "ring-2 ring-destructive"
                          : ""
                      )}
                    />
                  </td>
                  <td className="border p-2">
                    <Input
                      type="number"
                      value={item.production_year || ""}
                      onChange={(e) => updateEquipment(item, "production_year", parseInt(e.target.value) || null)}
                      onBlur={onImmediateSave}
                      onKeyDown={(e) => e.key === 'Enter' && onImmediateSave?.()}
                      placeholder="Year"
                      className="border-0 bg-transparent"
                    />
                  </td>
                  <td className="border p-2">
                    <Input
                      type="number"
                      value={item.quantity || ""}
                      onChange={(e) => updateEquipment(item, "quantity", parseInt(e.target.value) || null)}
                      onBlur={onImmediateSave}
                      onKeyDown={(e) => e.key === 'Enter' && onImmediateSave?.()}
                      placeholder="Qty"
                      className="border-0 bg-transparent"
                    />
                  </td>
                  <td className="border p-2">
                    <ResultSelect
                      value={item.result}
                      onChange={(value) => updateEquipment(item, "result", value)}
                      includeNA
                    />
                  </td>
                  <td className="border p-2">
                    <LazyRichTextEditor
                      content={item.comments || ""}
                      onChange={(value) => updateEquipment(item, "comments", value)}
                      placeholder="Enter comments..."
                      className="border-0 bg-transparent"
                    />
                  </td>
                  <td className="border p-2 text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setItemToDelete({ item, name: item.equipment_type || "this equipment" })}
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </AnimatedTableRow>
              ))}
            </tbody>
          </table>
        </div>
        
        {/* Mobile card view */}
        <div className="md:hidden space-y-3">
          {categoryEquipment.map((item, index) => (
            <AnimatedListItem 
              key={item.id || index}
              itemKey={item.id || `mobile-equipment-${index}`}
              isNew={newItemIds.has(item.id)}
              isMobile={isMobile}
            >
              <div className="p-4 relative border-l-4 border-l-primary/20 rounded-lg bg-muted/30 border border-border">
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
                    <HistoryAutocomplete
                      value={item.equipment_type}
                      onChange={(value) => updateEquipment(item, "equipment_type", value)}
                      onBlur={onImmediateSave}
                      storageKey="rope-works-equipment-types"
                      syncToDatabase={true}
                      fieldType="equipment_type"
                      placeholder="Enter or select type"
                      className={cn(
                        !item.equipment_type || item.equipment_type.trim() === ""
                          ? "ring-2 ring-destructive"
                          : ""
                      )}
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs text-muted-foreground">Production Year</Label>
                      <Input
                        type="number"
                        value={item.production_year || ""}
                        onChange={(e) => updateEquipment(item, "production_year", parseInt(e.target.value) || null)}
                        onBlur={onImmediateSave}
                        onKeyDown={(e) => e.key === 'Enter' && onImmediateSave?.()}
                        placeholder="Year"
                      />
                    </div>
                    
                    <div>
                      <Label className="text-xs text-muted-foreground">Quantity</Label>
                      <Input
                        type="number"
                        value={item.quantity || ""}
                        onChange={(e) => updateEquipment(item, "quantity", parseInt(e.target.value) || null)}
                        onBlur={onImmediateSave}
                        onKeyDown={(e) => e.key === 'Enter' && onImmediateSave?.()}
                        placeholder="Qty"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <Label className="text-xs text-muted-foreground">Result</Label>
                    <ResultSelect
                      value={item.result}
                      onChange={(value) => updateEquipment(item, "result", value)}
                      includeNA
                    />
                  </div>
                  
                  <div>
                    <Label className="text-xs text-muted-foreground">Comments / Changes</Label>
                    <LazyRichTextEditor
                      content={item.comments || ""}
                      onChange={(value) => updateEquipment(item, "comments", value)}
                      placeholder="Enter comments..."
                    />
                  </div>
                </div>
              </div>
            </AnimatedListItem>
          ))}
        </div>
      </CardContent>

      {/* PERFORMANCE: Only render AlertDialog when needed */}
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
              <AlertDialogAction
                onClick={handleDeleteConfirm}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Card>
  );
}

// PERFORMANCE: Memoize component to prevent re-renders from parent state changes
export default memo(EquipmentTable);
