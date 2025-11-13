import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface ResultSelectProps {
  value: string;
  onChange: (value: string) => void;
  includeNA?: boolean;
}

export default function ResultSelect({ value, onChange, includeNA = false }: ResultSelectProps) {
  const getResultColor = (result: string) => {
    switch (result.toLowerCase()) {
      case "pass":
        return "text-success border-success";
      case "pass w/provisions":
        return "text-warning border-warning";
      case "pass w/ repair":
        return "text-amber-600 border-amber-600";
      case "fail":
        return "text-destructive border-destructive";
      case "na":
      case "n/a":
        return "text-muted-foreground border-muted";
      default:
        return "";
    }
  };

  const getDisplayValue = (value: string) => {
    switch (value.toLowerCase()) {
      case "pass": return "Pass";
      case "pass w/provisions": return "Pass w/Provisions";
      case "pass w/ repair": return "Pass w/ Repair";
      case "fail": return "Fail";
      case "na":
      case "n/a": return "N/A";
      default: return value;
    }
  };

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn("w-full", getResultColor(value))}>
        <SelectValue placeholder="Select result">{getDisplayValue(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent className="bg-card z-50">
        <SelectItem value="pass" className="text-success">Pass</SelectItem>
        <SelectItem value="pass w/provisions" className="text-warning">Pass w/Provisions</SelectItem>
        <SelectItem value="pass w/ repair" className="text-amber-600">Pass w/ Repair</SelectItem>
        <SelectItem value="fail" className="text-destructive">Fail</SelectItem>
        {includeNA && <SelectItem value="na" className="text-muted-foreground">N/A</SelectItem>}
      </SelectContent>
    </Select>
  );
}
