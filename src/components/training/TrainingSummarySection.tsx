import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { DebouncedVoiceInput } from "@/components/ui/debounced-voice-input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { parseLocalYmd } from "@/lib/date-utils";
import { VoiceRichTextEditor } from "@/components/ui/voice-rich-text-editor";

interface TrainingSummarySectionProps {
  summary: any;
  onUpdate: (field: string, value: any) => void;
  onImmediateSave?: () => void;
}

import React from "react";

const TrainingSummarySection = React.memo(function TrainingSummarySection({ summary, onUpdate, onImmediateSave }: TrainingSummarySectionProps) {
  return (
    <Card data-form-section="training-summary">
      <CardHeader>
        <CardTitle>Training Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Training Observations</Label>
          <p className="text-sm text-muted-foreground">
            This area lists/describes any observations at the time of training pertaining to staff, equipment function, or operations:
          </p>
          <VoiceRichTextEditor
            content={summary?.observations || ''}
            onChange={(value) => onUpdate('observations', value)}
            onBlur={onImmediateSave}
            placeholder="Enter your observations here..."
          />
        </div>

        <div className="space-y-2">
          <Label>Training Recommendations</Label>
          <p className="text-sm text-muted-foreground">
            This area lists recommendations from the trainer after visiting your site regarding staff, equipment function, or operations:
          </p>
          <VoiceRichTextEditor
            content={summary?.recommendations || ''}
            onChange={(value) => onUpdate('recommendations', value)}
            onBlur={onImmediateSave}
            placeholder="Enter your recommendations here..."
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="person_submitting">PERSON SUBMITTING FORM</Label>
          <p className="text-sm text-muted-foreground">
            The trainer listed on this report verifies the report is complete and ready for client submission on the following date.
          </p>
          <DebouncedVoiceInput
            id="person_submitting"
            value={summary?.person_submitting || ''}
            onChange={(value) => onUpdate('person_submitting', value)}
            onBlur={onImmediateSave}
            placeholder="Enter name"
          />
        </div>

        <div className="space-y-2">
          <Label>Submission Date</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !summary?.submission_date && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {(() => {
                  const parsed = parseLocalYmd(summary?.submission_date);
                  return parsed ? format(parsed, "PPP") : "Pick a date";
                })()}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar
                mode="single"
                selected={parseLocalYmd(summary?.submission_date)}
                onSelect={(date) => {
                  onUpdate('submission_date', date ? format(date, 'yyyy-MM-dd') : '');
                  // Defer flush so the onUpdate state write commits first.
                  setTimeout(() => { onImmediateSave?.(); }, 0);
                }}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>
      </CardContent>
    </Card>
  );
});

export default TrainingSummarySection;
