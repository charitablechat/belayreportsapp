import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InspectionHeaderProps {
  inspection: any;
  onUpdate: (field: string, value: string) => void;
}

export default function InspectionHeader({ inspection, onUpdate }: InspectionHeaderProps) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue || "");
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue("");
  };

  const saveEdit = (field: string) => {
    onUpdate(field, editValue);
    setEditingField(null);
    setEditValue("");
  };

  const renderEditableField = (label: string, field: string, value: string, type: string = "text") => {
    const isEditing = editingField === field;
    
    return (
      <div>
        <Label className="text-sm text-muted-foreground">{label}</Label>
        {isEditing ? (
          <div className="flex items-center gap-2">
            <Input
              type={type}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="h-8"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit(field);
                if (e.key === "Escape") cancelEdit();
              }}
            />
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => saveEdit(field)}>
              <Check className="h-4 w-4 text-green-600" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={cancelEdit}>
              <X className="h-4 w-4 text-red-600" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 group">
            <p className="font-medium flex-1">{value || "N/A"}</p>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => startEdit(field, value)}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
    );
  };

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
              {renderEditableField("Facility Name", "organization", inspection?.organization)}
              {renderEditableField("Location", "location", inspection?.location)}
              {renderEditableField("Onsite Contact", "onsite_contact", inspection?.onsite_contact)}
            </div>
            <div className="space-y-4">
              {renderEditableField("Inspection Date", "inspection_date", inspection?.inspection_date, "date")}
              {renderEditableField("Previous Inspector", "previous_inspector", inspection?.previous_inspector)}
              {renderEditableField("Prev. Inspection Date", "previous_inspection_date", inspection?.previous_inspection_date, "date")}
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
