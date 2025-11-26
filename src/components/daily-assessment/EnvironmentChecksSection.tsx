import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const ENVIRONMENT_ITEMS = [
  { key: 'weather_conditions', label: 'Weather conditions' },
  { key: 'ground_conditions', label: 'Ground conditions' },
  { key: 'vegetation', label: 'Vegetation/Growth' },
  { key: 'wildlife', label: 'Wildlife concerns' },
  { key: 'participant_area', label: 'Participant area clear' },
];

interface EnvironmentChecksSectionProps {
  checks: any[];
  onUpdate: (checks: any[]) => void;
}

export default function EnvironmentChecksSection({ checks, onUpdate }: EnvironmentChecksSectionProps) {
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
        <CardTitle>Pre-Use Environment Inspection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {ENVIRONMENT_ITEMS.map((item) => {
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
              <Textarea
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
