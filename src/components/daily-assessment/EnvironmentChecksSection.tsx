import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { triggerHaptic } from "@/lib/haptics";
import { SectionComments } from "./SectionComments";

const ENVIRONMENT_ITEMS = [
  { key: 'weather_conditions', label: 'Weather conditions appropriate and in line with Belay Reports policy' },
  { key: 'no_vandalism', label: 'Zero presence of course vandalism (use comment area if otherwise)' },
  { key: 'no_overhead_hazards', label: 'Free from trees/limbs or other overhead hazards' },
];

interface EnvironmentChecksSectionProps {
  checks: any[];
  onUpdate: (checks: any[]) => void;
  sectionComments: string;
  onSectionCommentsChange: (value: string) => void;
  onSectionCommentsBlur?: () => void;
}

import React from "react";

const EnvironmentChecksSection = React.memo(function EnvironmentChecksSection({ checks, onUpdate, sectionComments, onSectionCommentsChange, onSectionCommentsBlur }: EnvironmentChecksSectionProps) {
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
        is_checked: true,
        created_at: new Date().toISOString()
      }, ...checks]);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pre Use Inspection Environment and Other</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {ENVIRONMENT_ITEMS.map((item) => {
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
        
        <SectionComments
          value={sectionComments}
          onChange={onSectionCommentsChange}
          onBlur={onSectionCommentsBlur}
          placeholder="Add notes about environmental conditions, weather concerns, or other observations..."
          label="Environment Notes"
        />
      </CardContent>
    </Card>
  );
});

export default EnvironmentChecksSection;
