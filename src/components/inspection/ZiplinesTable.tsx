import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ResultSelect from "@/components/ResultSelect";
import { Plus } from "lucide-react";

interface ZiplinesTableProps {
  ziplines: any[];
  onUpdate: (ziplines: any[]) => void;
}

export default function ZiplinesTable({ ziplines, onUpdate }: ZiplinesTableProps) {
  const addZipline = () => {
    onUpdate([
      ...ziplines,
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
    ]);
  };

  const updateZipline = (index: number, field: string, value: any) => {
    const updated = [...ziplines];
    updated[index] = { ...updated[index], [field]: value };
    onUpdate(updated);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Ziplines</CardTitle>
          <Button onClick={addZipline} size="sm">
            <Plus className="w-4 h-4 mr-2" />
            Add Zipline
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 space-y-1 text-xs text-muted-foreground">
          <p><strong>Cable Type KEY:</strong> GAC = Galvanized Aircraft Cable, SS = Super Swaged</p>
          <p><strong>Braking System KEY:</strong> ZS = Zip Stop, FB = Friction Break, SB = Spring Bank, G = Gravity</p>
          <p><strong>EAD System KEY:</strong> ZS = Zip Stop, AP = Auto P</p>
        </div>

        <div className="overflow-x-auto">
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
                <th className="border p-2 text-left font-semibold text-xs">Comments</th>
              </tr>
            </thead>
            <tbody>
              {ziplines.map((zipline, index) => (
                <tr key={index} className="hover:bg-muted/50">
                  <td className="border p-1">
                    <Input
                      value={zipline.zipline_name}
                      onChange={(e) => updateZipline(index, "zipline_name", e.target.value)}
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
                      <SelectContent className="bg-card z-50">
                        <SelectItem value="GAC">GAC</SelectItem>
                        <SelectItem value="SS">SS</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="border p-1">
                    <Input
                      type="number"
                      value={zipline.cable_length || ""}
                      onChange={(e) => updateZipline(index, "cable_length", parseInt(e.target.value) || null)}
                      placeholder="Length"
                      className="border-0 bg-transparent h-8 text-xs w-20"
                    />
                  </td>
                  <td className="border p-1">
                    <Input
                      type="number"
                      value={zipline.unload_tension || ""}
                      onChange={(e) => updateZipline(index, "unload_tension", parseInt(e.target.value) || null)}
                      placeholder="Unload"
                      className="border-0 bg-transparent h-8 text-xs w-20"
                    />
                  </td>
                  <td className="border p-1">
                    <Input
                      type="number"
                      value={zipline.load_tension || ""}
                      onChange={(e) => updateZipline(index, "load_tension", parseInt(e.target.value) || null)}
                      placeholder="Load"
                      className="border-0 bg-transparent h-8 text-xs w-20"
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
                        <SelectValue placeholder="Brake" />
                      </SelectTrigger>
                      <SelectContent className="bg-card z-50">
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
                        <SelectValue placeholder="EAD" />
                      </SelectTrigger>
                      <SelectContent className="bg-card z-50">
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
                    <Textarea
                      value={zipline.comments || ""}
                      onChange={(e) => updateZipline(index, "comments", e.target.value)}
                      placeholder="Comments..."
                      className="border-0 bg-transparent min-h-[60px] text-xs"
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
