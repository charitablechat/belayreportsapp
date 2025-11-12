import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ResultSelect from "@/components/ResultSelect";
import { Plus } from "lucide-react";

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
        id: crypto.randomUUID(),
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
        <div className="overflow-x-auto">
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
                    <Input
                      value={item.equipment_type}
                      onChange={(e) => updateEquipment(item, "equipment_type", e.target.value)}
                      placeholder="Enter type"
                      className="border-0 bg-transparent"
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
                    <Textarea
                      value={item.comments || ""}
                      onChange={(e) => updateEquipment(item, "comments", e.target.value)}
                      placeholder="Enter comments..."
                      className="border-0 bg-transparent min-h-[60px]"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
