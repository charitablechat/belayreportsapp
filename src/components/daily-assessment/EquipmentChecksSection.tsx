import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { triggerHaptic } from "@/lib/haptics";

const EQUIPMENT_ITEMS = [
  { key: 'staff_pfas', label: 'Inspection of Staff Personal Fall Arrest System (Harness, helmet, lanyards, connectors)' },
  { key: 'participant_safety', label: 'Inspection of Participant Personal Safety System (Harness, helmet, lanyards, connectors)' },
  { key: 'rescue_equipment', label: 'Inspection of Rescue Equipment (Bag, contents, set for deployment)' },
  { key: 'lanyards', label: 'Inspection of lanyards for operations' },
  { key: 'connectors', label: 'Inspection of connectors for operations' },
  { key: 'belay_descent', label: 'Inspection of belay/descent devices for operations' },
  { key: 'function_checks', label: 'Function checks are successful according to manufacturer' },
];

interface EquipmentChecksSectionProps {
  checks: any[];
  onUpdate: (checks: any[]) => void;
}

import React from "react";

const EquipmentChecksSection = React.memo(function EquipmentChecksSection({ checks, onUpdate }: EquipmentChecksSectionProps) {
  const handleToggle = (itemKey: string) => {
    triggerHaptic('light');
    const existingCheck = checks.find(c => c.item_key === itemKey);
    
    if (existingCheck) {
      onUpdate(checks.map(c => 
        c.item_key === itemKey 
          ? { ...c, is_checked: !c.is_checked }
          : c
      ));
    } else {
      // Generate stable ID immediately when creating new item
      onUpdate([{ 
        id: crypto.randomUUID(),
        item_key: itemKey, 
        is_checked: true 
      }, ...checks]);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pre Use Inspection Equipment/Check all that apply</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {EQUIPMENT_ITEMS.map((item) => {
          const existingCheck = checks.find(c => c.item_key === item.key);
          return (
            <div key={item.key} className="flex items-start space-x-3">
              <Checkbox
                id={item.key}
                checked={existingCheck?.is_checked || false}
                onCheckedChange={() => handleToggle(item.key)}
                className="mt-0.5"
              />
              <Label htmlFor={item.key} className="text-sm font-normal cursor-pointer leading-relaxed">
                {item.label}
              </Label>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
