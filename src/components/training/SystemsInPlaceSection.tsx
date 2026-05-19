import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { triggerHaptic } from "@/lib/haptics";

interface SystemsInPlaceSectionProps {
  items: any[];
  onUpdate: (items: any[] | ((prev: any[]) => any[])) => void;
}

const SYSTEMS_IN_PLACE = [
  'A system for conducting and documenting a periodic internal monitoring of the course, surrounding environment, and equipment',
  'A system in place for incident documentation',
  'A system in place to inform participants of the inherent and other risks associated with participation',
  'A system in place for assessing and confirming activity corridors are clear of obstructions',
  'A system in place to engage a qualified person to review the site\'s risk management and program quality every five years. (CHPT 2 ANSI/ACCT B.2.7)',
  'Unable to check any of the above at this time'
];

import React from "react";

const SystemsInPlaceSection = React.memo(function SystemsInPlaceSection({ items, onUpdate }: SystemsInPlaceSectionProps) {
  const handleToggle = (item: string, checked: boolean) => {
    triggerHaptic('light');
    if (checked) {
      onUpdate([{
        id: crypto.randomUUID(),
        system_item: item,
        created_at: new Date().toISOString()
      }, ...items]);
    } else {
      onUpdate((prev: any[]) => prev.filter(i => i.system_item !== item));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Systems in Place</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {SYSTEMS_IN_PLACE.map((item) => (
          <div key={item} className="flex items-start space-x-2">
            <Checkbox
              id={`system-place-${item}`}
              checked={items.some(i => i.system_item === item)}
              onCheckedChange={(checked) => handleToggle(item, checked as boolean)}
              className="mt-0.5"
            />
            <Label
              htmlFor={`system-place-${item}`}
              className="text-sm font-normal cursor-pointer leading-tight"
            >
              {item}
            </Label>
          </div>
        ))}
      </CardContent>
    </Card>
  );
});

export default SystemsInPlaceSection;
