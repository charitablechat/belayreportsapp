import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";

interface OperatingSystemsSectionProps {
  systems: any[];
  onUpdate: (systems: any[]) => void;
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

export default function OperatingSystemsSection({ systems, onUpdate }: OperatingSystemsSectionProps) {
  const [otherDescription, setOtherDescription] = useState(
    systems.find(s => s.system_name === 'Other')?.other_description || ''
  );

  const handleToggle = (systemName: string, checked: boolean) => {
    if (checked) {
      onUpdate([...systems, {
        id: crypto.randomUUID(),
        system_name: systemName,
        other_description: systemName === 'Other' ? otherDescription : null,
        created_at: new Date().toISOString()
      }]);
    } else {
      onUpdate(systems.filter(s => s.system_name !== systemName));
    }
  };

  const handleOtherDescriptionChange = (value: string) => {
    setOtherDescription(value);
    const otherSystem = systems.find(s => s.system_name === 'Other');
    if (otherSystem) {
      onUpdate(systems.map(s => 
        s.system_name === 'Other' 
          ? { ...s, other_description: value }
          : s
      ));
    }
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
              checked={systems.some(s => s.system_name === system)}
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
        
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="system-Other"
              checked={systems.some(s => s.system_name === 'Other')}
              onCheckedChange={(checked) => handleToggle('Other', checked as boolean)}
            />
            <Label
              htmlFor="system-Other"
              className="text-sm font-normal cursor-pointer"
            >
              Other
            </Label>
          </div>
          {systems.some(s => s.system_name === 'Other') && (
            <Input
              placeholder="Please specify other operating system"
              value={otherDescription}
              onChange={(e) => handleOtherDescriptionChange(e.target.value)}
              className="ml-6"
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
