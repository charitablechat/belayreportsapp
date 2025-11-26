import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const BEGINNING_OF_DAY_ITEMS = [
  { key: 'first_aid_kit', label: 'First aid kit is accessible and equipped' },
  { key: 'communication_protocol', label: 'Communication protocol is understood by all staff' },
  { key: 'weather_plan', label: 'Weather plan has been reviewed for the day' },
  { key: 'emergency_procedures', label: 'Emergency action procedures have been reviewed' },
  { key: 'rescue_equipment', label: 'Rescue equipment is accessible and operational' },
  { key: 'staff_briefing', label: 'Staff briefing completed including any concerns or changes' },
];

interface BeginningOfDaySectionProps {
  items: any[];
  onUpdate: (items: any[]) => void;
}

export default function BeginningOfDaySection({ items, onUpdate }: BeginningOfDaySectionProps) {
  const handleToggle = (itemKey: string) => {
    const existingItem = items.find(i => i.item_key === itemKey);
    
    if (existingItem) {
      onUpdate(items.map(i => 
        i.item_key === itemKey 
          ? { ...i, is_complete: !i.is_complete }
          : i
      ));
    } else {
      onUpdate([...items, { item_key: itemKey, is_complete: true, comments: '' }]);
    }
  };

  const handleCommentChange = (itemKey: string, comments: string) => {
    const existingItem = items.find(i => i.item_key === itemKey);
    
    if (existingItem) {
      onUpdate(items.map(i => 
        i.item_key === itemKey 
          ? { ...i, comments }
          : i
      ));
    } else {
      onUpdate([...items, { item_key: itemKey, is_complete: false, comments }]);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Beginning of Day Checklist</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {BEGINNING_OF_DAY_ITEMS.map((item) => {
          const existingItem = items.find(i => i.item_key === item.key);
          return (
            <div key={item.key} className="space-y-2 border-b pb-4 last:border-b-0">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={item.key}
                  checked={existingItem?.is_complete || false}
                  onCheckedChange={() => handleToggle(item.key)}
                />
                <Label htmlFor={item.key} className="text-sm font-normal cursor-pointer">
                  {item.label}
                </Label>
              </div>
              <Textarea
                placeholder="Comments (optional)"
                value={existingItem?.comments || ''}
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
