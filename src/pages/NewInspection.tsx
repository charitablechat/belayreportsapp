 import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { goBack } from "@/lib/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, MapPin, CloudOff, Info, X, Loader2 } from "lucide-react";
import { PreviousInspectionDatePicker } from "@/components/PreviousInspectionDatePicker";
import ropeWorksLogo from "@/assets/rope-works-logo.png";
import { saveInspectionOffline, queueOperation } from "@/lib/offline-storage";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { OrganizationAutocomplete } from "@/components/OrganizationAutocomplete";
import { getCurrentLocationWithAddress, getGeolocationErrorMessage } from "@/lib/geolocation";
import { getUserWithCache, getCachedUser } from "@/lib/cached-auth";
import { triggerHaptic } from "@/lib/haptics";
import { getCachedProfile } from "@/lib/profile-cache";
import { toast } from "sonner";

export default function NewInspection() {
  const navigate = useNavigate();
  const { isOnline } = useNetworkStatus();
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
   const isSubmitting = useRef(false);
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
            // Pre-populate previous_inspector with user's name
            if (fullName) {
              setFormData(prev => ({
                ...prev,
                previous_inspector: prev.previous_inspector || fullName
              }));
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
        location: position.address,
        latitude: position.latitude,
        longitude: position.longitude,
      }));
      
      triggerHaptic('success');
      toast.success("Location captured", {
        description: position.address
      });
      
      if (import.meta.env.DEV) {
        console.log('[NewInspection] Location captured:', position);
      }
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
      location: "",
      latitude: null,
      longitude: null,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.organization.trim() || !formData.location.trim()) {
      toast.error("Required fields missing", {
        description: "Organization and Location are required."
      });
      return;
    }
     
     // Prevent double submission
     if (isSubmitting.current || loading) {
       return;
     }
     
     isSubmitting.current = true;
    triggerHaptic('medium');
    setLoading(true);

    try {
      // Get user from cache or online - works offline!
      const user = await getUserWithCache();
      if (!user) {
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

        // Clean up empty strings to null for database
        const cleanedFormData = {
          organization: formData.organization || '',
          location: formData.location || '',
          onsite_contact: formData.onsite_contact || null,
          previous_inspector: formData.previous_inspector || null,
          previous_inspection_date: formData.previous_inspection_date || null,
          course_history: formData.course_history || null,
          latitude: formData.latitude,
          longitude: formData.longitude,
        };

        if (isOnline) {
        // Create in Supabase
        if (import.meta.env.DEV) {
          console.log('[NewInspection] Submitting to Supabase:', {
            ...cleanedFormData,
            inspector_id: user.id,
            status: "draft",
          });
        }
        
        const { data, error } = await supabase
          .from("inspections")
          .insert({
            ...cleanedFormData,
            inspector_id: user.id,
            status: "draft",
          })
          .select()
          .single();

        if (error) throw error;

        // Get cached inspector profile to attach to offline data
        const profile = await getCachedProfile(user.id);

        // Cache offline with inspector profile data
        await saveInspectionOffline({
          ...data,
          synced_at: new Date().toISOString(),
          inspector: profile || { first_name: null, last_name: null, avatar_url: null },
        });

        navigate(`/inspection/${data.id}`);
        
        if (import.meta.env.DEV) {
          console.log('[NewInspection] Created and synced to Supabase');
        }
      } else {
        // Create offline only
        await saveInspectionOffline(newInspection);
        await queueOperation('create', tempId, newInspection);

        navigate(`/inspection/${tempId}`);
        
        if (import.meta.env.DEV) {
          console.log('[NewInspection] Created offline with temp ID:', tempId);
        }
      }
      
      triggerHaptic('success');
    } catch (error: any) {
      console.error("Error creating inspection:", error);
      triggerHaptic('error');
       
       // Show error toast to user
       toast.error("Failed to create inspection", {
         description: error.message || "Please try again"
       });
    } finally {
      setLoading(false);
       isSubmitting.current = false;
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
                <Label htmlFor="organization">Organization <span className="text-destructive">*</span></Label>
                <OrganizationAutocomplete
                  value={formData.organization}
                  onChange={(value) => setFormData(prev => ({ ...prev, organization: value }))}
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="location">Location <span className="text-destructive">*</span></Label>
                <div className="flex gap-2">
                  <Input
                    id="location"
                    value={formData.location}
                    onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                    placeholder="Enter location"
                    className="flex-1"
                  />
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={handleLocationCapture} 
                    disabled={locationLoading}
                    className="min-w-[140px]"
                  >
                    {locationLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        <span className="text-sm">Getting GPS...</span>
                      </>
                    ) : formData.latitude && formData.longitude ? (
                      <>
                        <MapPin className="w-4 h-4 text-green-600 mr-2" />
                        <span className="text-sm">Update</span>
                      </>
                    ) : (
                      <>
                        <MapPin className="w-4 h-4 mr-2" />
                        <span className="text-sm">Get Location</span>
                      </>
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
                  <PreviousInspectionDatePicker
                    value={formData.previous_inspection_date}
                    onChange={(value) => setFormData(prev => ({ ...prev, previous_inspection_date: value }))}
                    disabled={loading}
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
                   {loading ? (
                     <>
                       <Loader2 className="w-4 h-4 animate-spin mr-2" />
                       Creating...
                     </>
                   ) : (
                     isOnline ? "Create Inspection" : "Create Locally"
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
