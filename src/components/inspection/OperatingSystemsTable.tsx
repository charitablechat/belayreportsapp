import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import ResultSelect from "@/components/ResultSelect";
import SystemTypeSelect from "@/components/SystemTypeSelect";
import HistoryAutocomplete from "@/components/HistoryAutocomplete";
import { Plus } from "lucide-react";

interface OperatingSystemsTableProps {
  systems: any[];
  onUpdate: (systems: any[]) => void;
  onImmediateSave?: () => void;
}

export default function OperatingSystemsTable({ systems, onUpdate, onImmediateSave }: OperatingSystemsTableProps) {
  const addSystem = () => {
    onUpdate([
      ...systems, 
      { 
        id: `temp-${crypto.randomUUID()}`,
        inspection_id: window.location.pathname.split('/').pop(),
        system_name: "", 
        result: "pass", 
        comments: "" 
      }
    ]);
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
        {/* Desktop table view */}
        <div className="hidden md:block overflow-x-auto">
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
                    <SystemTypeSelect
                      value={system.system_name}
                      onChange={(value) => updateSystem(index, "system_name", value)}
                    />
                  </td>
                  <td className="border p-2">
                    <HistoryAutocomplete
                      value={system.name || ""}
                      onChange={(value) => updateSystem(index, "name", value)}
                      onBlur={onImmediateSave}
                      storageKey="rope-works-operating-system-names"
                      placeholder="Enter or select name"
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
                    <RichTextEditor
                      content={system.comments || ""}
                      onChange={(value) => updateSystem(index, "comments", value)}
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
          {systems.map((system, index) => (
            <Card key={index} className="p-4">
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Operating System</Label>
                  <SystemTypeSelect
                    value={system.system_name}
                    onChange={(value) => updateSystem(index, "system_name", value)}
                  />
                </div>
                
                <div>
                  <Label className="text-xs text-muted-foreground">Name</Label>
                  <HistoryAutocomplete
                    value={system.name || ""}
                    onChange={(value) => updateSystem(index, "name", value)}
                    onBlur={onImmediateSave}
                    storageKey="rope-works-operating-system-names"
                    placeholder="Enter or select name"
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
                  <Label className="text-xs text-muted-foreground">Comments or Required Changes</Label>
                  <RichTextEditor
                    content={system.comments || ""}
                    onChange={(value) => updateSystem(index, "comments", value)}
                    placeholder="Enter comments..."
                  />
                </div>
              </div>
            </Card>
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
    </Card>
  );
}
