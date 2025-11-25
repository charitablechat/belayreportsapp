import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface DeliveryApproachSectionProps {
  approaches: any[];
  onUpdate: (approaches: any[]) => void;
}

const DELIVERY_APPROACHES = [
  'Facilitated',
  'Guided',
  'Self-Guided'
];

export default function DeliveryApproachSection({ approaches, onUpdate }: DeliveryApproachSectionProps) {
  const handleToggle = (approach: string, checked: boolean) => {
    if (checked) {
      onUpdate([...approaches, {
        id: crypto.randomUUID(),
        approach,
        created_at: new Date().toISOString()
      }]);
    } else {
      onUpdate(approaches.filter(a => a.approach !== approach));
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
}
