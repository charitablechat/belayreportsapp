import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { X, Plus } from "lucide-react";
import { triggerHaptic } from "@/lib/haptics";

interface OperatingSystemsSectionProps {
  systems: any[];
  onUpdate: (systems: any[] | ((prev: any[]) => any[])) => void;
}

const OPERATING_SYSTEMS = [
  'Spotting/Low Course',
  'Personal Fall Arrest System',
  'Tensioned Rope System/Swing',
  'Tensioned Rope System/Zip Line',
  'Tensioned Rope System/Flying Squirrel',
  'Tensioned Rope System/4:1',
  'Travel Restraint System',
  'Automated Safety System/Auto Belay',
  'Automated Safety System/Free Fall',
  'Automated Safety System/Zip line Brake',
  'Collective Safety System',
  'Top Rope Belay System',
  'Limited Fall System',
  'Positioning System/Grillon',
  'Tensioned Rope System/Rappel',
  'Aerial Leap',
  'Hydraulic Zip Line'
];

import React from "react";

const OperatingSystemsSection = React.memo(function OperatingSystemsSection({ systems, onUpdate }: OperatingSystemsSectionProps) {
  const otherEntries = systems.filter(s => s.system_name === 'Other');
  const predefinedSystems = systems.filter(s => s.system_name !== 'Other');

  const handleToggle = (systemName: string, checked: boolean) => {
    triggerHaptic('light');
    if (checked) {
    onUpdate([{
      id: crypto.randomUUID(),
      system_name: systemName,
      other_description: null,
      created_at: new Date().toISOString()
    }, ...systems]);
    } else {
      onUpdate((prev: any[]) => prev.filter(s => s.system_name !== systemName));
    }
  };

  const handleAddOther = () => {
    triggerHaptic('light');
    const newEntry = {
      id: crypto.randomUUID(),
      system_name: 'Other',
      other_description: '',
      created_at: new Date().toISOString()
    };
    onUpdate([newEntry, ...systems]);
  };

  const handleUpdateOther = (id: string, value: string) => {
    onUpdate(systems.map(s => 
      s.id === id ? { ...s, other_description: value } : s
    ));
  };

  const handleRemoveOther = (id: string) => {
    triggerHaptic('light');
    onUpdate((prev: any[]) => prev.filter(s => s.id !== id));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Operating Systems</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {OPERATING_SYSTEMS.map((system) => (
          <div key={system} className="flex items-center space-x-2">
            <Checkbox
              id={`system-${system}`}
              checked={predefinedSystems.some(s => s.system_name === system)}
              onCheckedChange={(checked) => handleToggle(system, checked as boolean)}
            />
            <Label
              htmlFor={`system-${system}`}
              className="text-sm font-normal cursor-pointer"
            >
              {system}
            </Label>
          </div>
        ))}
        
        {otherEntries.length > 0 && (
          <div className="space-y-2 pt-2">
            <Label className="text-sm font-medium">Custom Operating Systems:</Label>
            {otherEntries.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2">
                <Input
                  placeholder="Describe custom operating system..."
                  value={entry.other_description || ''}
                  onChange={(e) => handleUpdateOther(entry.id, e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveOther(entry.id)}
                  className="shrink-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
        
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
      </CardContent>
    </Card>
  );
});

export default OperatingSystemsSection;
