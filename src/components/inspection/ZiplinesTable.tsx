import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ResultSelect from "@/components/ResultSelect";
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

interface ZiplinesTableProps {
  ziplines: any[];
  onUpdate: (ziplines: any[]) => void;
  onImmediateSave?: () => void;
}

export default function ZiplinesTable({ ziplines, onUpdate, onImmediateSave }: ZiplinesTableProps) {
  const [newItemIds, setNewItemIds] = useState<Set<string>>(new Set());
  const prevZiplinesLengthRef = useRef(ziplines.length);
  const [itemToDelete, setItemToDelete] = useState<{ index: number; name: string } | null>(null);

  // Track newly added items for animation
  useEffect(() => {
    if (ziplines.length > prevZiplinesLengthRef.current) {
      const latestZipline = ziplines[0];
      if (latestZipline?.id) {
        setNewItemIds(prev => new Set(prev).add(latestZipline.id));
        // Clear the "new" status after animation completes
        setTimeout(() => {
          setNewItemIds(prev => {
            const next = new Set(prev);
            next.delete(latestZipline.id);
            return next;
          });
        }, 1500);
      }
    }
    prevZiplinesLengthRef.current = ziplines.length;
  }, [ziplines.length]);

  const addZipline = () => {
    onUpdate([
      {
        id: `temp-${crypto.randomUUID()}`,
        inspection_id: window.location.pathname.split('/').pop(),
        zipline_name: "",
        cable_type: "",
        cable_length: null,
        unload_tension: null,
        load_tension: null,
        cable_result: "pass",
        braking_system: "",
        braking_result: "pass",
        ead_system: "",
        ead_result: "pass",
        result: "pass",
        comments: "",
      },
      ...ziplines,
    ]);
  };

  const updateZipline = (index: number, field: string, value: any) => {
    const updated = [...ziplines];
    updated[index] = { ...updated[index], [field]: value };
    onUpdate(updated);
  };

  const handleDeleteConfirm = () => {
    if (itemToDelete) {
      const updated = ziplines.filter((_, i) => i !== itemToDelete.index);
      onUpdate(updated);
      onImmediateSave?.();
      setItemToDelete(null);
    }
  };

  return (
    <Card>
      <CardHeader className="px-4 md:px-6">
        <div className="flex items-center justify-between">
          <CardTitle>Ziplines</CardTitle>
          <Button onClick={addZipline} size="sm">
            <Plus className="w-4 h-4 mr-2" />
            Add Zipline
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-3 md:px-6">
        <div className="mb-4 space-y-1 text-xs text-muted-foreground">
          <p><strong>Cable Type KEY:</strong> GAC = Galvanized Aircraft Cable, SS = Super Swaged</p>
          <p><strong>Braking System KEY:</strong> ZS = Zip Stop, FB = Friction Break, SB = Spring Bank, G = Gravity</p>
          <p><strong>Emergency Brake System KEY -</strong> ZS = Zip Stop, AP = Auto Prusik, SB = Spring Bank</p>
        </div>

        {/* Desktop table view */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-blue-50 dark:bg-blue-950/20">
                <th className="border p-2 text-left font-semibold text-xs">Line Name</th>
                <th className="border p-2 text-left font-semibold text-xs">Cable Type</th>
                <th className="border p-2 text-left font-semibold text-xs">Length (ft)</th>
                <th className="border p-2 text-left font-semibold text-xs">Unload (lbf)</th>
                <th className="border p-2 text-left font-semibold text-xs">Load (lbf)</th>
                <th className="border p-2 text-left font-semibold text-xs">Cable Result</th>
                <th className="border p-2 text-left font-semibold text-xs">Braking Sys</th>
                <th className="border p-2 text-left font-semibold text-xs">Braking Result</th>
                <th className="border p-2 text-left font-semibold text-xs">EAD Sys</th>
                <th className="border p-2 text-left font-semibold text-xs">EAD Result</th>
                <th className="border p-2 text-left font-semibold text-xs">Overall</th>
                <th className="border p-2 text-left font-semibold text-xs">Comments and/or Required Changes</th>
                <th className="border p-2 text-center font-semibold text-xs w-12"></th>
              </tr>
            </thead>
            <tbody>
              {ziplines.map((zipline, index) => (
                <AnimatedTableRow 
                  key={zipline.id || index} 
                  itemKey={zipline.id || `zipline-${index}`}
                  isNew={newItemIds.has(zipline.id)}
                  className="hover:bg-muted/50"
                >
                  <td className="border p-1">
                    <HistoryAutocomplete
                      value={zipline.zipline_name}
                      onChange={(value) => updateZipline(index, "zipline_name", value)}
                      onBlur={onImmediateSave}
                      storageKey="rope-works-zipline-names"
                      syncToDatabase={true}
                      fieldType="zipline_name"
                      placeholder="Name"
                      className="border-0 bg-transparent h-8 text-xs"
                    />
                  </td>
                  <td className="border p-1">
                    <Select
                      value={zipline.cable_type}
                      onValueChange={(value) => updateZipline(index, "cable_type", value)}
                    >
                      <SelectTrigger className="h-8 text-xs border-0 bg-transparent">
                        <SelectValue placeholder="Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GAC">GAC</SelectItem>
                        <SelectItem value="SS">SS</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="border p-1">
                    <Input
                      type="number"
                      value={zipline.cable_length || ""}
                      onChange={(e) => updateZipline(index, "cable_length", parseFloat(e.target.value) || null)}
                      onBlur={onImmediateSave}
                      onKeyDown={(e) => e.key === 'Enter' && onImmediateSave?.()}
                      placeholder="ft"
                      className="border-0 bg-transparent h-8 text-xs"
                    />
                  </td>
                  <td className="border p-1">
                    <Input
                      type="number"
                      value={zipline.unload_tension || ""}
                      onChange={(e) => updateZipline(index, "unload_tension", parseFloat(e.target.value) || null)}
                      onBlur={onImmediateSave}
                      onKeyDown={(e) => e.key === 'Enter' && onImmediateSave?.()}
                      placeholder="lbf"
                      className="border-0 bg-transparent h-8 text-xs"
                    />
                  </td>
                  <td className="border p-1">
                    <Input
                      type="number"
                      value={zipline.load_tension || ""}
                      onChange={(e) => updateZipline(index, "load_tension", parseFloat(e.target.value) || null)}
                      onBlur={onImmediateSave}
                      onKeyDown={(e) => e.key === 'Enter' && onImmediateSave?.()}
                      placeholder="lbf"
                      className="border-0 bg-transparent h-8 text-xs"
                    />
                  </td>
                  <td className="border p-1">
                    <ResultSelect
                      value={zipline.cable_result}
                      onChange={(value) => updateZipline(index, "cable_result", value)}
                    />
                  </td>
                  <td className="border p-1">
                    <Select
                      value={zipline.braking_system}
                      onValueChange={(value) => updateZipline(index, "braking_system", value)}
                    >
                      <SelectTrigger className="h-8 text-xs border-0 bg-transparent">
                        <SelectValue placeholder="Sys" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ZS">ZS</SelectItem>
                        <SelectItem value="FB">FB</SelectItem>
                        <SelectItem value="SB">SB</SelectItem>
                        <SelectItem value="G">G</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="border p-1">
                    <ResultSelect
                      value={zipline.braking_result}
                      onChange={(value) => updateZipline(index, "braking_result", value)}
                    />
                  </td>
                  <td className="border p-1">
                    <Select
                      value={zipline.ead_system}
                      onValueChange={(value) => updateZipline(index, "ead_system", value)}
                    >
                      <SelectTrigger className="h-8 text-xs border-0 bg-transparent">
                        <SelectValue placeholder="Sys" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ZS">ZS</SelectItem>
                        <SelectItem value="AP">AP</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="border p-1">
                    <ResultSelect
                      value={zipline.ead_result}
                      onChange={(value) => updateZipline(index, "ead_result", value)}
                    />
                  </td>
                  <td className="border p-1">
                    <ResultSelect
                      value={zipline.result}
                      onChange={(value) => updateZipline(index, "result", value)}
                    />
                  </td>
                  <td className="border p-1">
                    <RichTextEditor
                      content={zipline.comments || ""}
                      onChange={(value) => updateZipline(index, "comments", value)}
                      placeholder="Comments..."
                      className="border-0 bg-transparent"
                    />
                  </td>
                  <td className="border p-1 text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setItemToDelete({ index, name: zipline.zipline_name || "this zipline" })}
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
        
        {/* Mobile/Tablet card view */}
        <div className="md:hidden space-y-3">
          {ziplines.map((zipline, index) => (
            <AnimatedListItem 
              key={zipline.id || index}
              itemKey={zipline.id || `mobile-zipline-${index}`}
              isNew={newItemIds.has(zipline.id)}
            >
            <div className="p-4 relative border-l-4 border-l-primary/20 rounded-lg bg-muted/30 border border-border">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setItemToDelete({ index, name: zipline.zipline_name || "this zipline" })}
                className="absolute top-3 right-3 h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <div className="space-y-3 pr-10">
                <div>
                  <Label className="text-xs text-muted-foreground">Line Name</Label>
                  <HistoryAutocomplete
                    value={zipline.zipline_name}
                    onChange={(value) => updateZipline(index, "zipline_name", value)}
                    onBlur={onImmediateSave}
                    storageKey="rope-works-zipline-names"
                    syncToDatabase={true}
                    fieldType="zipline_name"
                    placeholder="Enter or select name"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="min-w-0">
                    <Label className="text-xs text-muted-foreground">Cable Type</Label>
                    <Select
                      value={zipline.cable_type}
                      onValueChange={(value) => updateZipline(index, "cable_type", value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GAC">GAC</SelectItem>
                        <SelectItem value="SS">SS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="min-w-0">
                    <Label className="text-xs text-muted-foreground">Length (ft)</Label>
                    <Input
                      type="number"
                      value={zipline.cable_length || ""}
                      onChange={(e) => updateZipline(index, "cable_length", parseFloat(e.target.value) || null)}
                      onBlur={onImmediateSave}
                      onKeyDown={(e) => e.key === 'Enter' && onImmediateSave?.()}
                      placeholder="Length"
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="min-w-0">
                    <Label className="text-xs text-muted-foreground">Unload</Label>
                    <Input
                      type="number"
                      value={zipline.unload_tension || ""}
                      onChange={(e) => updateZipline(index, "unload_tension", parseFloat(e.target.value) || null)}
                      onBlur={onImmediateSave}
                      onKeyDown={(e) => e.key === 'Enter' && onImmediateSave?.()}
                      placeholder="Unload"
                    />
                  </div>
                  
                  <div className="min-w-0">
                    <Label className="text-xs text-muted-foreground">Load</Label>
                    <Input
                      type="number"
                      value={zipline.load_tension || ""}
                      onChange={(e) => updateZipline(index, "load_tension", parseFloat(e.target.value) || null)}
                      onBlur={onImmediateSave}
                      onKeyDown={(e) => e.key === 'Enter' && onImmediateSave?.()}
                      placeholder="Load"
                    />
                  </div>
                </div>
                
                <div>
                  <Label className="text-xs text-muted-foreground">Cable Result</Label>
                  <ResultSelect
                    value={zipline.cable_result}
                    onChange={(value) => updateZipline(index, "cable_result", value)}
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="min-w-0">
                    <Label className="text-xs text-muted-foreground">Braking Sys</Label>
                    <Select
                      value={zipline.braking_system}
                      onValueChange={(value) => updateZipline(index, "braking_system", value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="System" />
                      </SelectTrigger>
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
                    <ResultSelect
                      value={zipline.braking_result}
                      onChange={(value) => updateZipline(index, "braking_result", value)}
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="min-w-0">
                    <Label className="text-xs text-muted-foreground">EAD Sys</Label>
                    <Select
                      value={zipline.ead_system}
                      onValueChange={(value) => updateZipline(index, "ead_system", value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="System" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ZS">ZS - Zip Stop</SelectItem>
                        <SelectItem value="AP">AP - Auto P</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="min-w-0">
                    <Label className="text-xs text-muted-foreground">EAD Result</Label>
                    <ResultSelect
                      value={zipline.ead_result}
                      onChange={(value) => updateZipline(index, "ead_result", value)}
                    />
                  </div>
                </div>
                
                <div>
                  <Label className="text-xs text-muted-foreground">Overall Result</Label>
                  <ResultSelect
                    value={zipline.result}
                    onChange={(value) => updateZipline(index, "result", value)}
                  />
                </div>
                
                <div>
                  <Label className="text-xs text-muted-foreground">Comments / Changes</Label>
                  <RichTextEditor
                    content={zipline.comments || ""}
                    onChange={(value) => updateZipline(index, "comments", value)}
                    placeholder="Enter comments..."
                  />
                </div>
              </div>
            </div>
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
