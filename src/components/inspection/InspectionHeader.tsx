import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface InspectionHeaderProps {
  inspection: any;
  userProfile: any;
  onUpdate: (field: string, value: string) => void;
  onImmediateSave?: () => void;
}

export default function InspectionHeader({ inspection, userProfile, onUpdate, onImmediateSave }: InspectionHeaderProps) {
  const inspectorName = userProfile?.first_name && userProfile?.last_name
    ? `${userProfile.first_name} ${userProfile.last_name}`
    : 'Current User';
  const renderField = (label: string, field: string, value: string, type: string = "text", isTextarea: boolean = false) => {
    return (
      <div>
        <Label className="text-sm text-muted-foreground">{label}</Label>
        {isTextarea ? (
          <Textarea
            value={value || ""}
            onChange={(e) => onUpdate(field, e.target.value)}
            onBlur={onImmediateSave}
            className="min-h-[100px]"
            placeholder={`Enter ${label.toLowerCase()}...`}
          />
        ) : (
          <Input
            type={type}
            value={value || ""}
            onChange={(e) => onUpdate(field, e.target.value)}
            onBlur={onImmediateSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onImmediateSave?.();
              }
            }}
            placeholder={`Enter ${label.toLowerCase()}...`}
          />
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
      <h1 className="text-xl md:text-2xl font-bold mb-2 px-2 md:px-0">
        Inspection Report for Challenge Course, Adventure Park or Canopy/Zip Line Tour
      </h1>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mb-6">
            <div className="space-y-4">
              <div>
                <Label className="text-sm text-muted-foreground">Inspector</Label>
                <Input
                  value={inspectorName}
                  disabled
                  className="bg-muted/50 cursor-not-allowed"
                />
              </div>
              {renderField("Facility Name", "organization", inspection?.organization)}
              {renderField("Location", "location", inspection?.location)}
              {renderField("Onsite Contact", "onsite_contact", inspection?.onsite_contact)}
              {renderField("Previous Inspector", "previous_inspector", inspection?.previous_inspector)}
            </div>
            <div className="space-y-4">
              {renderField("ACCT#", "acct_number", inspection?.acct_number)}
              {renderField("Inspection Date", "inspection_date", inspection?.inspection_date, "date")}
              {renderField("Prev. Inspection Date", "previous_inspection_date", inspection?.previous_inspection_date, "date")}
            </div>
          </div>

          <div className="mb-6">
            {renderField("Known Course History", "course_history", inspection?.course_history, "text", true)}
          </div>

          <div className="border-l-4 border-primary pl-4 mb-6">
            <h3 className="font-semibold mb-2">Inspection Overview</h3>
            <p className="text-sm text-muted-foreground">
              This comprehensive inspection covers all challenge course elements, zip lines, and related safety equipment. 
              The inspection follows ACCT (Association for Challenge Course Technology) standards and manufacturer guidelines. 
              All equipment must meet current safety standards and be properly maintained.
            </p>
          </div>

          <div className="mb-6">
            <h3 className="font-semibold mb-3">Inspection Categories</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-start gap-2">
                <div className="w-2 h-2 rounded-full bg-primary mt-1.5" />
                <div>
                  <p className="font-medium text-sm">Lifeline Hardware</p>
                  <p className="text-xs text-muted-foreground">Cables, connections, and support systems</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-2 h-2 rounded-full bg-primary mt-1.5" />
                <div>
                  <p className="font-medium text-sm">Activity Hardware</p>
                  <p className="text-xs text-muted-foreground">Element-specific components</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-2 h-2 rounded-full bg-primary mt-1.5" />
                <div>
                  <p className="font-medium text-sm">Environment</p>
                  <p className="text-xs text-muted-foreground">Surrounding area and structures</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-2 h-2 rounded-full bg-primary mt-1.5" />
                <div>
                  <p className="font-medium text-sm">Pass/Fail Assessment</p>
                  <p className="text-xs text-muted-foreground">Overall safety rating</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg">
            <h3 className="font-semibold mb-2 text-sm">📋 Important Notes</h3>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>• All equipment must be inspected before each use</li>
              <li>• Follow manufacturer specifications for all components</li>
              <li>• Record detailed comments for any concerns or observations</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
