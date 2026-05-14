import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { triggerHaptic } from "@/lib/haptics";
import { SectionComments } from "./SectionComments";

const STRUCTURE_ITEMS = [
  { key: 'wood_poles', label: 'Wood poles plumb and free of damage (woodpecker holes)' },
  { key: 'lifelines', label: 'Lifelines are intact/properly placed/appropriate sag' },
  { key: 'terminations', label: 'Terminations/Wire rope fittings are on and torqued' },
  { key: 'guy_anchors', label: 'Guy anchors are intact/undisturbed at ground' },
  { key: 'guy_cables', label: 'Guy cables are intact/properly placed/no evidence of significant slack' },
  { key: 'wood_platforms', label: 'Wood and wood platforms are free from damage' },
  { key: 'cycle_checks', label: 'Element/Course Pre Use Cycle Checks are successful (zip line, swing, limited fall)' },
];

interface StructureChecksSectionProps {
  checks: any[];
  onUpdate: (checks: any[]) => void;
  sectionComments: string;
  onSectionCommentsChange: (value: string) => void;
  onSectionCommentsBlur?: () => void;
}

import React from "react";

const StructureChecksSection = React.memo(function StructureChecksSection({ checks, onUpdate, sectionComments, onSectionCommentsChange, onSectionCommentsBlur }: StructureChecksSectionProps) {
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
        <CardTitle>Pre Use Inspection Structure/Activity Area/Element</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {STRUCTURE_ITEMS.map((item) => {
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
          placeholder="Add notes about structural observations, damage, or maintenance needs..."
          label="Structure Notes"
        />
      </CardContent>
    </Card>
  );
});

export default StructureChecksSection;
