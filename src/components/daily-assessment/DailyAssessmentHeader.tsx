import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { OrganizationAutocomplete } from "@/components/OrganizationAutocomplete";

interface DailyAssessmentHeaderProps {
  assessment: any;
  onUpdate: (field: string, value: any) => void;
}

export default function DailyAssessmentHeader({ assessment, onUpdate }: DailyAssessmentHeaderProps) {
  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="assessment-date">Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !assessment.assessment_date && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {assessment.assessment_date ? (
                    format(new Date(assessment.assessment_date), "PPP")
                  ) : (
                    <span>Pick a date</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={assessment.assessment_date ? new Date(assessment.assessment_date) : undefined}
                  onSelect={(date) => onUpdate("assessment_date", date ? format(date, "yyyy-MM-dd") : null)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          <div>
            <Label htmlFor="site">Site</Label>
            <OrganizationAutocomplete
              value={assessment.site}
              onChange={(value) => onUpdate("site", value)}
            />
          </div>

          <div className="md:col-span-2">
            <Label htmlFor="trainer-of-record">Trainer/Facilitator of Record</Label>
            <Input
              id="trainer-of-record"
              value={assessment.trainer_of_record || ''}
              onChange={(e) => onUpdate("trainer_of_record", e.target.value)}
              placeholder="Enter trainer name"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
