import { useState, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface SystemTypeSelectProps {
  value: string;
  onChange: (value: string) => void;
}

const DEFAULT_OPTIONS = [
  "Top Rope",
  "Tensioned Rope",
  "Automated Safety",
  "Limited Fall",
  "Collective Safety",
  "Spotted/Low"
];

const STORAGE_KEY = "rope-works-custom-system-types";

export default function SystemTypeSelect({ value, onChange }: SystemTypeSelectProps) {
  const [customOptions, setCustomOptions] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOption, setEditingOption] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");

  // Load custom options from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setCustomOptions(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load custom options", e);
      }
    }
  }, []);

  // Save custom options to localStorage
  const saveCustomOptions = (options: string[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
    setCustomOptions(options);
  };

  const handleAddNew = () => {
    setEditingOption(null);
    setInputValue("");
    setDialogOpen(true);
  };

  const handleEdit = (option: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingOption(option);
    setInputValue(option);
    setDialogOpen(true);
  };

  const handleSave = () => {
    const trimmed = inputValue.trim();
    
    if (!trimmed) {
      return;
    }

    // Check for duplicates (case-insensitive)
    const allOptions = [...DEFAULT_OPTIONS, ...customOptions];
    const isDuplicate = allOptions.some(
      opt => opt.toLowerCase() === trimmed.toLowerCase() && opt !== editingOption
    );

    if (isDuplicate) {
      return;
    }

    if (editingOption) {
      // Edit existing
      const updated = customOptions.map(opt => opt === editingOption ? trimmed : opt);
      saveCustomOptions(updated);
      // Update current value if it was the edited one
      if (value === editingOption) {
        onChange(trimmed);
      }
    } else {
      // Add new
      saveCustomOptions([...customOptions, trimmed]);
      onChange(trimmed);
    }

    setDialogOpen(false);
    setInputValue("");
    setEditingOption(null);
  };

  const handleDelete = () => {
    if (editingOption) {
      const updated = customOptions.filter(opt => opt !== editingOption);
      saveCustomOptions(updated);
      setDialogOpen(false);
      setInputValue("");
      setEditingOption(null);
    }
  };

  return (
    <>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full bg-card">
          <SelectValue placeholder="Select system type" />
        </SelectTrigger>
        <SelectContent className="bg-card z-50">
          {DEFAULT_OPTIONS.map(option => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
          
          {customOptions.length > 0 && (
            <div className="border-t my-1 pt-1">
              {customOptions.map(option => (
                <div key={option} className="relative group">
                  <SelectItem value={option} className="pr-8">
                    {option}
                  </SelectItem>
                  <button
                    onClick={(e) => handleEdit(option, e)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-accent rounded"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          
          <div className="border-t mt-1 pt-1">
            <button
              onClick={handleAddNew}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent rounded cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Add Custom Option...
            </button>
          </div>
        </SelectContent>
      </Select>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md w-[calc(100vw-2rem)]">
          <DialogHeader>
            <DialogTitle>
              {editingOption ? "Edit System Type" : "Add Custom System Type"}
            </DialogTitle>
          </DialogHeader>
          
          <div className="py-4">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Enter system type name"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSave();
                }
              }}
              autoFocus
            />
          </div>

          <DialogFooter className="gap-2">
            {editingOption && (
              <Button
                onClick={handleDelete}
                variant="destructive"
                size="sm"
                className="mr-auto"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            )}
            <Button onClick={() => setDialogOpen(false)} variant="outline" size="sm">
              Cancel
            </Button>
            <Button onClick={handleSave} size="sm">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
