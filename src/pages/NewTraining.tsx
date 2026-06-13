import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { goBack } from "@/lib/navigation";
import { DiscardDraftDialog } from "@/components/DiscardDraftDialog";
import { supabase } from "@/integrations/supabase/client";
import { getCachedProfile } from "@/lib/profile-cache";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, CloudOff, Info, Loader2, MapPin, X } from "lucide-react";
import belayReportsLogoAsset from "@/assets/belay-reports-wide.gif.asset.json";
const belayReportsLogo = belayReportsLogoAsset.url;
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { OrganizationAutocomplete } from "@/components/OrganizationAutocomplete";
import { Input } from "@/components/ui/input";
import { getCurrentLocationWithAddress, getGeolocationErrorMessage } from "@/lib/geolocation";
import { getUserWithCache, getCachedUser, getOfflineUserId } from "@/lib/cached-auth";
import { triggerHaptic } from "@/lib/haptics";
import { saveTrainingOffline, queueTrainingOperation } from "@/lib/offline-storage";
import { toast } from "sonner";

export default function NewTraining() {
  const navigate = useNavigate();
  const { isOnline } = useNetworkStatus();
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [trainerName, setTrainerName] = useState("");
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [formData, setFormData] = useState({
    organization: "",
    site: "",
    latitude: null as number | null,
    longitude: null as number | null,
  });

  // Fetch user profile on mount to get their name
  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        const userId = (await getUserWithCache())?.id || getOfflineUserId();
        if (!userId) return;

        const profile = await getCachedProfile(userId);
        if (profile) {
          const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
          if (fullName) {
            setTrainerName(fullName);
          }
        }
      } catch (error) {
        console.error('Error fetching user profile:', error);
      }
    };

    fetchUserProfile();
  }, []);

  const handleLocationCapture = async (silent: boolean = false) => {
    if (!silent) triggerHaptic('light');
    setLocationLoading(true);
    try {
      const position = await getCurrentLocationWithAddress();
      const isCoordFallback = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(position.address);
      if (silent && isCoordFallback) return;
      setFormData(prev => ({
        ...prev,
        site: position.address,
        latitude: position.latitude,
        longitude: position.longitude,
      }));
      if (!silent) {
        triggerHaptic('success');
        toast.success("Location captured", { description: position.address });
      }
    } catch (error: any) {
      if (silent) {
        console.warn("[NewTraining] Silent location capture failed:", error?.message || error);
        return;
      }
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

  // Auto-capture location once on mount (silent)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (formData.site) return;
      try {
        if ('permissions' in navigator) {
          const status = await (navigator as any).permissions.query({ name: 'geolocation' });
          if (status.state === 'denied') return;
        }
      } catch { /* ignore */ }
      if (cancelled) return;
      handleLocationCapture(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClearLocation = () => {
    triggerHaptic('light');
    setFormData(prev => ({
      ...prev,
      latitude: null,
      longitude: null,
    }));
  };

  const hasChanges = formData.organization.trim() !== "" || formData.site.trim() !== "";
  const handleBack = () => {
    if (hasChanges) setShowDiscardDialog(true);
    else goBack(navigate);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Block all writes in Lovable preview to protect production data
    if ((await import('@/lib/environment')).isLovablePreview()) {
      toast.info("Preview mode", { description: "Changes are not saved in the Lovable preview." });
      return;
    }

    triggerHaptic('medium');
    setLoading(true);

    try {
      let user = await getUserWithCache();
      if (!user) {
        const offlineId = getOfflineUserId();
        if (offlineId) {
          user = { id: offlineId } as any;
        } else {
          toast.error("Please sign in to create reports");
          setLoading(false);
          return;
        }
      }

      const now = new Date().toISOString();
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      // S5: stable client idempotency key for sync dedup (server-enforced)
      const clientIdempotencyKey = crypto.randomUUID();

      const newTraining = {
        id: tempId,
        inspector_id: user.id,
        organization: formData.organization,
        location: formData.site,
        start_date: now.split('T')[0],
        end_date: now.split('T')[0],
        status: 'draft',
        trainer_of_record: trainerName || null,
        latitude: formData.latitude,
        longitude: formData.longitude,
        created_at: now,
        updated_at: now,
        synced_at: null as string | null,
        client_idempotency_key: clientIdempotencyKey,
      };

      if (isOnline) {
        const { data, error } = await supabase
          .from('trainings')
          .insert([{
            inspector_id: user.id,
            organization: formData.organization,
            location: formData.site,
            start_date: now.split('T')[0],
            end_date: now.split('T')[0],
            status: 'draft',
            trainer_of_record: trainerName || null,
            latitude: formData.latitude,
            longitude: formData.longitude,
            client_idempotency_key: clientIdempotencyKey,
          }])
          .select()
          .single();

        if (error) throw error;

        await saveTrainingOffline({
          ...data,
          synced_at: new Date().toISOString(),
        });

        navigate(`/training/${data.id}`, { replace: true });
      } else {
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
      <header className="border-b border-white/20 bg-white/10 dark:bg-black/20 backdrop-blur-[12px] shadow-md shadow-black/5">
        <div className="container mx-auto px-2 md:px-4 py-4 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={handleBack}>
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline ml-2">Back to Dashboard</span>
          </Button>
          <img src={belayReportsLogo} alt="Belay Reports" className="h-8 md:h-10 w-auto object-contain cursor-pointer hover:opacity-80 transition-opacity" onClick={() => navigate('/dashboard')} />
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
              {/* Organization */}
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

              {/* Site / Location — inline text + GPS button */}
              <div className="space-y-2">
                <label htmlFor="site" className="text-sm font-medium">
                  Site / Location
                </label>
                <div className="flex gap-2">
                  <Input
                    id="site"
                    value={formData.site}
                    onChange={(e) => setFormData(prev => ({ ...prev, site: e.target.value }))}
                    placeholder="e.g. Camp Thunderbird, Lake Wylie, SC"
                    disabled={loading}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleLocationCapture()}
                    disabled={locationLoading || loading}
                    className="shrink-0"
                  >
                    {locationLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <MapPin className={formData.latitude && formData.longitude ? "w-4 h-4 text-success" : "w-4 h-4"} />
                    )}
                    <span className="ml-2 hidden sm:inline">
                      {locationLoading ? "Getting GPS..." : formData.latitude && formData.longitude ? "Location Captured" : "Get Location"}
                    </span>
                  </Button>
                  {formData.latitude && formData.longitude && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleClearLocation}
                      className="shrink-0 text-destructive hover:text-destructive"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                {formData.latitude && formData.longitude && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Info className="w-3 h-3" />
                    GPS: {formData.latitude.toFixed(6)}, {formData.longitude.toFixed(6)}
                  </p>
                )}
              </div>

              {/* Trainer of Record */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Trainer of Record</label>
                <p className="text-sm text-muted-foreground">
                  {trainerName || "Will be set from your profile"}
                </p>
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
                  onClick={handleBack}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>

      <DiscardDraftDialog
        open={showDiscardDialog}
        onStay={() => setShowDiscardDialog(false)}
        onDiscard={() => { setShowDiscardDialog(false); goBack(navigate); }}
      />
    </div>
  );
}
