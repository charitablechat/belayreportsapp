import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ResultSelect from "@/components/ResultSelect";
import { Plus } from "lucide-react";

interface OperatingSystemsTableProps {
  systems: any[];
  onUpdate: (systems: any[]) => void;
}

export default function OperatingSystemsTable({ systems, onUpdate }: OperatingSystemsTableProps) {
  const addSystem = () => {
    onUpdate([...systems, { system_name: "", result: "Pass", comments: "" }]);
  };

  const updateSystem = (index: number, field: string, value: any) => {
    const updated = [...systems];
    updated[index] = { ...updated[index], [field]: value };
    onUpdate(updated);
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
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-blue-50 dark:bg-blue-950/20">
                <th className="border p-3 text-left font-semibold text-sm">Operating System</th>
                <th className="border p-3 text-left font-semibold text-sm">Name</th>
                <th className="border p-3 text-left font-semibold text-sm w-48">Result</th>
                <th className="border p-3 text-left font-semibold text-sm">Comments or Required Changes</th>
              </tr>
            </thead>
            <tbody>
              {systems.map((system, index) => (
                <tr key={index} className="hover:bg-muted/50">
                  <td className="border p-2">
                    <Input
                      value={system.system_name}
                      onChange={(e) => updateSystem(index, "system_name", e.target.value)}
                      placeholder="Enter system type"
                      className="border-0 bg-transparent"
                    />
                  </td>
                  <td className="border p-2">
                    <Input
                      value={system.name || ""}
                      onChange={(e) => updateSystem(index, "name", e.target.value)}
                      placeholder="Enter name"
                      className="border-0 bg-transparent"
                    />
                  </td>
                  <td className="border p-2">
                    <ResultSelect
                      value={system.result}
                      onChange={(value) => updateSystem(index, "result", value)}
                    />
                  </td>
                  <td className="border p-2">
                    <Textarea
                      value={system.comments || ""}
                      onChange={(e) => updateSystem(index, "comments", e.target.value)}
                      placeholder="Enter comments..."
                      className="border-0 bg-transparent min-h-[60px]"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        <div className="mt-6 text-xs text-muted-foreground border-t pt-4">
          <p>
            The information contained in this report has been documented by a Qualified Professional. 
            This report is effective for one year from the date of inspection. Issued by: 
            Rope Works Inc., PO Box 1074, Dripping Springs, TX 78620
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
