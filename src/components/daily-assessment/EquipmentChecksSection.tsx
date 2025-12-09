import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { VoiceTextarea } from "@/components/ui/voice-textarea";
import { FormSection } from "@/hooks/useFormConfiguration";
import { triggerHaptic } from "@/lib/haptics";

interface EquipmentChecksSectionProps {
  section: FormSection;
  checks: any[];
  onUpdate: (checks: any[]) => void;
}

export default function EquipmentChecksSection({ section, checks, onUpdate }: EquipmentChecksSectionProps) {
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
      onUpdate([...checks, { item_key: itemKey, is_checked: true, comments: '' }]);
    }
  };

  const handleCommentChange = (itemKey: string, comments: string) => {
    const existingCheck = checks.find(c => c.item_key === itemKey);
    
    if (existingCheck) {
      onUpdate(checks.map(c => 
        c.item_key === itemKey 
          ? { ...c, comments }
          : c
      ));
    } else {
      onUpdate([...checks, { item_key: itemKey, is_checked: false, comments }]);
    }
  };

  const fields = section.fields || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pre Use Inspection Equipment/Check all that apply</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {fields.map((field) => {
          const existingCheck = checks.find(c => c.item_key === field.field_key);
          return (
            <div key={field.field_key} className="space-y-2 border-b pb-4 last:border-b-0">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={field.field_key}
                  checked={existingCheck?.is_checked || false}
                  onCheckedChange={() => handleToggle(field.field_key)}
                />
                <Label htmlFor={field.field_key} className="text-sm font-normal cursor-pointer">
                  {field.label}
                </Label>
              </div>
              <VoiceTextarea
                placeholder={field.placeholder || "Comments (optional)"}
                value={existingCheck?.comments || ''}
                onChange={(e) => handleCommentChange(field.field_key, e.target.value)}
                className="text-sm"
                rows={2}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
