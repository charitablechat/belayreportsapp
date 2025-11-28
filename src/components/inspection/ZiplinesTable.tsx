import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ResultSelect from "@/components/ResultSelect";
import HistoryAutocomplete from "@/components/HistoryAutocomplete";
import { Plus } from "lucide-react";

interface ZiplinesTableProps {
  ziplines: any[];
  onUpdate: (ziplines: any[]) => void;
  onImmediateSave?: () => void;
}

export default function ZiplinesTable({ ziplines, onUpdate, onImmediateSave }: ZiplinesTableProps) {
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

        {/* Desktop table view */}
        <div className="hidden lg:block overflow-x-auto">
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
              </tr>
            </thead>
            <tbody>
              {ziplines.map((zipline, index) => (
                <tr key={index} className="hover:bg-muted/50">
                  <td className="border p-1">
                    <HistoryAutocomplete
                      value={zipline.zipline_name}
                      onChange={(value) => updateZipline(index, "zipline_name", value)}
                      onBlur={onImmediateSave}
                      storageKey="rope-works-zipline-names"
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {/* Mobile/Tablet card view */}
        <div className="lg:hidden space-y-4">
          {ziplines.map((zipline, index) => (
            <Card key={index} className="p-4">
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Line Name</Label>
                  <HistoryAutocomplete
                    value={zipline.zipline_name}
                    onChange={(value) => updateZipline(index, "zipline_name", value)}
                    onBlur={onImmediateSave}
                    storageKey="rope-works-zipline-names"
                    placeholder="Enter or select name"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
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
                  
                  <div>
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
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Unload (lbf)</Label>
                    <Input
                      type="number"
                      value={zipline.unload_tension || ""}
                      onChange={(e) => updateZipline(index, "unload_tension", parseFloat(e.target.value) || null)}
                      onBlur={onImmediateSave}
                      onKeyDown={(e) => e.key === 'Enter' && onImmediateSave?.()}
                      placeholder="Unload"
                    />
                  </div>
                  
                  <div>
                    <Label className="text-xs text-muted-foreground">Load (lbf)</Label>
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
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Braking System</Label>
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
                  
                  <div>
                    <Label className="text-xs text-muted-foreground">Braking Result</Label>
                    <ResultSelect
                      value={zipline.braking_result}
                      onChange={(value) => updateZipline(index, "braking_result", value)}
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">EAD System</Label>
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
                  
                  <div>
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
                  <Label className="text-xs text-muted-foreground">Comments and/or Required Changes</Label>
                  <RichTextEditor
                    content={zipline.comments || ""}
                    onChange={(value) => updateZipline(index, "comments", value)}
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
