import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { triggerHaptic } from "@/lib/haptics";

interface ImmediateAttentionSectionProps {
  items: any[];
  onUpdate: (items: any[] | ((prev: any[]) => any[])) => void;
}

const IMMEDIATE_ATTENTION_ITEMS = [
  'Need to create Local Operational Procedures or Update existing procedures prior to course use',
  'Need to create or need to oversee implementation of a pre use inspection performed by staff prior to using the course and equipment according to a written checklist',
  'Need to provide or have accessible a First Aid Kit during course operations',
  'Need to provide staff with Personal Protective Equipment (PPE) that follows applicable jurisdictional regulations',
  'No Immediate Attention needed at this time'
];

import React from "react";

const ImmediateAttentionSection = React.memo(function ImmediateAttentionSection({ items, onUpdate }: ImmediateAttentionSectionProps) {
  const handleToggle = (item: string, checked: boolean) => {
    triggerHaptic('light');
    if (checked) {
      onUpdate([{
        id: crypto.randomUUID(),
        item,
        created_at: new Date().toISOString()
      }, ...items]);
    } else {
      onUpdate((prev: any[]) => prev.filter(i => i.item !== item));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Immediate Attention</CardTitle>
        <p className="text-sm text-muted-foreground italic mt-1">
          This area lists requirements the trainer either noted as a deficiency at your site or a need to update procedures/policy during the operations of your aerial adventure training.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {IMMEDIATE_ATTENTION_ITEMS.map((item) => (
          <div key={item} className="flex items-start space-x-2">
            <Checkbox
              id={`attention-${item}`}
              checked={items.some(i => i.item === item)}
              onCheckedChange={(checked) => handleToggle(item, checked as boolean)}
              className="mt-0.5"
            />
            <Label
              htmlFor={`attention-${item}`}
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

export default ImmediateAttentionSection;
