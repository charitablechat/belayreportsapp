import { Button } from "@/components/ui/button";
import { VoiceRichTextEditor } from "@/components/ui/voice-rich-text-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import ResultSelect from "@/components/ResultSelect";
import SystemTypeSelect from "@/components/SystemTypeSelect";
import HistoryAutocomplete from "@/components/HistoryAutocomplete";
import { Plus, Trash2 } from "lucide-react";
import { AnimatedTableRow, AnimatedListItem } from "@/components/ui/list-item-animation";
import { useState, useEffect, useRef } from "react";
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

interface OperatingSystemsTableProps {
  systems: any[];
  onUpdate: (systems: any[]) => void;
  onImmediateSave?: () => void;
}

export default function OperatingSystemsTable({ systems, onUpdate, onImmediateSave }: OperatingSystemsTableProps) {
  const [newItemIds, setNewItemIds] = useState<Set<string>>(new Set());
  const prevSystemsLengthRef = useRef(systems.length);
  const [itemToDelete, setItemToDelete] = useState<{ index: number; name: string } | null>(null);

  // Track newly added items for animation
  useEffect(() => {
    if (systems.length > prevSystemsLengthRef.current) {
      const latestSystem = systems[0];
      if (latestSystem?.id) {
        setNewItemIds(prev => new Set(prev).add(latestSystem.id));
        // Clear the "new" status after animation completes
        setTimeout(() => {
          setNewItemIds(prev => {
            const next = new Set(prev);
            next.delete(latestSystem.id);
            return next;
          });
        }, 1500);
      }
    }
    prevSystemsLengthRef.current = systems.length;
  }, [systems.length]);

  const addSystem = () => {
    onUpdate([
      { 
        id: `temp-${crypto.randomUUID()}`,
        inspection_id: window.location.pathname.split('/').pop(),
        system_name: "", 
        result: "pass", 
        comments: "" 
      },
      ...systems
    ]);
  };

  const updateSystem = (index: number, field: string, value: any) => {
    const updated = [...systems];
    updated[index] = { ...updated[index], [field]: value };
    onUpdate(updated);
  };

  const handleDeleteConfirm = () => {
    if (itemToDelete) {
      const updated = systems.filter((_, i) => i !== itemToDelete.index);
      onUpdate(updated);
      onImmediateSave?.();
      setItemToDelete(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Operating Systems</CardTitle>
          <Button onClick={addSystem} size="sm">
            <Plus className="w-4 h-4 mr-2" />
            Add System
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Desktop table view */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-blue-50 dark:bg-blue-950/20">
                <th className="border p-3 text-left font-semibold text-sm">Element Name</th>
                <th className="border p-3 text-left font-semibold text-sm">Operating System</th>
                <th className="border p-3 text-left font-semibold text-sm w-48">Result</th>
                <th className="border p-3 text-left font-semibold text-sm">Comments and/or Required Changes</th>
                <th className="border p-3 text-center font-semibold text-sm w-16"></th>
              </tr>
            </thead>
            <tbody>
              {systems.map((system, index) => (
                <AnimatedTableRow 
                  key={system.id || index} 
                  itemKey={system.id || `system-${index}`}
                  isNew={newItemIds.has(system.id)}
                  className="hover:bg-muted/50"
                >
                  <td className="border p-2">
                    <HistoryAutocomplete
                      value={system.name || ""}
                      onChange={(value) => updateSystem(index, "name", value)}
                      onBlur={onImmediateSave}
                      storageKey="rope-works-operating-system-names"
                      syncToDatabase={true}
                      fieldType="operating_system_element"
                      placeholder="Enter or select name"
                      className="border-0 bg-transparent"
                    />
                  </td>
                  <td className="border p-2">
                    <SystemTypeSelect
                      value={system.system_name}
                      onChange={(value) => updateSystem(index, "system_name", value)}
                    />
                  </td>
                  <td className="border p-2">
                    <ResultSelect
                      value={system.result}
                      onChange={(value) => updateSystem(index, "result", value)}
                    />
                  </td>
                  <td className="border p-2">
                    <VoiceRichTextEditor
                      content={system.comments || ""}
                      onChange={(value) => updateSystem(index, "comments", value)}
                      placeholder="Enter comments..."
                      className="border-0 bg-transparent"
                    />
                  </td>
                  <td className="border p-2 text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setItemToDelete({ index, name: system.name || system.system_name || "this system" })}
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
        <div className="md:hidden space-y-4">
          {systems.map((system, index) => (
            <AnimatedListItem 
              key={system.id || index}
              itemKey={system.id || `mobile-system-${index}`}
              isNew={newItemIds.has(system.id)}
            >
            <Card key={system.id || index} className="p-4 relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setItemToDelete({ index, name: system.name || system.system_name || "this system" })}
                className="absolute top-2 right-2 h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <div className="space-y-3 pr-8">
                <div>
                  <Label className="text-xs text-muted-foreground">Element Name</Label>
                  <HistoryAutocomplete
                    value={system.name || ""}
                    onChange={(value) => updateSystem(index, "name", value)}
                    onBlur={onImmediateSave}
                    storageKey="rope-works-operating-system-names"
                    syncToDatabase={true}
                    fieldType="operating_system_element"
                    placeholder="Enter or select name"
                  />
                </div>
                
                <div>
                  <Label className="text-xs text-muted-foreground">Operating System</Label>
                  <SystemTypeSelect
                    value={system.system_name}
                    onChange={(value) => updateSystem(index, "system_name", value)}
                  />
                </div>
                
                <div>
                  <Label className="text-xs text-muted-foreground">Result</Label>
                  <ResultSelect
                    value={system.result}
                    onChange={(value) => updateSystem(index, "result", value)}
                  />
                </div>
                
                <div>
                  <Label className="text-xs text-muted-foreground">Comments and/or Required Changes</Label>
                  <VoiceRichTextEditor
                    content={system.comments || ""}
                    onChange={(value) => updateSystem(index, "comments", value)}
                    placeholder="Enter comments..."
                  />
                </div>
              </div>
            </Card>
            </AnimatedListItem>
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
