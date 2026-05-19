import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";
import { triggerHaptic } from "@/lib/haptics";
import { SectionComments } from "./SectionComments";

const OPERATING_SYSTEMS = [
  "Spotted/Spotting",
  "Top Rope Belay System",
  "Limited Fall System",
  "Tensioned Rope System",
  "Positioning",
  "Personal Fall Arrest System",
  "Travel Restraint System",
  "Automated Safety System",
  "Collective Safety System",
];

interface OperatingSystemsSectionProps {
  systems: any[];
  onUpdate: (systems: any[] | ((prev: any[]) => any[])) => void;
  sectionComments: string;
  onSectionCommentsChange: (value: string) => void;
  onSectionCommentsBlur?: () => void;
}

import React from "react";

const OperatingSystemsSection = React.memo(function OperatingSystemsSection({ systems, onUpdate, sectionComments, onSectionCommentsChange, onSectionCommentsBlur }: OperatingSystemsSectionProps) {
  const handleToggle = (systemName: string) => {
    triggerHaptic('light');
    const exists = systems.some(s => s.system_name === systemName);
    
    if (exists) {
      // Functional update so deletion tracker (in DailyAssessmentForm) records the removed id.
      onUpdate((prev: any[]) => prev.filter(s => s.system_name !== systemName));
    } else {
      // Generate stable ID immediately when creating new item
      onUpdate([{ 
        id: crypto.randomUUID(),
        system_name: systemName,
        created_at: new Date().toISOString()
      }, ...systems]);
    }
  };

  const handleAddOther = () => {
    triggerHaptic('light');
    // Generate stable ID immediately when creating new item
    onUpdate([{ 
      id: crypto.randomUUID(),
      system_name: 'Other', 
      other_description: '',
      created_at: new Date().toISOString()
    }, ...systems]);
  };

  const handleUpdateOther = (index: number, description: string) => {
    const otherSystems = systems.filter(s => s.system_name === 'Other');
    const otherIndex = otherSystems.findIndex((_, i) => {
      const actualIndex = systems.findIndex((s, idx) => s.system_name === 'Other' && systems.slice(0, idx).filter(x => x.system_name === 'Other').length === i);
      return actualIndex === index;
    });
    
    const updated = systems.map((s, i) => 
      i === index ? { ...s, other_description: description } : s
    );
    onUpdate(updated);
  };

  const handleRemoveOther = (index: number) => {
    triggerHaptic('light');
    // Functional update so deletion tracker captures the removed id by diffing prev→next.
    onUpdate((prev: any[]) => prev.filter((_, i) => i !== index));
  };

  const standardSystems = systems.filter(s => s.system_name !== 'Other');
  const otherSystems = systems
    .map((s, index) => ({ ...s, originalIndex: index }))
    .filter(s => s.system_name === 'Other');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Type of Operating System/Check all that apply</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {OPERATING_SYSTEMS.map((system) => (
            <div key={system} className="flex items-center space-x-2">
              <Checkbox
                id={system}
                checked={standardSystems.some(s => s.system_name === system)}
                onCheckedChange={() => handleToggle(system)}
              />
              <Label htmlFor={system} className="text-sm font-normal cursor-pointer">
                {system}
              </Label>
            </div>
          ))}
        </div>

        {/* Other/Custom Systems */}
        <div className="space-y-3 pt-4 border-t">
          <Label className="text-sm font-medium">Custom Operating Systems</Label>
          
          {otherSystems.map((system) => (
            <div key={system.originalIndex} className="flex items-center gap-2">
              <Input
                value={system.other_description || ''}
                onChange={(e) => handleUpdateOther(system.originalIndex, e.target.value)}
                placeholder="Enter custom operating system name"
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => handleRemoveOther(system.originalIndex)}
                className="text-destructive hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddOther}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Custom Operating System
          </Button>
        </div>
        
        <SectionComments
          value={sectionComments}
          onChange={onSectionCommentsChange}
          onBlur={onSectionCommentsBlur}
          placeholder="Add notes about operating systems, specific configurations, or special considerations..."
          label="Systems Notes"
        />
      </CardContent>
    </Card>
  );
});

export default OperatingSystemsSection;
