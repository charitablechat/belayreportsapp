import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { VoiceTextarea } from "@/components/ui/voice-textarea";
import { FormSection } from "@/hooks/useFormConfiguration";

interface BeginningOfDaySectionProps {
  section: FormSection;
  items: any[];
  onUpdate: (items: any[]) => void;
}

export default function BeginningOfDaySection({ section, items, onUpdate }: BeginningOfDaySectionProps) {
  const handleToggle = (itemKey: string) => {
    const existingItem = items.find(i => i.item_key === itemKey);
    
    if (existingItem) {
      onUpdate(items.map(i => 
        i.item_key === itemKey 
          ? { ...i, is_complete: !i.is_complete }
          : i
      ));
    } else {
      onUpdate([...items, { item_key: itemKey, is_complete: true, comments: '' }]);
    }
  };

  const handleCommentChange = (itemKey: string, comments: string) => {
    const existingItem = items.find(i => i.item_key === itemKey);
    
    if (existingItem) {
      onUpdate(items.map(i => 
        i.item_key === itemKey 
          ? { ...i, comments }
          : i
      ));
    } else {
      onUpdate([...items, { item_key: itemKey, is_complete: false, comments }]);
    }
  };

  const fields = section.fields || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{section.label || 'Beginning of Day Checklist'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {fields.map((field) => {
          const existingItem = items.find(i => i.item_key === field.field_key);
          return (
            <div key={field.field_key} className="space-y-2 border-b pb-4 last:border-b-0">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={field.field_key}
                  checked={existingItem?.is_complete || false}
                  onCheckedChange={() => handleToggle(field.field_key)}
                />
                <Label htmlFor={field.field_key} className="text-sm font-normal cursor-pointer">
                  {field.label}
                </Label>
              </div>
              <VoiceTextarea
                placeholder={field.placeholder || "Comments (optional)"}
                value={existingItem?.comments || ''}
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
