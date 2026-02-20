import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { goBack } from "@/lib/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, CloudOff, Info, Loader2, MapPin, X } from "lucide-react";
import ropeWorksLogo from "@/assets/rope-works-logo.png";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { OrganizationAutocomplete } from "@/components/OrganizationAutocomplete";
import { Input } from "@/components/ui/input";
import { getCurrentLocationWithAddress, getGeolocationErrorMessage } from "@/lib/geolocation";
import { getUserWithCache, getCachedUser } from "@/lib/cached-auth";
import { triggerHaptic } from "@/lib/haptics";
import { saveTrainingOffline, queueTrainingOperation } from "@/lib/offline-storage";
import { toast } from "sonner";

export default function NewTraining() {
  const navigate = useNavigate();
  const { isOnline } = useNetworkStatus();
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [trainerName, setTrainerName] = useState("");
  const [formData, setFormData] = useState({
    organization: "",
    location: "",
    latitude: null as number | null,
    longitude: null as number | null,
  });

  // Fetch user profile on mount to get their name
  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        const user = await getUserWithCache();
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('first_name, last_name')
            .eq('id', user.id)
            .single();
          
          if (profile) {
            const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
            if (fullName) {
              setTrainerName(fullName);
            }
          }
        }
      } catch (error) {
        console.error('Error fetching user profile:', error);
      }
    };

    fetchUserProfile();
  }, []);

  const handleLocationCapture = async () => {
    triggerHaptic('light');
    setLocationLoading(true);
    try {
      const position = await getCurrentLocationWithAddress();
      setFormData(prev => ({
        ...prev,
        latitude: position.latitude,
        longitude: position.longitude,
      }));
      
      triggerHaptic('success');
      toast.success("Location captured", {
        description: `${position.latitude.toFixed(4)}, ${position.longitude.toFixed(4)}`
      });
    } catch (error: any) {
      console.error("Failed to get location:", error);
      triggerHaptic('error');
      
      const message = error.code 
        ? getGeolocationErrorMessage(error) 
        : "Failed to get location. Please try again.";
      toast.error("Location Error", { description: message });
    } finally {
      setLocationLoading(false);
    }
  };

  const handleClearLocation = () => {
    triggerHaptic('light');
    setFormData(prev => ({
      ...prev,
      latitude: null,
      longitude: null,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    triggerHaptic('medium');
    setLoading(true);

    try {
      const user = await getUserWithCache();
      if (!user) {
        if (!navigator.onLine) {
          toast.error("Please sign in to create reports");
          setLoading(false);
          return;
        }
        navigate("/", { replace: true });
        return;
      }

      const now = new Date().toISOString();
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const newTraining = {
        id: tempId,
        inspector_id: user.id,
        organization: formData.organization,
        location: formData.location,
        start_date: now.split('T')[0],
        end_date: now.split('T')[0],
        status: 'draft',
        trainer_of_record: trainerName || null,
        latitude: formData.latitude,
        longitude: formData.longitude,
        created_at: now,
        updated_at: now,
        synced_at: null as string | null,
      };

      if (isOnline) {
        const { data, error } = await supabase
          .from('trainings')
          .insert([{
            inspector_id: user.id,
            organization: formData.organization,
            location: formData.location,
            start_date: now.split('T')[0],
            end_date: now.split('T')[0],
            status: 'draft',
            trainer_of_record: trainerName || null,
            latitude: formData.latitude,
            longitude: formData.longitude,
          }])
          .select()
          .single();

        if (error) throw error;

        // Cache offline
        await saveTrainingOffline({
          ...data,
          synced_at: new Date().toISOString(),
        });

        navigate(`/training/${data.id}`, { replace: true });
      } else {
        // Create offline only
        await saveTrainingOffline(newTraining);
        await queueTrainingOperation('create', tempId, newTraining);

        navigate(`/training/${tempId}`, { replace: true });
      }
      
      triggerHaptic('success');
    } catch (error) {
      console.error('Error creating training:', error);
      triggerHaptic('error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-2 md:px-4 py-4 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => goBack(navigate)}>
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline ml-2">Back to Dashboard</span>
          </Button>
          <img src={ropeWorksLogo} alt="Rope Works" className="h-8 md:h-10 w-auto object-contain cursor-pointer hover:opacity-80 transition-opacity" onClick={() => navigate('/dashboard')} />
        </div>
      </header>

      <main className="container mx-auto px-2 md:px-4 py-8 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">New Training Report</CardTitle>
          </CardHeader>
          <CardContent>
            {!isOnline && (
              <Alert className="mb-6 border-warning bg-warning/10">
                <CloudOff className="h-4 w-4 text-warning" />
                <AlertDescription className="text-foreground">
                  📴 Working offline - training will sync when online
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
                <label htmlFor="organization" className="text-sm font-medium">
                  Organization *
                </label>
                <OrganizationAutocomplete
                  value={formData.organization}
                  onChange={(value) => setFormData(prev => ({ ...prev, organization: value }))}
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Trainer of Record</label>
                <p className="text-sm text-muted-foreground">
                  {trainerName || "Will be set from your profile"}
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor="location" className="text-sm font-medium">
                  Location
                </label>
                <Input
                  id="location"
                  value={formData.location}
                  onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                  placeholder="e.g. Camp Thunderbird, Lake Wylie, SC"
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">GPS Coordinates (Optional)</label>
                <div className="flex gap-2">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={handleLocationCapture} 
                    disabled={locationLoading}
                    className="flex-1"
                  >
                    {locationLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        <span>Getting GPS...</span>
                      </>
                    ) : formData.latitude && formData.longitude ? (
                      <>
                        <MapPin className="w-4 h-4 text-green-600 mr-2" />
                        <span>Location Captured</span>
                      </>
                    ) : (
                      <>
                        <MapPin className="w-4 h-4 mr-2" />
                        <span>Capture Location</span>
                      </>
                    )}
                  </Button>
                  {formData.latitude && formData.longitude && (
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={handleClearLocation} 
                      className="text-destructive hover:text-destructive"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                {formData.latitude && formData.longitude && (
                  <p className="text-sm text-muted-foreground">
                    Coordinates: {formData.latitude.toFixed(6)}, {formData.longitude.toFixed(6)}
                  </p>
                )}
              </div>

              {!isOnline && (
                <Alert className="border-muted bg-muted/50">
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    <strong>Offline mode:</strong> You can create and edit trainings offline. Changes will automatically sync when you're back online.
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex gap-4">
                <Button 
                  type="submit" 
                  disabled={loading || !formData.organization.trim()} 
                  className="flex-1"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Creating...
                    </>
                  ) : (
                    isOnline ? "Create Training" : "Create Locally"
                  )}
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
