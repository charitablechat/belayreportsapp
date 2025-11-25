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
        <div className="text-sm text-muted-foreground space-y-2 mb-6 p-4 bg-muted/50 rounded-lg border">
          <p className="leading-relaxed">
            It is the responsibility of the client to read, understand, and follow all
            manufacturer guidelines, notices and recalls for the equipment used for your
            site's operations. This includes proper documentation and inventory tracking of
            each item used for course operations. This should be done according to a written
            checklist that is monitored by the course manager or other qualified person at
            your site. Records should be available at your annual inspection that include and
            indicate the date of purchase, date of first use and the equipment shall be
            identifiable by the serial number/tag or other unique identifier that matches your
            written documentation and the manufacturer retirement criteria.
          </p>
          <p className="font-semibold text-foreground">
            CHECK ONLY THOSE THAT WERE VERIFIABLE AND IN PLACE DURING TRAINING.
          </p>
        </div>

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
