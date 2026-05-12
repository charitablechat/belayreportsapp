import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { OrganizationAutocomplete } from "@/components/OrganizationAutocomplete";
import { GlobalAutocomplete } from "@/components/GlobalAutocomplete";
import { parseLocalDate } from "@/lib/date-utils";
import { Input } from "@/components/ui/input";

interface DailyAssessmentHeaderProps {
  assessment: any;
  onUpdate: (field: string, value: any) => void;
  isReadOnly?: boolean;
  userProfile?: { first_name?: string; last_name?: string } | null;
  modifiedByProfile?: { first_name?: string; last_name?: string } | null;
  /**
   * Header field keys (e.g. 'organization', 'assessment_date') the user
   * tried to "Complete" without filling. Drives the .field-invalid pulse
   * + aria-invalid on the offending input. See src/lib/required-fields.ts.
   */
  missingFieldKeys?: string[];
}

export default function DailyAssessmentHeader({ assessment, onUpdate, isReadOnly = false, userProfile, modifiedByProfile, missingFieldKeys = [] }: DailyAssessmentHeaderProps) {
  const isMissing = (key: string) => missingFieldKeys.includes(key);
  const missingRing = "field-invalid p-2";

  // Build trainer name from the original owner's profile
  const trainerName = userProfile?.first_name && userProfile?.last_name
    ? `${userProfile.first_name} ${userProfile.last_name}`
    : null;
  
  // Build modified by name if different from owner
  const modifiedByName = modifiedByProfile?.first_name && modifiedByProfile?.last_name
    ? `${modifiedByProfile.first_name} ${modifiedByProfile.last_name}`
    : null;

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div
            id="field-assessment_date"
            aria-invalid={isMissing('assessment_date') || undefined}
            className={cn(isMissing('assessment_date') && missingRing)}
          >
            <Label htmlFor="assessment-date">Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    isReadOnly && "bg-muted/50 cursor-not-allowed",
                    !assessment.assessment_date && "text-muted-foreground"
                  )}
                  disabled={isReadOnly}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {assessment.assessment_date ? (
                    format(parseLocalDate(assessment.assessment_date)!, "PPP")
                  ) : (
                    <span>Pick a date</span>
                  )}
                </Button>
              </PopoverTrigger>
              {!isReadOnly && (
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={assessment.assessment_date ? parseLocalDate(assessment.assessment_date) : undefined}
                    onSelect={(date) => onUpdate("assessment_date", date ? format(date, 'yyyy-MM-dd') : '')}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              )}
            </Popover>
          </div>

          <div>
            <Label htmlFor="site">Site</Label>
            <OrganizationAutocomplete
              value={assessment.site}
              onChange={(value) => onUpdate("site", value)}
              disabled={isReadOnly}
            />
          </div>

          <div
            id="field-organization"
            aria-invalid={isMissing('organization') || undefined}
            className={cn(isMissing('organization') && missingRing)}
          >
            <Label htmlFor="organization">Organization</Label>
            <OrganizationAutocomplete
              value={assessment.organization || ''}
              onChange={(value) => onUpdate("organization", value)}
              disabled={isReadOnly}
            />
          </div>

          <div>
            <Label className="text-sm text-muted-foreground">Trainer/Facilitator of Record</Label>
            <Input
              value={assessment.trainer_of_record || 'Not Set'}
              disabled
              className="bg-muted/50 cursor-not-allowed"
            />
          </div>
          
          {/* Show "Report modified by" when a Super Admin has edited this report */}
          {modifiedByName && (
            <div className="md:col-span-2">
              <Label className="text-sm text-muted-foreground">Report modified by</Label>
              <Input
                value={modifiedByName}
                disabled
                className="bg-muted/50 cursor-not-allowed"
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
