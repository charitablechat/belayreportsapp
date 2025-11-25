import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface VerifiableItemsSectionProps {
  items: any[];
  onUpdate: (items: any[]) => void;
}

const VERIFIABLE_ITEMS = [
  'At the time of training the site had a written pre use inspection for each operating system',
  'At the time of training the site had a written pre use inspection for equipment',
  'At the time of training, the site had proper documentation for equipment (tracking of inventory, date of first use, retirement criteria)',
  'Unable to check any of the above at the time of this report'
];

export default function VerifiableItemsSection({ items, onUpdate }: VerifiableItemsSectionProps) {
  const handleToggle = (item: string, checked: boolean) => {
    if (checked) {
      onUpdate([...items, {
        id: crypto.randomUUID(),
        item,
        created_at: new Date().toISOString()
      }]);
    } else {
      onUpdate(items.filter(i => i.item !== item));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verifiable Items During Training</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {VERIFIABLE_ITEMS.map((item) => (
          <div key={item} className="flex items-start space-x-2">
            <Checkbox
              id={`verifiable-${item}`}
              checked={items.some(i => i.item === item)}
              onCheckedChange={(checked) => handleToggle(item, checked as boolean)}
              className="mt-0.5"
            />
            <Label
              htmlFor={`verifiable-${item}`}
              className="text-sm font-normal cursor-pointer leading-tight"
            >
              {item}
            </Label>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
