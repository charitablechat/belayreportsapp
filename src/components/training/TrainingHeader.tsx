import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { OrganizationAutocomplete } from "@/components/OrganizationAutocomplete";

interface TrainingHeaderProps {
  training: any;
  onUpdate: (field: string, value: any) => void;
}

export default function TrainingHeader({ training, onUpdate }: TrainingHeaderProps) {
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
                    !training.start_date && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {training.start_date ? format(new Date(training.start_date), "PPP") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={training.start_date ? new Date(training.start_date) : undefined}
                  onSelect={(date) => onUpdate('start_date', date ? format(date, 'yyyy-MM-dd') : '')}
                  initialFocus
                />
              </PopoverContent>
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
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {training.end_date ? format(new Date(training.end_date), "PPP") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={training.end_date ? new Date(training.end_date) : undefined}
                  onSelect={(date) => onUpdate('end_date', date ? format(date, 'yyyy-MM-dd') : '')}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="trainer_of_record">Trainer(s) of Record</Label>
          <Input
            id="trainer_of_record"
            value={training.trainer_of_record || ''}
            onChange={(e) => onUpdate('trainer_of_record', e.target.value)}
            placeholder="Enter trainer names"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="trainee_names">Trainee Name(s)</Label>
          <Textarea
            id="trainee_names"
            value={training.trainee_names || ''}
            onChange={(e) => onUpdate('trainee_names', e.target.value)}
            placeholder="Enter trainee names (one per line)"
            rows={4}
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
