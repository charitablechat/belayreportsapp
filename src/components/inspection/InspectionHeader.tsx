import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VoiceInput } from "@/components/ui/voice-input";
import { VoiceTextarea } from "@/components/ui/voice-textarea";
import { OrganizationAutocomplete } from "@/components/OrganizationAutocomplete";
import { GlobalAutocomplete } from "@/components/GlobalAutocomplete";
import { PreviousInspectionDatePicker } from "@/components/PreviousInspectionDatePicker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarIcon, MapPin, Loader2, X } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { parseLocalDate } from "@/lib/date-utils";
import { getCurrentLocationWithAddress, getGeolocationErrorMessage } from "@/lib/geolocation";
import { triggerHaptic } from "@/lib/haptics";
import { toast } from "@/components/ui/sonner";

interface InspectionHeaderProps {
  inspection: any;
  userProfile: any;
  modifiedByProfile?: { first_name?: string; last_name?: string } | null;
  onUpdate: (field: string, value: string) => void;
  onImmediateSave?: () => void;
  isReadOnly?: boolean;
  /**
   * Keys of header fields that the user attempted to complete the report
   * without filling. Drives a red pulse + aria-invalid on the offending
   * input. See src/lib/required-fields.ts.
   */
  missingFieldKeys?: string[];
}

