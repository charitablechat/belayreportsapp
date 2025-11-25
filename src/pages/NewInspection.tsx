import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, MapPin, CloudOff, Info, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import ropeWorksLogo from "@/assets/rope-works-logo.png";
import { saveInspectionOffline, queueOperation } from "@/lib/offline-storage";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { OrganizationAutocomplete } from "@/components/OrganizationAutocomplete";
import { getCurrentLocationWithAddress } from "@/lib/geolocation";
import { getUserWithCache, getCachedUser } from "@/lib/cached-auth";

export default function NewInspection() {
  const navigate = useNavigate();
  const { isOnline } = useNetworkStatus();
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [formData, setFormData] = useState({
    organization: "",
    location: "",
    onsite_contact: "",
    previous_inspector: "",
    previous_inspection_date: "",
    course_history: "",
    latitude: null as number | null,
    longitude: null as number | null,
  });

  const handleLocationCapture = async () => {
    setLocationLoading(true);
    try {
      const position = await getCurrentLocationWithAddress();
      setFormData(prev => ({
        ...prev,
        location: position.address,
        latitude: position.latitude,
        longitude: position.longitude,
      }));
      toast.success(`Location captured: ${position.address}`);
      
      if (import.meta.env.DEV) {
        console.log('[NewInspection] Location captured:', position);
      }
    } catch (error: any) {
      toast.error("Failed to get location: " + error.message);
    } finally {
      setLocationLoading(false);
    }
  };

  const handleClearLocation = () => {
    setFormData(prev => ({
      ...prev,
      location: "",
      latitude: null,
      longitude: null,
    }));
    toast.success("Location cleared");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Get user from cache or online - works offline!
      const user = await getUserWithCache();
      if (!user) {
        toast.error("Not authenticated. Please sign in again.");
        throw new Error("Not authenticated");
      }

      // Generate temporary ID for offline mode
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const newInspection = {
        ...formData,
        id: tempId,
        inspector_id: user.id,
        status: "draft",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        inspection_date: new Date().toISOString().split('T')[0],
      };

      if (isOnline) {
        // Create in Supabase
        if (import.meta.env.DEV) {
          console.log('[NewInspection] Submitting to Supabase:', {
            ...formData,
            inspector_id: user.id,
            status: "draft",
          });
        }
        
        const { data, error } = await supabase
          .from("inspections")
          .insert({
            ...formData,
            inspector_id: user.id,
            status: "draft",
          })
          .select()
          .single();

        if (error) throw error;

        // Cache offline
        await saveInspectionOffline({
          ...data,
          synced_at: new Date().toISOString(),
        });

        toast.success("Inspection created successfully");
        navigate(`/inspection/${data.id}`);
        
        if (import.meta.env.DEV) {
          console.log('[NewInspection] Created and synced to Supabase');
        }
      } else {
        // Create offline only
        await saveInspectionOffline(newInspection);
        await queueOperation('create', tempId, newInspection);

        toast.success("Inspection created offline - will sync when online");
        navigate(`/inspection/${tempId}`);
        
        if (import.meta.env.DEV) {
          console.log('[NewInspection] Created offline with temp ID:', tempId);
        }
      }
    } catch (error: any) {
      console.error("Error creating inspection:", error);
      toast.error(error.message || "Failed to create inspection");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-2 md:px-4 py-4 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline ml-2">Back to Dashboard</span>
          </Button>
          <img src={ropeWorksLogo} alt="Rope Works" className="h-8 md:h-10 w-auto object-contain" />
        </div>
      </header>

      <main className="container mx-auto px-2 md:px-4 py-8 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">New Inspection Report</CardTitle>
          </CardHeader>
          <CardContent>
            {!isOnline && (
              <Alert className="mb-6 border-warning bg-warning/10">
                <CloudOff className="h-4 w-4 text-warning" />
                <AlertDescription className="text-gray-900 dark:text-gray-100">
                  📴 Working offline - inspection will sync when online
                  {getCachedUser()?.email && (
                    <div className="text-xs mt-1 opacity-80">
                      Using cached credentials for {getCachedUser()?.email}
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}
            
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="organization">Organization *</Label>
                <OrganizationAutocomplete
                  value={formData.organization}
                  onChange={(value) => setFormData(prev => ({ ...prev, organization: value }))}
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="location">Location *</Label>
                <div className="flex gap-2">
                  <Input
                    id="location"
                    value={formData.location}
                    onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                    required
                    placeholder="Enter location"
                    className="flex-1"
                  />
                  <Button type="button" variant="outline" onClick={handleLocationCapture} disabled={locationLoading}>
                    {locationLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <MapPin className={`w-4 h-4 ${formData.latitude && formData.longitude ? 'text-green-600' : ''}`} />
                    )}
                  </Button>
                  {formData.latitude && formData.longitude && (
                    <Button type="button" variant="outline" onClick={handleClearLocation} className="text-destructive hover:text-destructive">
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                {formData.latitude && formData.longitude && (
                  <div className="space-y-1 mt-1">
                    <p className="text-sm text-muted-foreground">
                      Coordinates: {formData.latitude.toFixed(6)}, {formData.longitude.toFixed(6)}
                    </p>
                    <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                      <span>Location name auto-filled from GPS. You can edit it manually if needed.</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="onsite_contact">Onsite Contact</Label>
                <Input
                  id="onsite_contact"
                  value={formData.onsite_contact}
                  onChange={(e) => setFormData(prev => ({ ...prev, onsite_contact: e.target.value }))}
                  placeholder="Enter contact name"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="previous_inspector">Previous Inspector</Label>
                  <Input
                    id="previous_inspector"
                    value={formData.previous_inspector}
                    onChange={(e) => setFormData(prev => ({ ...prev, previous_inspector: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="previous_inspection_date">Previous Inspection Date</Label>
                  <Input
                    id="previous_inspection_date"
                    type="date"
                    value={formData.previous_inspection_date}
                    onChange={(e) => setFormData(prev => ({ ...prev, previous_inspection_date: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="course_history">Known Course History</Label>
                <Textarea
                  id="course_history"
                  value={formData.course_history}
                  onChange={(e) => setFormData(prev => ({ ...prev, course_history: e.target.value }))}
                  rows={4}
                  placeholder="Enter any known history about this course..."
                />
              </div>

              {!isOnline && (
                <Alert className="border-muted bg-muted/50">
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    <strong>Offline mode:</strong> You can create and edit inspections offline. Changes will automatically sync when you're back online.
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex gap-4">
                <Button type="submit" disabled={loading} className="flex-1">
                  {loading ? "Creating..." : isOnline ? "Create Inspection" : "Create Locally"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate("/dashboard")}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
