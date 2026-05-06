import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { goBack } from "@/lib/navigation";
import { DiscardDraftDialog } from "@/components/DiscardDraftDialog";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, MapPin, CloudOff, Info, X, Loader2, Upload, FileText, CheckCircle2 } from "lucide-react";
import { PreviousInspectionDatePicker } from "@/components/PreviousInspectionDatePicker";
import ropeWorksLogo from "@/assets/rope-works-logo.png";
import { saveInspectionOffline, queueOperation } from "@/lib/offline-storage";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { OrganizationAutocomplete } from "@/components/OrganizationAutocomplete";
import { getCurrentLocationWithAddress, getGeolocationErrorMessage } from "@/lib/geolocation";
import { getUserWithCache, getCachedUser, getOfflineUserId } from "@/lib/cached-auth";
import { triggerHaptic } from "@/lib/haptics";
import { getCachedProfile } from "@/lib/profile-cache";
import { toast } from "sonner";

// Types for extracted child data
interface ExtractedSystem {
  name?: string;
  system_name?: string;
  result?: string;
  comments?: string;
}
interface ExtractedEquipment {
  equipment_type: string;
  equipment_category: string;
  result?: string;
  comments?: string;
  
  production_year?: string;
  rope_type?: string;
}
interface ExtractedZipline {
  zipline_name: string;
  cable_type?: string;
  cable_length?: number;
  braking_system?: string;
  ead_system?: string;
  load_tension?: number;
  unload_tension?: number;
  result?: string;
  comments?: string;
}
interface ExtractedStandard {
  standard_name: string;
  has_documentation?: boolean;
  comments?: string;
}
interface ExtractedSummary {
  repairs_performed?: string;
  critical_actions?: string;
  future_considerations?: string;
  next_inspection_date?: string;
}
interface ExtractedChildData {
  systems: ExtractedSystem[];
  equipment: ExtractedEquipment[];
  ziplines: ExtractedZipline[];
  standards: ExtractedStandard[];
  summary: ExtractedSummary | null;
}

