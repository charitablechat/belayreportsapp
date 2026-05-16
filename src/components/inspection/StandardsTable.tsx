import { memo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { triggerHaptic } from "@/lib/haptics";

interface StandardsTableProps {
  standards: any[];
  onUpdate: (next: any[] | ((prev: any[]) => any[])) => void;
  onImmediateSave?: () => void;
}

const STANDARDS_LIST = [
  { name: "Local Written Operations Procedures", reference: "(CHPT 2. ANSI/ACCT B.2.4)" },
  { name: "Local Written Emergency Action Plan", reference: "(CHPT 2 ANSI/ACCT B.2.5)" },
  { name: "Minimum Annual Training", reference: "(CHPT 3 ANSI/ACCT B.1.2)" },
  { name: "Written Pre-Use Inspection in Use", reference: "(CHPT 2 ANSI/ACCT B.2.13)" },
  { name: "Inventory Tracking System in Use", reference: "(CHPT 1 ANSI/ACCT I.3.2.1)" },
  { name: "Operational Review Every 5 Years", reference: "(CHPT 2 ANSI/ACCT B.2.7)" },
];

function StandardsTable({ standards, onUpdate, onImmediateSave }: StandardsTableProps) {
  const saveScheduledRef = useRef(false);
  const scheduleSave = () => {
    if (saveScheduledRef.current) return;
    saveScheduledRef.current = true;
    queueMicrotask(() => {
      saveScheduledRef.current = false;
      onImmediateSave?.();
    });
  };

  const updateStandard = (index: number, has_documentation: boolean | null) => {
    triggerHaptic('light');
    const inspectionId = window.location.pathname.split('/').pop();
    onUpdate(prev => {
      const updated = [...prev];
      const existing = updated[index] || {};
      updated[index] = {
        ...existing,
        id: existing.id || crypto.randomUUID(),
        inspection_id: inspectionId,
        standard_name: STANDARDS_LIST[index].name,
        has_documentation,
      };
      return updated;
    });
    scheduleSave();
  };

  // Handle YES checkbox: toggle between true and null
  const handleYesChange = (index: number, checked: boolean) => {
    updateStandard(index, checked ? true : null);
  };

  // Handle NO checkbox: toggle between false and null
  const handleNoChange = (index: number, checked: boolean) => {
    updateStandard(index, checked ? false : null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>ACCT Operations Standards Criteria</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 text-sm text-muted-foreground">
          <p>
            The following documentation is currently required by the ANSI/ACCT 03-2019 Operations Standards. 
            If your program does not have the following in existence it is noted below. It is your responsibility 
            to ensure these are located or created and available. If these documents have been made available 
            during the professional inspection it is noted below. It is important to recognize these documents 
            are not reviewed by the professional inspector for content. They are only verified of their existence 
            for program operations.
          </p>
        </div>

        {/* Desktop table view */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-blue-50 dark:bg-blue-950/20">
                <th className="border p-3 text-left font-semibold text-sm">Document</th>
                <th className="border p-3 text-center font-semibold text-sm w-20">YES</th>
                <th className="border p-3 text-center font-semibold text-sm w-20">NO</th>
              </tr>
            </thead>
            <tbody>
              {STANDARDS_LIST.map((standard, index) => {
                const standardData = standards[index] || { has_documentation: null };
                return (
                  <tr key={index} className="hover:bg-muted/50">
                    <td className="border p-3">
                      <div>
                        <p className="font-medium">{standard.name}</p>
                        <p className="text-xs text-muted-foreground">{standard.reference}</p>
                      </div>
                    </td>
                    <td className="border p-3 text-center">
                      <Checkbox
                        checked={standardData.has_documentation === true}
                        onCheckedChange={(checked) => handleYesChange(index, checked as boolean)}
                      />
                    </td>
                    <td className="border p-3 text-center">
                      <Checkbox
                        checked={standardData.has_documentation === false}
                        onCheckedChange={(checked) => handleNoChange(index, checked as boolean)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {/* Mobile card view */}
        <div className="md:hidden space-y-4">
          {STANDARDS_LIST.map((standard, index) => {
            const standardData = standards[index] || { has_documentation: null };
            return (
              <Card key={index} className="p-4">
                <div className="space-y-3">
                  <div>
                    <p className="font-medium">{standard.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">{standard.reference}</p>
                  </div>
                  
                  <div className="flex items-center justify-between pt-2 flex-wrap gap-2">
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`standard-yes-${index}`}
                          checked={standardData.has_documentation === true}
                          onCheckedChange={(checked) => handleYesChange(index, checked as boolean)}
                        />
                        <Label htmlFor={`standard-yes-${index}`} className="text-sm cursor-pointer">
                          Yes
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`standard-no-${index}`}
                          checked={standardData.has_documentation === false}
                          onCheckedChange={(checked) => handleNoChange(index, checked as boolean)}
                        />
                        <Label htmlFor={`standard-no-${index}`} className="text-sm cursor-pointer">
                          No
                        </Label>
                      </div>
                    </div>
                    {standardData.has_documentation === false && (
                      <Badge variant="destructive" className="text-xs shrink-0">Missing</Badge>
                    )}
                    {standardData.has_documentation === null && (
                      <Badge variant="outline" className="text-xs shrink-0">Not Set</Badge>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        <div className="mt-6 text-xs text-muted-foreground border-t pt-4">
          <p className="mb-2">
            <strong>Comments:</strong> A QCP is a Qualified Course Professional that meets the criteria outlined by the ACCT. 
            Operations & Emergency procedures must be written and specific to the site's local operations procedures.
          </p>
          <p>
            The information contained in this report has been documented by a Qualified Professional. 
            This report is effective for one year from the date of inspection. Issued by: 
            Rope Works Inc., PO Box 1074, Dripping Springs, TX 78620
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
