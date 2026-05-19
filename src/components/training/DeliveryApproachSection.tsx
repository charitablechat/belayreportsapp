import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { triggerHaptic } from "@/lib/haptics";

interface DeliveryApproachSectionProps {
  approaches: any[];
  onUpdate: (approaches: any[] | ((prev: any[]) => any[])) => void;
}

const DELIVERY_APPROACHES = [
  'Facilitated',
  'Guided',
  'Self-Guided'
];

import React from "react";

const DeliveryApproachSection = React.memo(function DeliveryApproachSection({ approaches, onUpdate }: DeliveryApproachSectionProps) {
  const handleToggle = (approach: string, checked: boolean) => {
    triggerHaptic('light');
    if (checked) {
      onUpdate([{
        id: crypto.randomUUID(),
        approach,
        created_at: new Date().toISOString()
      }, ...approaches]);
    } else {
      onUpdate((prev: any[]) => prev.filter(a => a.approach !== approach));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delivery Approach</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {DELIVERY_APPROACHES.map((approach) => (
          <div key={approach} className="flex items-center space-x-2">
            <Checkbox
              id={`approach-${approach}`}
              checked={approaches.some(a => a.approach === approach)}
              onCheckedChange={(checked) => handleToggle(approach, checked as boolean)}
            />
            <Label
              htmlFor={`approach-${approach}`}
              className="text-sm font-normal cursor-pointer"
            >
              {approach}
            </Label>
          </div>
        ))}
      </CardContent>
    </Card>
  );
});

export default DeliveryApproachSection;
