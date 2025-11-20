import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Input } from "@/components/ui/input";

interface SummarySectionProps {
  summary: any;
  onUpdate: (summary: any) => void;
}

export default function SummarySection({ summary, onUpdate }: SummarySectionProps) {
  const updateField = (field: string, value: any) => {
    onUpdate({ ...summary, [field]: value });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Report Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label className="text-base font-semibold">
            Repairs, Alterations performed during inspection:
          </Label>
          <RichTextEditor
            content={summary.repairs_performed || ""}
            onChange={(value) => updateField("repairs_performed", value)}
            placeholder="Enter details of repairs and alterations performed..."
          />
        </div>

        <div className="space-y-2">
          <Label className="text-base font-semibold">
            Critical Actions Required
          </Label>
          <p className="text-xs text-muted-foreground italic">
            *Critical Action = Required Changes Prior to use of Activity, Element, or Equipment
          </p>
          <RichTextEditor
            content={summary.critical_actions || ""}
            onChange={(value) => updateField("critical_actions", value)}
            placeholder="Enter critical actions required..."
          />
        </div>

        <div className="space-y-2">
          <Label className="text-base font-semibold">
            Future Considerations
          </Label>
          <p className="text-xs text-muted-foreground">
            (includes but not limited to age of course, recommended updates, suggestions, industry future)
          </p>
          <RichTextEditor
            content={summary.future_considerations || ""}
            onChange={(value) => updateField("future_considerations", value)}
            placeholder="Enter future considerations..."
          />
        </div>

        <div className="space-y-2">
          <Label className="text-base font-semibold">Next inspection date:</Label>
          <Input
            type="date"
            value={summary.next_inspection_date || ""}
            onChange={(e) => updateField("next_inspection_date", e.target.value)}
          />
        </div>

        <div className="border-t pt-6">
          <h3 className="text-base font-semibold mb-4">General Rope Works Inspection Retirement Guidelines:</h3>
          <p className="text-xs text-muted-foreground mb-4">
            These are generalized and are not a substitute for the Pre use inspection.
          </p>
          
          {/* Desktop table view */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-blue-50 dark:bg-blue-950/20">
                  <th className="border p-3 text-left font-semibold">Item</th>
                  <th className="border p-3 text-left font-semibold">Retirement Guideline</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border p-3">Harness:</td>
                  <td className="border p-3">Manufacture maximum use or condition warranted at time of inspection</td>
                </tr>
                <tr>
                  <td className="border p-3">Lanyards:</td>
                  <td className="border p-3">Manufacture maximum use or condition warranted at time of inspection</td>
                </tr>
                <tr>
                  <td className="border p-3">Kernmantle Rope</td>
                  <td className="border p-3">5 years or 1000 loads when used with top rope systems</td>
                </tr>
                <tr>
                  <td className="border p-3">Kernmantle Rope</td>
                  <td className="border p-3">5 years or 300 loads, whichever comes first when used on aerial leap activities</td>
                </tr>
                <tr>
                  <td className="border p-3">Helmets:</td>
                  <td className="border p-3">Manufacture maximum use or condition warranted at time of inspection</td>
                </tr>
                <tr>
                  <td className="border p-3">Pulleys, Trolleys, Carabiners, Belay/descent devices, Cable grabs:</td>
                  <td className="border p-3">Manufacture maximum use or condition warranted at time of inspection</td>
                </tr>
              </tbody>
            </table>
          </div>
          
          {/* Mobile card view */}
          <div className="md:hidden space-y-3">
            <Card className="p-3">
              <p className="font-medium text-sm">Harness & Lanyards:</p>
              <p className="text-xs text-muted-foreground mt-1">Manufacture maximum use or condition warranted at time of inspection</p>
            </Card>
            <Card className="p-3">
              <p className="font-medium text-sm">Kernmantle Rope (Top Rope):</p>
              <p className="text-xs text-muted-foreground mt-1">5 years or 1000 loads when used with top rope systems</p>
            </Card>
            <Card className="p-3">
              <p className="font-medium text-sm">Kernmantle Rope (Aerial Leap):</p>
              <p className="text-xs text-muted-foreground mt-1">5 years or 300 loads, whichever comes first when used on aerial leap activities</p>
            </Card>
            <Card className="p-3">
              <p className="font-medium text-sm">Helmets:</p>
              <p className="text-xs text-muted-foreground mt-1">Manufacture maximum use or condition warranted at time of inspection</p>
            </Card>
            <Card className="p-3">
              <p className="font-medium text-sm">Hardware (Pulleys, Trolleys, Carabiners, etc.):</p>
              <p className="text-xs text-muted-foreground mt-1">Manufacture maximum use or condition warranted at time of inspection</p>
            </Card>
          </div>
        </div>

        <div className="text-xs text-muted-foreground border-t pt-4">
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
