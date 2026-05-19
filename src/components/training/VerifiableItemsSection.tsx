import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { triggerHaptic } from "@/lib/haptics";

interface VerifiableItemsSectionProps {
  items: any[];
  onUpdate: (items: any[] | ((prev: any[]) => any[])) => void;
  systemsInPlace: any[];
  onUpdateSystemsInPlace: (items: any[] | ((prev: any[]) => any[])) => void;
}

const VERIFIABLE_ITEMS = [
  'At the time of training the site had a written pre use inspection for each operating system',
  'At the time of training the site had a written pre use inspection for equipment',
  'At the time of training, the site had proper documentation for equipment (tracking of inventory, date of first use, retirement criteria)',
  'Unable to check any of the above at the time of this report'
];

const SYSTEMS_IN_PLACE = [
  'A system for conducting and documenting a periodic internal monitoring of the course, surrounding environment, and equipment',
  'A system in place for incident documentation',
  'A system in place to inform participants of the inherent and other risks associated with participation',
  'A system in place for assessing and confirming activity corridors are clear of obstructions',
  'A system in place to engage a qualified person to review the site\'s risk management and program quality every five years. (CHPT 2 ANSI/ACCT B.2.7)',
  'Unable to check any of the above at this time'
];

import React from "react";

const VerifiableItemsSection = React.memo(function VerifiableItemsSection({ items, onUpdate, systemsInPlace, onUpdateSystemsInPlace }: VerifiableItemsSectionProps) {
  const handleToggle = (item: string, checked: boolean) => {
    triggerHaptic('light');
    if (checked) {
      onUpdate([{
        id: crypto.randomUUID(),
        item,
        created_at: new Date().toISOString()
      }, ...items]);
    } else {
      onUpdate((prev: any[]) => prev.filter(i => i.item !== item));
    }
  };

  const handleSystemToggle = (systemItem: string, checked: boolean) => {
    triggerHaptic('light');
    if (checked) {
      onUpdateSystemsInPlace([{
        id: crypto.randomUUID(),
        system_item: systemItem,
        created_at: new Date().toISOString()
      }, ...systemsInPlace]);
    } else {
      onUpdateSystemsInPlace((prev: any[]) => prev.filter(i => i.system_item !== systemItem));
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

        <div className="text-sm text-muted-foreground space-y-2 mt-6 mb-4 p-4 bg-muted/50 rounded-lg border">
          <p className="font-semibold text-foreground">
            Check ONLY if the following are in place:
          </p>
          <p className="leading-relaxed">
            The following were either addressed in discussion with training participants or a
            staff supervisor. We recommend following up to address any unchecked areas.
          </p>
        </div>

        {SYSTEMS_IN_PLACE.map((item) => (
          <div key={item} className="flex items-start space-x-2">
            <Checkbox
              id={`system-place-${item}`}
              checked={systemsInPlace.some(i => i.system_item === item)}
              onCheckedChange={(checked) => handleSystemToggle(item, checked as boolean)}
              className="mt-0.5"
            />
            <Label
              htmlFor={`system-place-${item}`}
              className="text-sm font-normal cursor-pointer leading-tight"
            >
              {item}
            </Label>
          </div>
        ))}
      </CardContent>
    </Card>
  );
});

export default VerifiableItemsSection;
