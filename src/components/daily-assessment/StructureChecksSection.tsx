import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { VoiceTextarea } from "@/components/ui/voice-textarea";

const STRUCTURE_ITEMS = [
  { key: 'poles_platforms', label: 'Poles/Platforms' },
  { key: 'cables', label: 'Cables' },
  { key: 'belay_cables', label: 'Belay cables' },
  { key: 'anchors', label: 'Anchors' },
  { key: 'ladders_stairs', label: 'Ladders/Stairs' },
  { key: 'bridges_elements', label: 'Bridges/Elements' },
];

interface StructureChecksSectionProps {
  checks: any[];
  onUpdate: (checks: any[]) => void;
}

export default function StructureChecksSection({ checks, onUpdate }: StructureChecksSectionProps) {
  const handleToggle = (itemKey: string) => {
    const existingCheck = checks.find(c => c.item_key === itemKey);
    
    if (existingCheck) {
      onUpdate(checks.map(c => 
        c.item_key === itemKey 
          ? { ...c, is_checked: !c.is_checked }
          : c
      ));
    } else {
      onUpdate([...checks, { item_key: itemKey, is_checked: true, comments: '' }]);
    }
  };

  const handleCommentChange = (itemKey: string, comments: string) => {
    const existingCheck = checks.find(c => c.item_key === itemKey);
    
    if (existingCheck) {
      onUpdate(checks.map(c => 
        c.item_key === itemKey 
          ? { ...c, comments }
          : c
      ));
    } else {
      onUpdate([...checks, { item_key: itemKey, is_checked: false, comments }]);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pre-Use Structure Inspection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {STRUCTURE_ITEMS.map((item) => {
          const existingCheck = checks.find(c => c.item_key === item.key);
          return (
            <div key={item.key} className="space-y-2 border-b pb-4 last:border-b-0">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={item.key}
                  checked={existingCheck?.is_checked || false}
                  onCheckedChange={() => handleToggle(item.key)}
                />
                <Label htmlFor={item.key} className="text-sm font-normal cursor-pointer">
                  {item.label}
                </Label>
              </div>
              <VoiceTextarea
                placeholder="Comments (optional)"
                value={existingCheck?.comments || ''}
                onChange={(e) => handleCommentChange(item.key, e.target.value)}
                className="text-sm"
                rows={2}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