export default function InspectionHeader({ inspection, userProfile, modifiedByProfile, onUpdate, onImmediateSave, isReadOnly = false, missingFieldKeys = [] }: InspectionHeaderProps) {
  const isMissing = (key: string) => missingFieldKeys.includes(key);
  const missingRing = "field-invalid";

  const [locationLoading, setLocationLoading] = useState(false);

  const handleLocationCapture = async () => {
    setLocationLoading(true);
    try {
      triggerHaptic('light');
      const position = await getCurrentLocationWithAddress();
      // Save scheduled by parent's handleHeaderUpdate (debounced after
      // setState flush); calling onImmediateSave synchronously here would
      // race with React and ship a stale payload.
      onUpdate("location", position.address);
      toast.success("Location updated");
      triggerHaptic('success');
    } catch (error: any) {
      const message = error?.code !== undefined
        ? getGeolocationErrorMessage(error as GeolocationPositionError)
        : error?.message || "Failed to get location";
      toast.error(message);
      triggerHaptic('error');
    } finally {
      setLocationLoading(false);
    }
  };

  const inspectorName = [userProfile?.first_name, userProfile?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim() || (userProfile ? 'Inspector' : 'Loading...');
  
  // Build modified by name if different from inspector
  const modifiedByName = modifiedByProfile?.first_name && modifiedByProfile?.last_name
    ? `${modifiedByProfile.first_name} ${modifiedByProfile.last_name}`
    : null;

  const renderField = (label: string, field: string, value: string, type: string = "text", isTextarea: boolean = false) => {
    return (
      <div>
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">{label}</Label>
        {isTextarea ? (
          <VoiceTextarea
            value={value || ""}
            onChange={(e) => onUpdate(field, e.target.value)}
            onBlur={onImmediateSave}
            className="min-h-[100px]"
            placeholder={`Enter ${label.toLowerCase()}...`}
            disabled={isReadOnly}
          />
        ) : (
          <VoiceInput
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
            disabled={isReadOnly}
          />
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="text-center overflow-hidden">
      <h1 className="text-xl md:text-2xl font-bold mb-2 px-2 md:px-0 break-words [overflow-wrap:anywhere]">
        Inspection Report for Challenge Course, Adventure Park or Canopy/Zip Line Tour
      </h1>
      </div>

      <Card>
        <CardContent className="pt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-4">
            Report Details
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mb-6">
            <div className="space-y-3">
              <div className="space-y-1.5 p-3 rounded-lg bg-muted/30 border border-border/50">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Inspector</Label>
                <VoiceInput
                  value={inspectorName}
                  disabled
                  className="bg-muted/50 cursor-not-allowed font-medium"
                />
              </div>
              {modifiedByName && (
                <div className="space-y-1.5 p-3 rounded-lg bg-muted/30 border border-border/50">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Report modified by</Label>
                  <Input
                    value={modifiedByName}
                    disabled
                    className="bg-muted/50 cursor-not-allowed font-medium"
                  />
                </div>
              )}
              <div
                id="field-organization"
                aria-invalid={isMissing('organization') || undefined}
                className={cn(
                  "space-y-1.5 p-3 rounded-lg bg-muted/30 border border-border/50",
                  isMissing('organization') && missingRing,
                )}
              >
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Facility Name</Label>
                <OrganizationAutocomplete
                  value={inspection?.organization || ""}
                  onChange={(value) => {
                    // Do NOT also call onImmediateSave here — the parent's
                    // handleHeaderUpdate schedules a debounced save that
                    // sees the freshly-set state. Calling onImmediateSave
                    // synchronously would race with React's setState and
                    // ship a stale payload, silently dropping this value.
                    onUpdate("organization", value);
                  }}
                  disabled={isReadOnly}
                />
              </div>
              <div
                id="field-location"
                aria-invalid={isMissing('location') || undefined}
                className={cn(
                  "space-y-1.5 p-3 rounded-lg bg-muted/30 border border-border/50",
                  isMissing('location') && missingRing,
                )}
              >
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Location</Label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <VoiceInput
                      value={inspection?.location || ""}
                      onChange={(e) => onUpdate("location", e.target.value)}
                      onBlur={onImmediateSave}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onImmediateSave?.();
                      }}
                      placeholder="Enter location..."
                      disabled={isReadOnly}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handleLocationCapture}
                    disabled={isReadOnly || locationLoading}
                    title="Get current location"
                    className="shrink-0"
                  >
                    {locationLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <MapPin className="h-4 w-4" />
                    )}
                  </Button>
                  {inspection?.location && !isReadOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        onUpdate("location", "");
                      }}
                      title="Clear location"
                      className="shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="space-y-1.5 p-3 rounded-lg bg-muted/30 border border-border/50">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Previous Inspector</Label>
                <GlobalAutocomplete
                  value={inspection?.previous_inspector || ""}
                  onChange={(value) => {
                    onUpdate("previous_inspector", value);
                  }}
                  fieldType="previous_inspector"
                  placeholder="Select or enter inspector..."
                  disabled={isReadOnly}
                />
              </div>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5 p-3 rounded-lg bg-muted/30 border border-border/50">
                {renderField("ACCT#", "acct_number", inspection?.acct_number)}
              </div>
              <div
                id="field-inspection_date"
                aria-invalid={isMissing('inspection_date') || undefined}
                className={cn(
                  "space-y-1.5 p-3 rounded-lg bg-muted/30 border border-border/50",
                  isMissing('inspection_date') && missingRing,
                )}
              >
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Inspection Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-full justify-start text-left font-normal", isReadOnly && "bg-muted/50 cursor-not-allowed", !inspection?.inspection_date && "text-muted-foreground")}
                      disabled={isReadOnly}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {inspection?.inspection_date ? format(parseLocalDate(inspection.inspection_date)!, "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  {!isReadOnly && (
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={inspection?.inspection_date ? parseLocalDate(inspection.inspection_date) : undefined}
                        onSelect={(date) => {
                          onUpdate("inspection_date", date ? format(date, 'yyyy-MM-dd') : '');
                        }}
                        initialFocus
                        className="pointer-events-auto"
                      />
                    </PopoverContent>
                  )}
                </Popover>
              </div>
              <div className="space-y-1.5 p-3 rounded-lg bg-muted/30 border border-border/50">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Onsite Contact</Label>
                <GlobalAutocomplete
                  value={inspection?.onsite_contact || ""}
                  onChange={(value) => {
                    onUpdate("onsite_contact", value);
                  }}
                  fieldType="onsite_contact"
                  placeholder="Select or enter contact..."
                  disabled={isReadOnly}
                />
              </div>
              <div className="space-y-1.5 p-3 rounded-lg bg-muted/30 border border-border/50">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Prev. Inspection Date</Label>
                <PreviousInspectionDatePicker
                  value={inspection?.previous_inspection_date}
                  onChange={(value) => {
                    onUpdate("previous_inspection_date", value);
                  }}
                  disabled={isReadOnly}
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5 p-3 rounded-lg bg-muted/30 border border-border/50 mb-6">
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

          <div className="p-4 rounded-lg bg-muted/30 border border-border/50 mb-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Inspection Categories</h3>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="flex items-start gap-2">
                <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Lifeline Hardware</p>
                  <p className="text-xs text-muted-foreground">Cables, connections, and support systems</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Activity Hardware</p>
                  <p className="text-xs text-muted-foreground">Element-specific components</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Environment</p>
                  <p className="text-xs text-muted-foreground">Surrounding area and structures</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Pass/Fail Assessment</p>
                  <p className="text-xs text-muted-foreground">Overall safety rating</p>
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">📋 Important Notes</h3>
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