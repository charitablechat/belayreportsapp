import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VoiceNameInput } from "@/components/ui/voice-name-input";
import { Label } from "@/components/ui/label";
import { VoiceNameTextarea } from "@/components/ui/voice-name-textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { OrganizationAutocomplete } from "@/components/OrganizationAutocomplete";
import { Input } from "@/components/ui/input";

interface TrainingHeaderProps {
  training: any;
  onUpdate: (field: string, value: any) => void;
  isReadOnly?: boolean;
  userProfile?: { first_name?: string; last_name?: string } | null;
  modifiedByProfile?: { first_name?: string; last_name?: string } | null;
  /**
   * Required-field gate keys; see src/lib/required-fields.ts.
   */
  missingFieldKeys?: string[];
}

// Parse date string as local time to avoid timezone shifting
const parseLocalDate = (dateStr: string | null | undefined) => {
  if (!dateStr) return undefined;
  // Handle dates that might already include time component
  const dateOnly = dateStr.split('T')[0];
  const [year, month, day] = dateOnly.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export default function TrainingHeader({ training, onUpdate, isReadOnly = false, userProfile, modifiedByProfile, missingFieldKeys = [] }: TrainingHeaderProps) {
  const isMissing = (key: string) => missingFieldKeys.includes(key);
  const missingRing = "animate-pulse ring-2 ring-destructive ring-offset-2 rounded-md p-2";

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
      <CardHeader>
        <CardTitle>Training Information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="organization">Training Site (Name of facility, city, state) *</Label>
          <OrganizationAutocomplete
            value={training.organization || ''}
            onChange={(value) => onUpdate('organization', value)}
            disabled={isReadOnly}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="location">Location</Label>
          <VoiceNameInput
            id="location"
            value={training.location || ''}
            onValueChange={(value) => onUpdate('location', value)}
            onChange={(e) => onUpdate('location', e.target.value)}
            placeholder="e.g. Camp Thunderbird, Lake Wylie, SC"
            disabled={isReadOnly}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Start Date *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    isReadOnly && "bg-muted/50 cursor-not-allowed",
                    !training.start_date && "text-muted-foreground"
                  )}
                  disabled={isReadOnly}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {training.start_date ? format(parseLocalDate(training.start_date)!, "PPP") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              {!isReadOnly && (
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={parseLocalDate(training.start_date)}
                    onSelect={(date) => onUpdate('start_date', date ? format(date, 'yyyy-MM-dd') : '')}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              )}
            </Popover>
          </div>

          <div className="space-y-2">
            <Label>End Date *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !training.end_date && "text-muted-foreground"
                  )}
                  disabled={isReadOnly}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {training.end_date ? format(parseLocalDate(training.end_date)!, "PPP") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              {!isReadOnly && (
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={parseLocalDate(training.end_date)}
                  onSelect={(date) => onUpdate('end_date', date ? format(date, 'yyyy-MM-dd') : '')}
                  initialFocus
                  className="pointer-events-auto"
                />
              </PopoverContent>
              )}
            </Popover>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-sm text-muted-foreground">Trainer(s) of Record</Label>
          <Input
            value={training.trainer_of_record || 'Not Set'}
            disabled
            className="bg-muted/50 cursor-not-allowed"
          />
        </div>
        
        {/* Show "Report modified by" when a Super Admin has edited this report */}
        {modifiedByName && (
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Report modified by</Label>
            <Input
              value={modifiedByName}
              disabled
              className="bg-muted/50 cursor-not-allowed"
            />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="trainee_names">Trainee Name(s)</Label>
          <VoiceNameTextarea
            id="trainee_names"
            value={training.trainee_names || ''}
            onChange={(e) => onUpdate('trainee_names', e.target.value)}
            placeholder="Enter trainee names (one per line, voice extracts names only)"
            rows={4}
            disabled={isReadOnly}
          />
        </div>

        <p className="text-sm text-muted-foreground pt-2">
          Rope Works Inc. completed a site visit for training and operations on the above date(s). 
          LISTED BELOW are the operating systems on your site we trained or reviewed in accordance with 
          Rope Works Inc. operational procedures and the Association for Challenge Course Technology (ACCT) 
          operational and training standards. Standards applied include ANSI/ACCT 03-2016 and ANSI/ACCT 03-2019.
        </p>
      </CardContent>
    </Card>
  );
}