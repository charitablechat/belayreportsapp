import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { VoiceTextarea } from "@/components/ui/voice-textarea";
import { triggerHaptic } from "@/lib/haptics";

const BEGINNING_OF_DAY_ITEMS = [
  { key: 'first_aid_kit', label: 'First Aid Kit Available & Contents Complete' },
  { key: 'communication_protocol', label: 'Communication protocol established/verified for operations/emergency' },
  { key: 'equipment_stored', label: 'Equipment properly stored, locked, and maintained' },
  { key: 'drinking_water', label: 'Drinking water available/replenished' },
  { key: 'amenities', label: 'Sunscreen, tarps, other amenities established and available as needed' },
  { key: 'restroom_services', label: 'Restroom services available and ready for use' },
  { key: 'group_check_in', label: 'Group Check in' },
];

interface BeginningOfDaySectionProps {
  items: any[];
  onUpdate: (items: any[]) => void;
}

import React from "react";

const BeginningOfDaySection = React.memo(function BeginningOfDaySection({ items, onUpdate }: BeginningOfDaySectionProps) {
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
      onUpdate([{ 
        id: crypto.randomUUID(),
        item_key: itemKey, 
        is_complete: true, 
        comments: '',
        created_at: new Date().toISOString()
      }, ...items]);
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
      onUpdate([{ 
        id: crypto.randomUUID(),
        item_key: itemKey, 
        is_complete: false, 
        comments,
        created_at: new Date().toISOString()
      }, ...items]);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Beginning of Day Proceedings</CardTitle>
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
});

export default BeginningOfDaySection;
