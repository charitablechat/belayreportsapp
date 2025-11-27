import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertCircle, CheckCircle2, Merge } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { triggerHaptic } from "@/lib/haptics";

interface DuplicateGroup {
  group_key: string;
  org_ids: string[];
  org_names: string[];
  total_inspections: number;
  total_members: number;
}

interface MergeResult {
  success: boolean;
  inspections_updated: number;
  members_updated: number;
  conflicts_updated: number;
  organizations_deleted: number;
  target_organization_id: string;
}

interface MergeOrganizationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MergeOrganizationsDialog({
  open,
  onOpenChange,
}: MergeOrganizationsDialogProps) {
  const [selectedGroup, setSelectedGroup] = useState<DuplicateGroup | null>(null);
  const [targetOrgId, setTargetOrgId] = useState<string>("");
  const [newName, setNewName] = useState<string>("");
  const queryClient = useQueryClient();

  const { data: duplicates, isLoading } = useQuery({
    queryKey: ["duplicate-organizations"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("find_duplicate_organizations");
      if (error) throw error;
      return data as DuplicateGroup[];
    },
    enabled: open,
  });

  const mergeMutation = useMutation({
    mutationFn: async ({
      sourceIds,
      targetId,
      name,
    }: {
      sourceIds: string[];
      targetId: string;
      name?: string;
    }) => {
      const { data, error } = await supabase.rpc("merge_organizations", {
        p_source_org_ids: sourceIds,
        p_target_org_id: targetId,
        p_new_name: name || null,
      });
      if (error) throw error;
      return data as unknown as MergeResult;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["duplicate-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
      setSelectedGroup(null);
      setTargetOrgId("");
      setNewName("");
    },
    onError: (error: Error) => {
      console.error("Failed to merge organizations:", error);
    },
  });

  const handleMerge = () => {
    if (!selectedGroup || !targetOrgId) return;

    const sourceIds = selectedGroup.org_ids.filter((id) => id !== targetOrgId);
    mergeMutation.mutate({
      sourceIds,
      targetId: targetOrgId,
      name: newName.trim() || undefined,
    });
  };

  const handleSelectGroup = (group: DuplicateGroup) => {
    setSelectedGroup(group);
    setTargetOrgId(group.org_ids[0]);
    setNewName(group.org_names[0]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Merge className="h-5 w-5" />
            Merge Duplicate Organizations
          </DialogTitle>
          <DialogDescription>
            Find and consolidate organizations with similar names to maintain data consistency.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="text-muted-foreground">Loading duplicates...</div>
          </div>
        )}

        {!isLoading && duplicates && duplicates.length === 0 && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              No duplicate organizations found. All organization names are unique.
            </AlertDescription>
          </Alert>
        )}

        {!isLoading && duplicates && duplicates.length > 0 && (
          <div className="space-y-4">
            {!selectedGroup ? (
              <>
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Found {duplicates.length} potential duplicate{duplicates.length !== 1 ? "s" : ""}. Select a group to merge.
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  {duplicates.map((group, idx) => (
                    <div
                      key={idx}
                      className="border rounded-lg p-4 hover:border-primary transition-colors cursor-pointer"
                      onClick={() => handleSelectGroup(group)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="font-medium">
                            {group.org_names.join(" • ")}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {group.org_names.length} variations • {group.total_inspections} inspections • {group.total_members} members
                          </div>
                        </div>
                        <Button variant="outline" size="sm">
                          Select
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Merging {selectedGroup.org_names.length} organizations
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedGroup(null);
                      setTargetOrgId("");
                      setNewName("");
                    }}
                  >
                    Back
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label>Select Primary Organization</Label>
                  <RadioGroup value={targetOrgId} onValueChange={(val) => {
                    triggerHaptic('light');
                    setTargetOrgId(val);
                  }}>
                    {selectedGroup.org_ids.map((orgId, idx) => (
                      <div key={orgId} className="flex items-center space-x-2 border rounded p-3">
                        <RadioGroupItem value={orgId} id={orgId} />
                        <Label htmlFor={orgId} className="flex-1 cursor-pointer">
                          {selectedGroup.org_names[idx]}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-name">Final Organization Name (Optional)</Label>
                  <Input
                    id="new-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Leave blank to keep selected name"
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter a new name to standardize, or leave blank to use the selected organization's name
                  </p>
                </div>

                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    This will merge {selectedGroup.total_inspections} inspections and {selectedGroup.total_members} members 
                    into one organization. This action cannot be undone.
                  </AlertDescription>
                </Alert>
              </div>
            )}
          </div>
        )}

        {selectedGroup && (
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedGroup(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleMerge}
              disabled={!targetOrgId || mergeMutation.isPending}
            >
              {mergeMutation.isPending ? "Merging..." : "Merge Organizations"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
