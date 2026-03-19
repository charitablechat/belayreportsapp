import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Plus, Video, FileText, Trash2, Eye, EyeOff,
  CheckCircle2, Upload, Loader2
} from "lucide-react";
import { useRequireAdmin } from "@/hooks/useRequireAdmin";

type OnboardingResource = {
  id: string;
  title: string;
  description: string | null;
  file_type: string;
  file_url: string;
  display_order: number;
  is_published: boolean;
  uploaded_by: string;
  created_at: string;
};

export default function Onboarding() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin, isSuperAdmin, loading: authLoading } = useRequireAdmin();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [videoPlayerUrl, setVideoPlayerUrl] = useState<string | null>(null);
  const [videoPlayerTitle, setVideoPlayerTitle] = useState("");

  // Form state
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newFileType, setNewFileType] = useState<string>("video");
  const [newFile, setNewFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Fetch resources (RLS enforces admin/super_admin access server-side)
  const { data: resources = [], isLoading: loadingResources } = useQuery({
    queryKey: ["onboarding-resources", isSuperAdmin],
    queryFn: async () => {
      let query = supabase
        .from("onboarding_resources")
        .select("*")
        .order("display_order", { ascending: true });

      // Non-super-admin admins only see published resources
      if (!isSuperAdmin) {
        query = query.eq("is_published", true);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as OnboardingResource[];
    },
    enabled: isAdmin === true,
  });

  // Fetch progress
  const { data: progress = [] } = useQuery({
    queryKey: ["onboarding-progress"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("onboarding_progress")
        .select("resource_id");
      if (error) throw error;
      return (data ?? []).map((p: any) => p.resource_id as string);
    },
    enabled: isAdmin === true,
  });

  const completedSet = new Set(progress);
  const publishedResources = resources.filter((r) => r.is_published);
  const totalPublished = publishedResources.length;
  const completedCount = publishedResources.filter((r) => completedSet.has(r.id)).length;
  const progressPercent = totalPublished > 0 ? Math.round((completedCount / totalPublished) * 100) : 0;

  // Toggle completion
  const toggleComplete = useMutation({
    mutationFn: async ({ resourceId, completed }: { resourceId: string; completed: boolean }) => {
      if (completed) {
        await supabase.from("onboarding_progress").delete().eq("resource_id", resourceId);
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");
        await supabase.from("onboarding_progress").insert({ user_id: user.id, resource_id: resourceId });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["onboarding-progress"] }),
  });

  // Toggle publish (super admin only)
  const togglePublish = useMutation({
    mutationFn: async ({ id, published }: { id: string; published: boolean }) => {
      const { error } = await supabase.from("onboarding_resources").update({ is_published: !published }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding-resources"] });
      toast.success("Resource updated");
    },
  });

  // Delete resource (super admin only)
  const deleteResource = useMutation({
    mutationFn: async (resource: OnboardingResource) => {
      const path = resource.file_url.split("/onboarding-files/")[1];
      if (path) {
        await supabase.storage.from("onboarding-files").remove([path]);
      }
      const { error } = await supabase.from("onboarding_resources").delete().eq("id", resource.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding-resources"] });
      toast.success("Resource deleted");
    },
  });

  // Upload new resource (super admin only)
  const handleUpload = async () => {
    if (!newTitle.trim() || !newFile) return;
    setUploading(true);
    try {
      const filePath = `${Date.now()}-${newFile.name}`;

      const { error: uploadError } = await supabase.storage
        .from("onboarding-files")
        .upload(filePath, newFile);
      if (uploadError) throw uploadError;

      const maxOrder = resources.length > 0 ? Math.max(...resources.map((r) => r.display_order)) + 1 : 0;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error: insertError } = await supabase.from("onboarding_resources").insert({
        title: newTitle.trim(),
        description: newDescription.trim() || null,
        file_type: newFileType,
        file_url: filePath,
        display_order: maxOrder,
        is_published: false,
        uploaded_by: user.id,
      });
      if (insertError) throw insertError;

      queryClient.invalidateQueries({ queryKey: ["onboarding-resources"] });
      toast.success("Resource uploaded");
      setAddDialogOpen(false);
      setNewTitle("");
      setNewDescription("");
      setNewFile(null);
      setNewFileType("video");
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const getSignedUrl = async (filePath: string) => {
    const { data, error } = await supabase.storage
      .from("onboarding-files")
      .createSignedUrl(filePath, 3600);
    if (error) throw error;
    return data.signedUrl;
  };

  const handleResourceClick = async (resource: OnboardingResource) => {
    try {
      const url = await getSignedUrl(resource.file_url);
      if (resource.file_type === "video") {
        setVideoPlayerUrl(url);
        setVideoPlayerTitle(resource.title);
      } else {
        window.open(url, "_blank");
      }
    } catch {
      toast.error("Failed to load file");
    }
  };

  // Show loading while auth check runs
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Access denied (redirect happens in hook, this is a fallback)
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-lg font-semibold text-foreground">403 — Forbidden</p>
          <p className="text-sm text-muted-foreground">You don't have permission to access this page.</p>
        </div>
      </div>
    );
  }

  const videos = (isSuperAdmin ? resources : publishedResources).filter((r) => r.file_type === "video");
  const pdfs = (isSuperAdmin ? resources : publishedResources).filter((r) => r.file_type === "pdf");

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Onboarding</h1>
            <p className="text-sm text-muted-foreground font-mono">
              {completedCount} of {totalPublished} completed
            </p>
          </div>
          {isSuperAdmin && (
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5">
                  <Plus className="w-4 h-4" />
                  Add Resource
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Onboarding Resource</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label>Title</Label>
                    <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Resource title" />
                  </div>
                  <div className="space-y-2">
                    <Label>Description (optional)</Label>
                    <Textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Brief description" rows={2} />
                  </div>
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={newFileType} onValueChange={setNewFileType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="video">Video</SelectItem>
                        <SelectItem value="pdf">PDF</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>File</Label>
                    <Input
                      type="file"
                      accept={newFileType === "video" ? "video/*" : "application/pdf"}
                      onChange={(e) => setNewFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                  <Button onClick={handleUpload} disabled={uploading || !newTitle.trim() || !newFile} className="w-full gap-2">
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {uploading ? "Uploading..." : "Upload Resource"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-8">
        {/* Progress bar */}
        {totalPublished > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground font-mono">Progress</span>
              <span className="font-mono font-bold text-foreground">{progressPercent}%</span>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </div>
        )}

        {loadingResources && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Videos Section */}
        {videos.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Video className="w-5 h-5 text-primary" />
              Videos
            </h2>
            <div className="grid gap-3">
              {videos.map((resource) => (
                <ResourceCard
                  key={resource.id}
                  resource={resource}
                  completed={completedSet.has(resource.id)}
                  isSuperAdmin={isSuperAdmin}
                  onToggleComplete={() =>
                    toggleComplete.mutate({ resourceId: resource.id, completed: completedSet.has(resource.id) })
                  }
                  onTogglePublish={() =>
                    togglePublish.mutate({ id: resource.id, published: resource.is_published })
                  }
                  onDelete={() => deleteResource.mutate(resource)}
                  onClick={() => handleResourceClick(resource)}
                />
              ))}
            </div>
          </section>
        )}

        {/* PDFs Section */}
        {pdfs.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Documents
            </h2>
            <div className="grid gap-3">
              {pdfs.map((resource) => (
                <ResourceCard
                  key={resource.id}
                  resource={resource}
                  completed={completedSet.has(resource.id)}
                  isSuperAdmin={isSuperAdmin}
                  onToggleComplete={() =>
                    toggleComplete.mutate({ resourceId: resource.id, completed: completedSet.has(resource.id) })
                  }
                  onTogglePublish={() =>
                    togglePublish.mutate({ id: resource.id, published: resource.is_published })
                  }
                  onDelete={() => deleteResource.mutate(resource)}
                  onClick={() => handleResourceClick(resource)}
                />
              ))}
            </div>
          </section>
        )}

        {!loadingResources && resources.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No onboarding resources yet</p>
            {isSuperAdmin && <p className="text-sm mt-1">Click "Add Resource" to get started.</p>}
          </div>
        )}
      </div>

      {/* Video Player Dialog */}
      <Dialog open={!!videoPlayerUrl} onOpenChange={() => setVideoPlayerUrl(null)}>
        <DialogContent className="sm:max-w-3xl p-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle>{videoPlayerTitle}</DialogTitle>
          </DialogHeader>
          {videoPlayerUrl && (
            <video controls autoPlay className="w-full max-h-[70vh]" src={videoPlayerUrl}>
              Your browser does not support video playback.
            </video>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ResourceCard({
  resource,
  completed,
  isSuperAdmin,
  onToggleComplete,
  onTogglePublish,
  onDelete,
  onClick,
}: {
  resource: OnboardingResource;
  completed: boolean;
  isSuperAdmin: boolean;
  onToggleComplete: () => void;
  onTogglePublish: () => void;
  onDelete: () => void;
  onClick: () => void;
}) {
  return (
    <Card
      className={`transition-all duration-200 hover:shadow-md cursor-pointer ${
        completed ? "border-success/40 bg-success/5" : ""
      } ${!resource.is_published && isSuperAdmin ? "opacity-60 border-dashed" : ""}`}
    >
      <CardContent className="p-4 flex items-start gap-3">
        <Checkbox
          checked={completed}
          onCheckedChange={() => onToggleComplete()}
          onClick={(e) => e.stopPropagation()}
          className="mt-1"
        />
        <div className="flex-1 min-w-0" onClick={onClick}>
          <div className="flex items-center gap-2">
            {resource.file_type === "video" ? (
              <Video className="w-4 h-4 text-primary shrink-0" />
            ) : (
              <FileText className="w-4 h-4 text-primary shrink-0" />
            )}
            <span className={`font-medium text-foreground truncate ${completed ? "line-through opacity-60" : ""}`}>
              {resource.title}
            </span>
            {completed && <CheckCircle2 className="w-4 h-4 text-success shrink-0" />}
            {!resource.is_published && isSuperAdmin && (
              <Badge variant="outline" className="text-xs shrink-0">Draft</Badge>
            )}
          </div>
          {resource.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{resource.description}</p>
          )}
        </div>
        {isSuperAdmin && (
          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onTogglePublish} title={resource.is_published ? "Unpublish" : "Publish"}>
              {resource.is_published ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
