import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, LogOut, FileText, CloudOff, Cloud } from "lucide-react";
import { toast } from "sonner";

export default function Dashboard() {
  const navigate = useNavigate();
  const [inspections, setInspections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast.success("Connection restored");
    };
    const handleOffline = () => {
      setIsOnline(false);
      toast.error("You are offline. Data will sync when connection is restored.");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    loadInspections();
  }, []);

  const loadInspections = async () => {
    try {
      const { data, error } = await supabase
        .from("inspections")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setInspections(data || []);
    } catch (error: any) {
      console.error("Error loading inspections:", error);
      toast.error("Failed to load inspections");
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out successfully");
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: any; label: string }> = {
      draft: { variant: "secondary", label: "Draft" },
      completed: { variant: "default", label: "Completed" },
      synced: { variant: "outline", label: "Synced" },
    };
    const config = variants[status] || variants.draft;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-primary">Rope Works Inspections</h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              {isOnline ? (
                <Cloud className="w-5 h-5 text-success" />
              ) : (
                <CloudOff className="w-5 h-5 text-muted-foreground" />
              )}
              <span className="text-sm text-muted-foreground">
                {isOnline ? "Online" : "Offline"}
              </span>
            </div>
            <Button variant="ghost" onClick={handleSignOut}>
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-3xl font-bold">Inspections</h2>
            <p className="text-muted-foreground mt-1">
              Manage your inspection reports
            </p>
          </div>
          <Button onClick={() => navigate("/inspection/new")} size="lg">
            <Plus className="w-5 h-5 mr-2" />
            New Inspection
          </Button>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading inspections...</p>
          </div>
        ) : inspections.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No inspections yet</p>
              <Button onClick={() => navigate("/inspection/new")} className="mt-4">
                Create your first inspection
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {inspections.map((inspection) => (
              <Card
                key={inspection.id}
                className="cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => navigate(`/inspection/${inspection.id}`)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-lg">{inspection.organization}</CardTitle>
                    {getStatusBadge(inspection.status)}
                  </div>
                  <CardDescription>{inspection.location}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>
                      <span className="font-medium">Date:</span>{" "}
                      {new Date(inspection.inspection_date).toLocaleDateString()}
                    </p>
                    <p>
                      <span className="font-medium">Created:</span>{" "}
                      {new Date(inspection.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
