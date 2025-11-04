import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

interface InspectionHeaderProps {
  inspection: any;
}

export default function InspectionHeader({ inspection }: InspectionHeaderProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-2">
          Inspection Report for Challenge Course, Adventure Park or Canopy/Zip Line Tour
        </h1>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 gap-6 mb-6">
            <div className="space-y-4">
              <div>
                <Label className="text-sm text-muted-foreground">Facility Name</Label>
                <p className="font-medium">{inspection?.organization}</p>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Location</Label>
                <p className="font-medium">{inspection?.location}</p>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Onsite Contact</Label>
                <p className="font-medium">{inspection?.onsite_contact || "N/A"}</p>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <Label className="text-sm text-muted-foreground">Inspection Date</Label>
                <p className="font-medium">
                  {new Date(inspection?.inspection_date).toLocaleDateString()}
                </p>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Previous Inspector</Label>
                <p className="font-medium">{inspection?.previous_inspector || "N/A"}</p>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Prev. Inspection Date</Label>
                <p className="font-medium">
                  {inspection?.previous_inspection_date 
                    ? new Date(inspection.previous_inspection_date).toLocaleDateString()
                    : "N/A"}
                </p>
              </div>
            </div>
          </div>

          {inspection?.course_history && (
            <div className="mb-6">
              <Label className="text-sm font-semibold mb-2 block">Known Course History</Label>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {inspection.course_history}
              </p>
            </div>
          )}

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
