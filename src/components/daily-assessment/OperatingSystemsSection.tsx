import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { FormSection } from "@/hooks/useFormConfiguration";

interface OperatingSystemsSectionProps {
  section: FormSection;
  systems: any[];
  onUpdate: (systems: any[]) => void;
}

export default function OperatingSystemsSection({ section, systems, onUpdate }: OperatingSystemsSectionProps) {
  const handleToggle = (systemName: string) => {
    const exists = systems.some(s => s.system_name === systemName);
    
    if (exists) {
      onUpdate(systems.filter(s => s.system_name !== systemName));
    } else {
      onUpdate([...systems, { system_name: systemName }]);
    }
  };

  const fields = section.fields || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{section.label || 'Operating Systems in Use Today'}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {fields.map((field) => (
            <div key={field.field_key} className="flex items-center space-x-2">
              <Checkbox
                id={field.field_key}
                checked={systems.some(s => s.system_name === field.field_key)}
                onCheckedChange={() => handleToggle(field.field_key)}
              />
              <Label htmlFor={field.field_key} className="text-sm font-normal cursor-pointer">
                {field.label}
              </Label>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
