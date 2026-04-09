import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Video, FileText, CheckCircle2, Loader2 } from "lucide-react";
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
  const { isAdmin, loading: authLoading } = useRequireAdmin();
  const [videoPlayerUrl, setVideoPlayerUrl] = useState<string | null>(null);
  const [videoPlayerTitle, setVideoPlayerTitle] = useState("");

  // Fetch published resources only
  const { data: resources = [], isLoading: loadingResources } = useQuery({
    queryKey: ["onboarding-resources"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("onboarding_resources")
        .select("*")
        .eq("is_published", true)
        .order("display_order", { ascending: true });
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
  const totalPublished = resources.length;
  const completedCount = resources.filter((r) => completedSet.has(r.id)).length;
  const progressPercent = totalPublished > 0 ? Math.round((completedCount / totalPublished) * 100) : 0;

  // Toggle completion
  const toggleComplete = useMutation({
    mutationFn: async ({ resourceId, completed }: { resourceId: string; completed: boolean }) => {
      if (completed) {
        await supabase.from("onboarding_progress").delete().eq("resource_id", resourceId);
      } else {
        const { getUserWithCache, getOfflineUserId } = await import("@/lib/cached-auth");
        let user = await getUserWithCache();
        if (!user) {
          const offlineId = getOfflineUserId();
          if (offlineId) user = { id: offlineId } as any;
        }
        if (!user) throw new Error("Not authenticated");
        await supabase.from("onboarding_progress").insert({ user_id: user.id, resource_id: resourceId });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["onboarding-progress"] }),
  });

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

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

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

  const videos = resources.filter((r) => r.file_type === "video");
  const pdfs = resources.filter((r) => r.file_type === "pdf");

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
                  onToggleComplete={() =>
                    toggleComplete.mutate({ resourceId: resource.id, completed: completedSet.has(resource.id) })
                  }
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
                  onToggleComplete={() =>
                    toggleComplete.mutate({ resourceId: resource.id, completed: completedSet.has(resource.id) })
                  }
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
  onToggleComplete,
  onClick,
}: {
  resource: OnboardingResource;
  completed: boolean;
  onToggleComplete: () => void;
  onClick: () => void;
}) {
  return (
    <Card
      className={`transition-all duration-200 hover:shadow-md cursor-pointer ${
        completed ? "border-success/40 bg-success/5" : ""
      }`}
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
          </div>
          {resource.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{resource.description}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
