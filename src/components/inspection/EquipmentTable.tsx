import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import ResultSelect from "@/components/ResultSelect";
import HistoryAutocomplete from "@/components/HistoryAutocomplete";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface EquipmentTableProps {
  category: string;
  displayName: string;
  equipment: any[];
  onUpdate: (equipment: any[]) => void;
}

export default function EquipmentTable({ category, displayName, equipment, onUpdate }: EquipmentTableProps) {
  const categoryEquipment = equipment.filter((item) => item.equipment_category === category);

  const addEquipment = () => {
    onUpdate([
      ...equipment,
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
    ]);
  };

  const updateEquipment = (item: any, field: string, value: any) => {
    const updated = equipment.map((eq) =>
      eq === item ? { ...eq, [field]: value } : eq
    );
    onUpdate(updated);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">EQUIPMENT - {displayName.toUpperCase()}</CardTitle>
          <Button onClick={addEquipment} size="sm">
            <Plus className="w-4 h-4 mr-2" />
            Add {displayName}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
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
              </tr>
            </thead>
            <tbody>
              {categoryEquipment.map((item, index) => (
                <tr key={index} className="hover:bg-muted/50">
                  <td className="border p-2">
                    <HistoryAutocomplete
                      value={item.equipment_type}
                      onChange={(value) => updateEquipment(item, "equipment_type", value)}
                      storageKey="rope-works-equipment-types"
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
                      placeholder="Year"
                      className="border-0 bg-transparent"
                    />
                  </td>
                  <td className="border p-2">
                    <Input
                      type="number"
                      value={item.quantity || ""}
                      onChange={(e) => updateEquipment(item, "quantity", parseInt(e.target.value) || null)}
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
                    <RichTextEditor
                      content={item.comments || ""}
                      onChange={(value) => updateEquipment(item, "comments", value)}
                      placeholder="Enter comments..."
                      className="border-0 bg-transparent"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {/* Mobile card view */}
        <div className="md:hidden space-y-4">
          {categoryEquipment.map((item, index) => (
            <Card key={index} className="p-4">
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Type *</Label>
                  <HistoryAutocomplete
                    value={item.equipment_type}
                    onChange={(value) => updateEquipment(item, "equipment_type", value)}
                    storageKey="rope-works-equipment-types"
                    placeholder="Enter or select type"
                    className={cn(
                      !item.equipment_type || item.equipment_type.trim() === ""
                        ? "ring-2 ring-destructive"
                        : ""
                    )}
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Production Year</Label>
                    <Input
                      type="number"
                      value={item.production_year || ""}
                      onChange={(e) => updateEquipment(item, "production_year", parseInt(e.target.value) || null)}
                      placeholder="Year"
                    />
                  </div>
                  
                  <div>
                    <Label className="text-xs text-muted-foreground">Quantity</Label>
                    <Input
                      type="number"
                      value={item.quantity || ""}
                      onChange={(e) => updateEquipment(item, "quantity", parseInt(e.target.value) || null)}
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
                  <Label className="text-xs text-muted-foreground">Comments and/or Required Changes</Label>
                  <RichTextEditor
                    content={item.comments || ""}
                    onChange={(value) => updateEquipment(item, "comments", value)}
                    placeholder="Enter comments..."
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
