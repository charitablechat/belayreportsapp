import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { VoiceTextarea } from "@/components/ui/voice-textarea";
import { triggerHaptic } from "@/lib/haptics";

const END_OF_DAY_ITEMS = [
  { key: 'access_areas_secure', label: 'Access areas secure/locked' },
  { key: 'equipment_inspected', label: 'Equipment inspected, cleaned, secured' },
  { key: 'ladders_stored', label: 'Ladders stored/locked' },
  { key: 'rope_equipment_logs', label: 'Rope logs, equipment logs complete' },
  { key: 'environment_clean', label: 'Environment clean (trash, etc.) Drinking water stored/replenished' },
  { key: 'group_check_out', label: 'Group Check out' },
];

interface EndOfDaySectionProps {
  items: any[];
  onUpdate: (items: any[]) => void;
}

export default function EndOfDaySection({ items, onUpdate }: EndOfDaySectionProps) {
  const handleToggle = (itemKey: string) => {
    triggerHaptic('light');
    const existingItem = items.find(i => i.item_key === itemKey);
    
    if (existingItem) {
      onUpdate(items.map(i => 
        i.item_key === itemKey 
          ? { ...i, is_complete: !i.is_complete }
          : i
      ));
    } else {
      // Generate stable ID immediately when creating new item
      onUpdate([...items, { 
        id: crypto.randomUUID(),
        item_key: itemKey, 
        is_complete: true, 
        comments: '' 
      }]);
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
      // Generate stable ID immediately when creating new item
      onUpdate([...items, { 
        id: crypto.randomUUID(),
        item_key: itemKey, 
        is_complete: false, 
        comments 
      }]);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>End of Day Proceedings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {END_OF_DAY_ITEMS.map((item) => {
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
              <VoiceTextarea
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
