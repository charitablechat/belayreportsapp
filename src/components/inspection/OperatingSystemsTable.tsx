import { Button } from "@/components/ui/button";
import { VoiceRichTextEditor } from "@/components/ui/voice-rich-text-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import ResultSelect from "@/components/ResultSelect";
import SystemTypeSelect from "@/components/SystemTypeSelect";
import { GlobalAutocomplete } from "@/components/GlobalAutocomplete";
import { Plus, Trash2 } from "lucide-react";
import { useState, useCallback, memo, useMemo } from "react";
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
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { DraggableTableRow, DraggableMobileCard } from "./DraggableTableRow";

interface OperatingSystemsTableProps {
  systems: any[];
  onUpdate: (systemsOrUpdater: any[] | ((prev: any[]) => any[])) => void;
  onImmediateSave?: () => void;
}

function OperatingSystemsTable({ systems, onUpdate, onImmediateSave }: OperatingSystemsTableProps) {
  const [itemToDelete, setItemToDelete] = useState<{ id: string; name: string } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 8 } })
  );

  const systemIds = useMemo(() => systems.map(s => s.id), [systems]);

  const addSystem = useCallback(() => {
    onUpdate(prev => [
      { 
        id: `temp-${crypto.randomUUID()}`,
        inspection_id: window.location.pathname.split('/').pop(),
        system_name: "", 
        result: "pass", 
        comments: "" 
      },
      ...prev
    ]);
  }, [onUpdate]);

  const updateSystem = useCallback((item: any, field: string, value: any) => {
    onUpdate(prev => prev.map(s =>
      s.id === item.id ? { ...s, [field]: value } : s
    ));
  }, [onUpdate]);

  const handleDeleteConfirm = useCallback(() => {
    if (itemToDelete) {
      onUpdate(prev => prev.filter(s => s.id !== itemToDelete.id));
      onImmediateSave?.();
      setItemToDelete(null);
    }
  }, [itemToDelete, onUpdate, onImmediateSave]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onUpdate(prev => {
      const oldIndex = prev.findIndex(s => s.id === active.id);
      const newIndex = prev.findIndex(s => s.id === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, [onUpdate]);

  return (
    <Card>
      <CardHeader className="px-4 md:px-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <CardTitle>Operating Systems</CardTitle>
          <Button onClick={addSystem} size="sm" className="w-full md:w-auto shrink-0">
            <Plus className="w-4 h-4 mr-2" />
            Add System
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-3 md:px-6">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={systemIds} strategy={verticalListSortingStrategy}>
            {/* Desktop table view */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-blue-50 dark:bg-blue-950/20">
                    <th className="border p-3 text-center font-semibold text-sm w-10"></th>
                    <th className="border p-3 text-left font-semibold text-sm min-w-[180px]">Element Name</th>
                    <th className="border p-3 text-left font-semibold text-sm min-w-[160px]">Operating System</th>
                    <th className="border p-3 text-left font-semibold text-sm w-48">Result</th>
                    <th className="border p-3 text-left font-semibold text-sm">Comments and/or Required Changes</th>
                    <th className="border p-3 text-center font-semibold text-sm w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {systems.map((system) => (
                    <DraggableTableRow
                      key={system.id}
                      id={system.id}
                      className="hover:bg-muted/50"
                    >
                      <td className="border p-2">
                        <GlobalAutocomplete
                          value={system.name || ""}
                          onChange={(value) => updateSystem(system, "name", value)}
                          onBlur={onImmediateSave}
                          fieldType="operating_system_element"
                          placeholder="Enter or select name"
                          className="border-0 bg-transparent"
                        />
                      </td>
                      <td className="border p-2">
                        <SystemTypeSelect
                          value={system.system_name}
                          onChange={(value) => updateSystem(system, "system_name", value)}
                        />
                      </td>
                      <td className="border p-2">
                        <ResultSelect
                          value={system.result}
                          onChange={(value) => updateSystem(system, "result", value)}
                        />
                      </td>
                      <td className="border p-2">
                        <VoiceRichTextEditor
                          content={system.comments || ""}
                          onChange={(value) => updateSystem(system, "comments", value)}
                          placeholder="Enter comments..."
                          className="border-0 bg-transparent"
                        />
                      </td>
                      <td className="border p-2 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setItemToDelete({ id: system.id, name: system.name || system.system_name || "this system" })}
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </DraggableTableRow>
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* Mobile card view */}
            <div className="md:hidden space-y-3">
              {systems.map((system) => (
                <DraggableMobileCard key={system.id} id={system.id}>
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
                      <div>
                        <Label className="text-xs text-muted-foreground">Element Name</Label>
                        <GlobalAutocomplete
                          value={system.name || ""}
                          onChange={(value) => updateSystem(system, "name", value)}
                          onBlur={onImmediateSave}
                          fieldType="operating_system_element"
                          placeholder="Enter or select name"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Operating System</Label>
                        <SystemTypeSelect
                          value={system.system_name}
                          onChange={(value) => updateSystem(system, "system_name", value)}
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
                          placeholder="Enter comments..."
                        />
                      </div>
                    </div>
                  </div>
                </DraggableMobileCard>
              ))}
            </div>
          </SortableContext>
        </DndContext>
        
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