export default function NewInspection() {
  const navigate = useNavigate();
  const { isOnline } = useNetworkStatus();
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importedFileName, setImportedFileName] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isSubmitting = useRef(false);

  const [childData, setChildData] = useState<ExtractedChildData>({
    systems: [],
    equipment: [],
    ziplines: [],
    standards: [],
    summary: null,
  });

  const [formData, setFormData] = useState({
    organization: "",
    location: "",
    onsite_contact: "",
    previous_inspector: "",
    previous_inspection_date: "",
    course_history: "",
    acct_number: "",
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
            setFormData(prev => ({
              ...prev,
              previous_inspector: prev.previous_inspector || fullName,
              acct_number: prev.acct_number || profile.acct_number || "",
            }));
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
      // In silent mode, only set if reverse geocode produced a real address (not coords fallback)
      const isCoordFallback = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(position.address);
      if (silent && isCoordFallback) {
        return;
      }
      setFormData(prev => ({
        ...prev,
        location: position.address,
        latitude: position.latitude,
        longitude: position.longitude,
      }));

      if (!silent) {
        triggerHaptic('success');
        toast.success("Location captured", { description: position.address });
      }

      if (import.meta.env.DEV) {
        console.log('[NewInspection] Location captured:', position, { silent });
      }
    } catch (error: any) {
      if (silent) {
        console.warn("[NewInspection] Silent location capture failed:", error?.message || error);
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

  // Auto-capture location once on mount (silent — no toasts, no coord fallback)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (formData.location) return;
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
      location: "",
      latitude: null,
      longitude: null,
    }));
  };

  // --- Import from previous report ---
  const handleFileImport = useCallback(async (file: File) => {
    const ext = file.name.toLowerCase().split(".").pop();
    if (ext !== "docx" && ext !== "doc" && ext !== "pdf" && ext !== "md" && ext !== "markdown") {
      toast.error("Unsupported file", { description: "Please upload a .docx, .doc, .pdf, or .md file." });
      return;
    }

    if (!navigator.onLine) {
      toast.error("You're offline", { description: "Document import requires an internet connection. Please try again when online." });
      return;
    }

    setImportLoading(true);
    triggerHaptic('medium');

    try {
      const { extractTextFromFile, isClientExtractable } = await import("@/lib/import-text-extractor");

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120_000);

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-inspection-docx`;
      const baseHeaders: Record<string, string> = {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      };

      let res: Response;
      try {
        if (isClientExtractable(ext!)) {
          // Fast path: extract text in the browser → send JSON. No file size limit.
          const text = await extractTextFromFile(file);
          res = await fetch(url, {
            method: "POST",
            signal: controller.signal,
            headers: { ...baseHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({ fileName: file.name, text }),
          });
        } else {
          // Legacy .doc fallback: server-side extraction. Keep modest size guard.
          if (file.size > 20 * 1024 * 1024) {
            throw new Error("Legacy .doc files must be under 20 MB. Please save as .docx and try again.");
          }
          const formPayload = new FormData();
          formPayload.append("file", file);
          res = await fetch(url, {
            method: "POST",
            signal: controller.signal,
            headers: baseHeaders,
            body: formPayload,
          });
        }
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        if (fetchErr.name === "AbortError") {
          throw new Error("Import took too long — try a smaller file or different format.");
        }
        throw fetchErr;
      }
      clearTimeout(timeoutId);

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errBody.error || `Server returned ${res.status}`);
      }

      const { data, truncated, partial } = await res.json();

      // Populate form fields
      setFormData(prev => ({
        ...prev,
        organization: data.organization || prev.organization,
        location: data.location || prev.location,
        onsite_contact: data.onsite_contact || prev.onsite_contact,
        previous_inspector: data.previous_inspector || prev.previous_inspector,
        previous_inspection_date: data.previous_inspection_date || prev.previous_inspection_date,
        course_history: data.course_history || prev.course_history,
      }));

      // Store child data
      setChildData({
        systems: data.systems || [],
        equipment: [], // Temporarily disabled — keep AI extraction but skip auto-populate
        ziplines: data.ziplines || [],
        standards: data.standards || [],
        summary: data.summary || null,
      });

      setImportedFileName(file.name);
      triggerHaptic('success');

      const counts = [
        data.systems?.length && `${data.systems.length} systems`,
        data.equipment?.length && `${data.equipment.length} equipment`,
        data.ziplines?.length && `${data.ziplines.length} ziplines`,
        data.standards?.length && `${data.standards.length} standards`,
      ].filter(Boolean);

      toast.success("Report imported successfully", {
        description: counts.length > 0
          ? `Found ${counts.join(", ")}`
          : "Form fields populated from document",
      });

      if (partial) {
        toast.warning("Import may be incomplete", {
          description: "Some items were truncated due to document size. Please verify all items were imported.",
          duration: 8000,
        });
      } else if (truncated) {
        toast.warning("Document was too large to process completely", {
          description: "Some elements at the end may be missing. Please verify all items were imported.",
          duration: 8000,
        });
      }
    } catch (error: any) {
      console.error("[NewInspection] Import error:", error);
      triggerHaptic('error');
      toast.error("Import failed", { description: error.message || "Could not parse the document." });
    } finally {
      setImportLoading(false);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileImport(file);
  }, [handleFileImport]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const onDragLeave = useCallback(() => setDragActive(false), []);

  // --- end import ---

  const hasChanges =
    formData.organization.trim() !== "" ||
    formData.location.trim() !== "" ||
    formData.onsite_contact.trim() !== "" ||
    formData.course_history.trim() !== "";
  const handleBack = () => {
    if (hasChanges) setShowDiscardDialog(true);
    else goBack(navigate);
  };

  /** Bulk-insert child rows after inspection is created */
  /** Bulk-insert child rows after inspection is created */
  const insertChildData = async (inspectionId: string) => {
    const promises: PromiseLike<any>[] = [];

    if (childData.systems.length > 0) {
      const rows = childData.systems.map((s, i) => ({
        inspection_id: inspectionId,
        name: s.name || null,
        system_name: s.system_name || null,
        result: s.result || "Not Inspected",
        comments: s.comments || null,
        display_order: i,
        is_divider: false,
      }));
      console.log(`[NewInspection] Inserting ${rows.length} systems`);
      promises.push(
        supabase.from("inspection_systems").insert(rows)
          .then(({ error }) => { if (error) throw error; })
      );
    }

    if (childData.equipment.length > 0) {
      const normalizeCategory = (cat: string): string => {
        const c = (cat || "").toLowerCase();
        if (c.includes("harness")) return "harnesses";
        if (c.includes("helmet") || c.includes("head")) return "helmets";
        if (c.includes("lanyard") || c.includes("sling")) return "lanyards";
        if (c.includes("carabiner") || c.includes("connector") || c.includes("quicklink") || c.includes("hardware")) return "connectors";
        if (c.includes("rope")) return "rope";
        if (c.includes("belay") || c.includes("descent")) return "belay";
        if (c.includes("trolley") || c.includes("pulley")) return "trolleys";
        return "other";
      };
      const rows = childData.equipment.map((e, i) => ({
        inspection_id: inspectionId,
        equipment_type: e.equipment_type || "Unknown",
        equipment_category: normalizeCategory(e.equipment_category),
        result: e.result || "Not Inspected",
        comments: e.comments || null,
        production_year: e.production_year || null,
        rope_type: e.rope_type || null,
        display_order: i,
      }));
      console.log(`[NewInspection] Inserting ${rows.length} equipment`);
      promises.push(
        supabase.from("inspection_equipment").insert(rows)
          .then(({ error }) => { if (error) throw error; })
      );
    }

    if (childData.ziplines.length > 0) {
      const rows = childData.ziplines.map((z, i) => ({
        inspection_id: inspectionId,
        zipline_name: z.zipline_name || "Unknown",
        cable_type: z.cable_type || null,
        cable_length: z.cable_length || null,
        braking_system: z.braking_system || null,
        ead_system: z.ead_system || null,
        load_tension: z.load_tension || null,
        unload_tension: z.unload_tension || null,
        result: z.result || "Not Inspected",
        comments: z.comments || null,
        display_order: i,
      }));
      console.log(`[NewInspection] Inserting ${rows.length} ziplines`);
      promises.push(
        supabase.from("inspection_ziplines").insert(rows)
          .then(({ error }) => { if (error) throw error; })
      );
    }

    if (childData.standards.length > 0) {
      const rows = childData.standards.map((s) => ({
        inspection_id: inspectionId,
        standard_name: s.standard_name || "Unknown",
        has_documentation: s.has_documentation ?? null,
        comments: s.comments || null,
      }));
      console.log(`[NewInspection] Inserting ${rows.length} standards`);
      promises.push(
        supabase.from("inspection_standards").insert(rows)
          .then(({ error }) => { if (error) throw error; })
      );
    }

    if (childData.summary) {
      console.log(`[NewInspection] Inserting summary`);
      promises.push(
        supabase.from("inspection_summary").insert({
          inspection_id: inspectionId,
          repairs_performed: childData.summary.repairs_performed || null,
          critical_actions: childData.summary.critical_actions || null,
          future_considerations: childData.summary.future_considerations || null,
          next_inspection_date: childData.summary.next_inspection_date || null,
        }).then(({ error }) => { if (error) throw error; })
      );
    }

    const results = await Promise.allSettled(promises);
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      console.error("[NewInspection] Child insert failures:", failures.map((f: any) => f.reason?.message || f.reason));
    } else {
      console.log("[NewInspection] All child inserts succeeded");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Block all writes in Lovable preview to protect production data
    if ((await import('@/lib/environment')).isLovablePreview()) {
      toast.info("Preview mode", { description: "Changes are not saved in the Lovable preview." });
      return;
    }

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
      let user = await getUserWithCache();
      if (!user) {
        const offlineId = getOfflineUserId();
        if (offlineId) {
          user = { id: offlineId } as any;
        } else {
          toast.error("Please sign in to create reports");
          setLoading(false);
          isSubmitting.current = false;
          return;
        }
      }

      const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      // S5: stable client idempotency key — derived from temp id (already a UUID-shaped string).
      // Used by the sync layer to detect when the same offline record is being synced twice
      // (server-enforced via partial unique index on (inspector_id, client_idempotency_key)).
      const clientIdempotencyKey = crypto.randomUUID();

      const newInspection = {
        ...formData,
        id: tempId,
        inspector_id: user.id,
        status: "draft",
        acct_number: formData.acct_number || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        inspection_date: new Date().toISOString().split('T')[0],
        client_idempotency_key: clientIdempotencyKey,
      };

      const cleanedFormData = {
        organization: formData.organization || '',
        location: formData.location || '',
        onsite_contact: formData.onsite_contact || null,
        previous_inspector: formData.previous_inspector || null,
        previous_inspection_date: formData.previous_inspection_date || null,
        course_history: formData.course_history || null,
        acct_number: formData.acct_number || null,
        latitude: formData.latitude,
        longitude: formData.longitude,
      };

      if (isOnline) {
        const syncTimestamp = new Date().toISOString();
        const { data, error } = await supabase
          .from("inspections")
          .insert({
            ...cleanedFormData,
            inspector_id: user.id,
            status: "draft",
            synced_at: syncTimestamp,
            client_idempotency_key: clientIdempotencyKey,
          })
          .select()
          .single();

        if (error) throw error;

        // Insert child data from import (if any)
        const hasChildData =
          childData.systems.length > 0 ||
          childData.equipment.length > 0 ||
          childData.ziplines.length > 0 ||
          childData.standards.length > 0 ||
          childData.summary;

        if (hasChildData) {
          await insertChildData(data.id);
        }

        const profile = await getCachedProfile(user.id);
        await saveInspectionOffline({
          ...data,
          synced_at: new Date().toISOString(),
          inspector: profile || { first_name: null, last_name: null, avatar_url: null },
        });

        navigate(`/inspection/${data.id}`);
      } else {
        await saveInspectionOffline(newInspection);
        await queueOperation('create', tempId, newInspection);
        navigate(`/inspection/${tempId}`);
      }
      
      triggerHaptic('success');
    } catch (error: any) {
      console.error("Error creating inspection:", error);
      triggerHaptic('error');
      toast.error("Failed to create inspection", {
        description: error.message || "Please try again"
      });
    } finally {
      setLoading(false);
      isSubmitting.current = false;
    }
  };

  const totalImportedItems =
    childData.systems.length +
    childData.equipment.length +
    childData.ziplines.length +
    childData.standards.length;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-white/20 bg-white/10 dark:bg-black/20 backdrop-blur-[12px] shadow-md shadow-black/5">
        <div className="container mx-auto px-2 md:px-4 py-4 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={handleBack}>
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline ml-2">Back to Dashboard</span>
          </Button>
          <img src={ropeWorksLogo} alt="Rope Works" className="h-8 md:h-10 w-auto object-contain cursor-pointer hover:opacity-80 transition-opacity" onClick={() => navigate('/dashboard')} />
        </div>
      </header>

      <main className="container mx-auto px-2 md:px-4 py-8 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">New Inspection Report</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Import from previous report */}
            <div
              className={`mb-6 border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
                dragActive
                  ? "border-primary bg-primary/5"
                  : importedFileName
                  ? "border-accent bg-accent/5"
                  : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30"
              }`}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onClick={() => !importLoading && fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.doc,.pdf,.md"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileImport(file);
                  e.target.value = "";
                }}
              />
              {importLoading ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <p className="text-sm font-medium text-primary">Analyzing report...</p>
                  <p className="text-xs text-muted-foreground">This may take a moment</p>
                </div>
              ) : importedFileName ? (
                <div className="flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-8 h-8 text-accent-foreground" />
                  <p className="text-sm font-medium text-foreground">
                    Imported from <span className="text-primary">{importedFileName}</span>
                  </p>
                  {totalImportedItems > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {totalImportedItems} items will be pre-filled • Click to re-import
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="flex items-center gap-2">
                    <Upload className="w-5 h-5 text-muted-foreground" />
                    <FileText className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    Import from Previous Report
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Drop a .docx, .pdf, or .md file (any size — only text is read; photos are ignored)
                  </p>
                </div>
              )}
            </div>

            {!isOnline && (
              <Alert className="mb-6 border-warning bg-warning/10">
                <CloudOff className="h-4 w-4 text-warning" />
                <AlertDescription className="text-foreground">
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
                    onClick={() => handleLocationCapture()} 
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
                        <MapPin className="w-4 h-4 text-primary mr-2" />
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

              {/* Show import summary if child data present */}
              {totalImportedItems > 0 && (
                <Alert className="border-primary/30 bg-primary/5">
                  <FileText className="h-4 w-4 text-primary" />
                  <AlertDescription className="text-sm">
                    <strong>Pre-filled from import:</strong>{" "}
                    {[
                      childData.systems.length > 0 && `${childData.systems.length} systems`,
                      childData.equipment.length > 0 && `${childData.equipment.length} equipment`,
                      childData.ziplines.length > 0 && `${childData.ziplines.length} ziplines`,
                      childData.standards.length > 0 && `${childData.standards.length} standards`,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    . Original results will be preserved where available.
                  </AlertDescription>
                </Alert>
              )}

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
