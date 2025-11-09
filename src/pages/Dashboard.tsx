import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, LogOut, FileText, CloudOff, Cloud, GraduationCap, ArrowRight, Lock, Download } from "lucide-react";
import { toast } from "sonner";
import ropeWorksLogo from "@/assets/rope-works-logo.png";
import { usePWAInstall } from "@/hooks/usePWAInstall";

export default function Dashboard() {
  const navigate = useNavigate();
  const [inspections, setInspections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const { isInstallable, isInstalled, promptInstall } = usePWAInstall();

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
          <div className="flex items-center gap-3">
            <img src={ropeWorksLogo} alt="Rope Works" className="h-12 w-auto object-contain" />
            <h1 className="text-2xl font-bold text-primary">Reports</h1>
          </div>
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
            {isInstallable && !isInstalled && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  if (import.meta.env.DEV) {
                    console.log('[Dashboard] Install App button clicked');
                  }
                  promptInstall();
                }}
                className="gap-2"
              >
                <Download className="w-4 h-4" />
                Install App
              </Button>
            )}
            <Button variant="ghost" onClick={handleSignOut}>
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Foyer Section */}
        <section className="mb-12">
          <div className="text-center mb-8">
            <h2 className="text-4xl font-bold text-primary mb-2">
              Welcome to Rope Works
            </h2>
            <p className="text-lg text-muted-foreground">
              Choose a report type to get started
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {/* INSPECTION CARD - FUNCTIONAL */}
            <Card 
              className="relative overflow-hidden hover:shadow-2xl transition-all duration-300 border-2 hover:border-blue-500 cursor-pointer group"
              onClick={() => navigate("/inspection/new")}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-transparent opacity-50" />
              <CardHeader className="relative z-10 text-center pb-4">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <FileText className="w-8 h-8 text-blue-600" />
                </div>
                <CardTitle className="text-2xl mb-2">Inspection Report</CardTitle>
                <CardDescription className="text-base">
                  Create a new equipment and facility inspection report
                </CardDescription>
              </CardHeader>
              <CardContent className="relative z-10 text-center pb-6">
                <Button size="lg" className="w-full bg-blue-600 hover:bg-blue-700">
                  Start Inspection
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </CardContent>
            </Card>

            {/* TRAINING CARD - MOCKUP (DISABLED) */}
            <Card className="relative overflow-hidden border-2 opacity-60 cursor-not-allowed">
              <Badge 
                variant="secondary" 
                className="absolute top-4 right-4 z-20 bg-yellow-100 text-yellow-800 border-yellow-300"
              >
                Coming Soon
              </Badge>
              <div className="absolute inset-0 bg-gradient-to-br from-green-50 to-transparent opacity-30" />
              <CardHeader className="relative z-10 text-center pb-4">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
                  <GraduationCap className="w-8 h-8 text-green-600" />
                </div>
                <CardTitle className="text-2xl mb-2 text-muted-foreground">
                  Training Report
                </CardTitle>
                <CardDescription className="text-base">
                  Document training sessions and participant assessments
                </CardDescription>
              </CardHeader>
              <CardContent className="relative z-10 text-center pb-6">
                <Button size="lg" className="w-full" disabled>
                  <Lock className="w-4 h-4 mr-2" />
                  Coming Soon
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Recent Reports Section */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-2xl font-bold">Recent Reports</h3>
              <p className="text-muted-foreground mt-1">
                View and manage your inspection reports
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
        </section>
      </main>
    </div>
  );
}
