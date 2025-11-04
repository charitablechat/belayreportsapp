import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface ResultSelectProps {
  value: string;
  onChange: (value: string) => void;
  includeNA?: boolean;
}

export default function ResultSelect({ value, onChange, includeNA = false }: ResultSelectProps) {
  const getResultColor = (result: string) => {
    switch (result) {
      case "Pass":
        return "text-success border-success";
      case "Pass w/Provisions":
        return "text-warning border-warning";
      case "Fail":
        return "text-destructive border-destructive";
      case "N/A":
        return "text-muted-foreground border-muted";
      default:
        return "";
    }
  };

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn("w-full", getResultColor(value))}>
        <SelectValue placeholder="Select result" />
      </SelectTrigger>
      <SelectContent className="bg-card z-50">
        <SelectItem value="Pass" className="text-success">Pass</SelectItem>
        <SelectItem value="Pass w/Provisions" className="text-warning">Pass w/Provisions</SelectItem>
        <SelectItem value="Fail" className="text-destructive">Fail</SelectItem>
        {includeNA && <SelectItem value="N/A" className="text-muted-foreground">N/A</SelectItem>}
      </SelectContent>
    </Select>
  );
}
