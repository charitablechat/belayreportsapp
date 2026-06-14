/**
 * JCFForm — Job Completion Form edit page.
 *
 * Belay-native parity port. JCF is a single flat document (no nested
 * inventory/equipment/standards children), so this is intentionally simpler
 * than TrainingForm. It still honors every cross-cutting Belay contract:
 *   - Offline-first save via saveJCFOffline + queueJCFOperation
 *   - Completion lock (status='completed') disables all inputs; admins
 *     override via the existing CompletionLockDialog flow
 *   - Attestation dialog on first completion (Legal Defensibility Attestation)
 *   - Lovable preview is read-only (isLovablePreview guard)
 *   - HTML generation via generate-jcf-html with Promise.race timeout, plus
 *     Report Output Integrity cache bypass (use latest_report_html if present
 *     and the row hasn't been touched since)
 *   - Photos via PhotoCapture/PhotoGallery with tableName='jcf_photos',
 *     foreignKeyColumn='jcf_id', storageBucket='jcf-photos'
 *   - Belay branding (belay-reports-wide.gif), never Adventure Guild
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { goBack } from "@/lib/navigation";
import { getUserWithCache, getOfflineUserId } from "@/lib/cached-auth";
import { getCachedProfile } from "@/lib/profile-cache";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import {
  saveJCFOffline,
  queueJCFOperation,
  getOfflineJCF,
  type DbRow,
} from "@/lib/offline-storage";
import { isLovablePreview } from "@/lib/environment";
import { triggerHaptic } from "@/lib/haptics";
import { triggerCompletionConfetti } from "@/lib/confetti";
import { formatReportFilename, formatReportTitle } from "@/lib/report-naming";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  CheckCircle,
  CloudOff,
  FileDown,
  Loader2,
  Lock,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { AttestationDialog } from "@/components/AttestationDialog";
import { CompletionLockDialog } from "@/components/CompletionLockDialog";
import { HtmlReportViewer } from "@/components/HtmlReportViewer";
import PhotoCapture from "@/components/PhotoCapture";
import PhotoGallery from "@/components/PhotoGallery";
import type { AttestationPayload } from "@/lib/attestation";
import belayReportsLogoAsset from "@/assets/belay-reports-wide.gif.asset.json";
const belayReportsLogo = belayReportsLogoAsset.url;

const GENERATION_TIMEOUT = 45_000;

type JCF = DbRow & {
  organization?: string;
  location?: string;
  date_of_work?: string;
  status?: string;
  inspector_id?: string;
  staff_names?: string;
  client_name?: string;
  contact_info?: string;
  address?: string;
  contract_number?: string;
  invoice_number?: string;
  job_status?: string;
  course_type_low?: boolean;
  course_type_high?: boolean;
  course_type_tower?: boolean;
  course_type_zip?: boolean;
  course_type_indoor?: boolean;
  course_type_poletype?: boolean;
  course_type_other?: boolean;
  course_type_other_text?: string;
  fall_protection_cable_grab?: boolean;
  fall_protection_harness?: boolean;
  fall_protection_lift_basket?: boolean;
  fall_protection_alt_access?: boolean;
  fall_protection_other?: boolean;
  fall_protection_other_text?: string;
  manual_present?: boolean | null;
  training_status?: string;
  emergency_number?: string;
  hospital_info?: string;
  num_inspectors?: number | null;
  hours_to_complete?: number | null;
  contracted_work?: string;
  jcf_notes?: string;
  work_needed_to_complete?: string;
  additional_work_performed?: string;
  time_and_materials?: string;
  equipment_left_with_client?: string;
  additional_work_this_year?: string;
  work_needed_next_year?: string;
  items_to_monitor?: string;
  completion_locked?: boolean;
  attestation_signed_at?: string | null;
  latest_report_html?: string | null;
  latest_report_generated_at?: string | null;
};

const COURSE_TYPES: { key: keyof JCF; label: string }[] = [
  { key: "course_type_low", label: "Low" },
  { key: "course_type_high", label: "High" },
  { key: "course_type_tower", label: "Tower" },
  { key: "course_type_zip", label: "Zip" },
  { key: "course_type_indoor", label: "Indoor" },
  { key: "course_type_poletype", label: "Pole-type" },
];

const FALL_PROTECTIONS: { key: keyof JCF; label: string }[] = [
  { key: "fall_protection_cable_grab", label: "Cable grab" },
  { key: "fall_protection_harness", label: "Harness" },
  { key: "fall_protection_lift_basket", label: "Lift basket" },
  { key: "fall_protection_alt_access", label: "Alt. access" },
];

export default function JCFForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isOnline } = useNetworkStatus();

  const [jcf, setJcf] = useState<JCF | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signerId, setSignerId] = useState<string | null>(null);

  const [showCompletionLockDialog, setShowCompletionLockDialog] = useState(false);
  const [showAttestationDialog, setShowAttestationDialog] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);

  const saveTimer = useRef<number | null>(null);

  const isLocked = !!jcf?.completion_locked || jcf?.status === "completed";
  const isReadOnly = isLocked;

  // Load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) return;
      try {
        // Local first
        const local = (await getOfflineJCF(id)) as JCF | null;
        if (local && !cancelled) {
          setJcf(local);
          setLoading(false);
        }
        // Then server (skip for temp- rows that haven't synced yet)
        if (isOnline && !id.startsWith("temp-")) {
          const { data, error } = await supabase
            .from("jcf_reports")
            .select("*")
            .eq("id", id)
            .maybeSingle();
          if (!error && data && !cancelled) {
            const merged = { ...(local || {}), ...data } as JCF;
            setJcf(merged);
            await saveJCFOffline({
              ...data,
              synced_at: data.synced_at ?? new Date().toISOString(),
            });
          }
        }
        // Resolve signer profile
        const userId = (await getUserWithCache())?.id || getOfflineUserId();
        if (userId) {
          setSignerId(userId);
          const profile = await getCachedProfile(userId);
          if (profile && !cancelled) {
            const name = [profile.first_name, profile.last_name]
              .filter(Boolean)
              .join(" ")
              .trim();
            if (name) setSignerName(name);
          }
        }
      } catch (err) {
        console.error("[JCFForm] load failed", err);
        toast.error("Failed to load JCF", {
          description: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isOnline]);

  const persist = useCallback(
    async (next: JCF, opts: { immediate?: boolean } = {}) => {
      if (!id || !next) return;
      if (isLovablePreview()) {
        toast.info("Preview mode", {
          description: "Changes are not saved in the Lovable preview.",
        });
        return;
      }

      const updatedAt = new Date().toISOString();
      const merged: JCF = { ...next, updated_at: updatedAt };
      setJcf(merged);

      // Always write to IDB immediately (offline-first)
      await saveJCFOffline({ ...merged, synced_at: null });

      const flush = async () => {
        setSaving(true);
        try {
          if (isOnline && !id.startsWith("temp-")) {
            const payload = { ...merged };
            delete (payload as any).synced_at;
            delete (payload as any).created_at;
            const { data, error } = await supabase
              .from("jcf_reports")
              .update(payload as any)
              .eq("id", id)
              .select()
              .single();
            if (error) throw error;
            await saveJCFOffline({
              ...data,
              synced_at: new Date().toISOString(),
            });
          } else {
            await queueJCFOperation("update", id, merged);
          }
        } catch (err) {
          console.error("[JCFForm] save failed", err);
          toast.error("Save failed", {
            description: err instanceof Error ? err.message : "Unknown",
          });
        } finally {
          setSaving(false);
        }
      };

      if (opts.immediate) {
        if (saveTimer.current) {
          clearTimeout(saveTimer.current);
          saveTimer.current = null;
        }
        await flush();
      } else {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(flush, 800);
      }
    },
    [id, isOnline],
  );

  const update = useCallback(
    <K extends keyof JCF>(key: K, value: JCF[K]) => {
      if (!jcf || isReadOnly) return;
      persist({ ...jcf, [key]: value });
    },
    [jcf, persist, isReadOnly],
  );

  // Cleanup pending save on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const triggerComplete = () => {
    if (!jcf) return;
    if (jcf.attestation_signed_at) {
      // Already attested earlier (re-completion path) — go straight through
      void completeJCF();
    } else {
      setShowAttestationDialog(true);
    }
  };

  const completeJCF = useCallback(
    async (attestation?: AttestationPayload) => {
      if (!jcf || !id) return;
      const next: JCF = {
        ...jcf,
        status: "completed",
        completion_locked: true,
        ...(attestation ?? {}),
      };
      await persist(next, { immediate: true });
      triggerHaptic("success");
      triggerCompletionConfetti();
      toast.success("JCF completed");
    },
    [jcf, id, persist],
  );

  const generateHtml = async () => {
    if (!jcf || !id) return;
    if (id.startsWith("temp-")) {
      toast.error("Sync required", {
        description:
          "This JCF hasn't synced yet. Reconnect and let it sync before generating a report.",
      });
      return;
    }

    setIsGenerating(true);
    const toastId = toast.loading("Generating report...");
    try {
      // Report Output Integrity bypass: if we have cached HTML and the row
      // hasn't been touched since generation, skip the round-trip entirely.
      const cached = jcf.latest_report_html;
      const gen = jcf.latest_report_generated_at
        ? new Date(jcf.latest_report_generated_at).getTime()
        : 0;
      const upd = jcf.updated_at ? new Date(jcf.updated_at).getTime() : 0;
      if (cached && gen >= upd) {
        toast.dismiss(toastId);
        setReportHtml(cached);
        setViewerOpen(true);
        return;
      }

      const generatePromise = supabase.functions.invoke("generate-jcf-html", {
        body: { jcfId: id },
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("TIMEOUT: Report generation took too long")),
          GENERATION_TIMEOUT,
        ),
      );

      const { data, error } = (await Promise.race([
        generatePromise,
        timeoutPromise,
      ])) as { data: any; error: any };
      if (error) throw error;

      let html: string;
      if (data?.htmlUrl) {
        const r = await fetch(data.htmlUrl);
        if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
        html = await r.text();
      } else if (data?.html) {
        html = data.html;
      } else {
        throw new Error("No HTML returned");
      }

      // Cache locally on the row so subsequent opens hit the bypass
      const nowIso = new Date().toISOString();
      const cachedNext = {
        ...jcf,
        latest_report_html: html,
        latest_report_generated_at: nowIso,
      };
      setJcf(cachedNext);
      await saveJCFOffline({ ...cachedNext, synced_at: jcf.synced_at ?? null });

      toast.dismiss(toastId);
      setReportHtml(html);
      setViewerOpen(true);
    } catch (err: any) {
      toast.dismiss(toastId);
      console.error("[JCFForm] generate failed", err);
      toast.error(
        err?.message?.includes("TIMEOUT")
          ? "Report generation timed out"
          : "Failed to generate report",
        { description: err?.message || "Please try again." },
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const filename = useMemo(
    () =>
      formatReportFilename(
        jcf?.organization,
        // report-naming type union doesn't include 'jcf'; daily-assessment
        // shares the same [Org]_[MM]_[YYYY] pattern so the filename matches
        // the Belay convention without requiring a separate code path.
        "daily-assessment",
        "html",
      ),
    [jcf?.organization],
  );
  const viewerTitle = useMemo(
    () => `JCF — ${jcf?.organization || "Report"}`,
    [jcf?.organization],
  );

  if (loading || !jcf) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-white/20 bg-white/10 dark:bg-black/20 backdrop-blur-[12px] shadow-md shadow-black/5 sticky top-0 z-30">
        <div className="container mx-auto px-2 md:px-4 py-3 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => goBack(navigate)}>
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline ml-2">Back</span>
          </Button>
          <img
            src={belayReportsLogo}
            alt="Belay Reports"
            className="h-8 md:h-10 w-auto object-contain cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => navigate("/dashboard")}
          />
          <div className="flex items-center gap-2">
            {saving && (
              <span className="text-xs text-muted-foreground hidden sm:flex items-center gap-1">
                <Save className="w-3 h-3 animate-pulse" /> Saving…
              </span>
            )}
            {isLocked && (
              <Badge variant="secondary" className="gap-1">
                <Lock className="w-3 h-3" /> Locked
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={generateHtml}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileDown className="w-4 h-4" />
              )}
              <span className="hidden sm:inline ml-2">Generate</span>
            </Button>
            {!isLocked && (
              <Button size="sm" onClick={triggerComplete}>
                <CheckCircle className="w-4 h-4" />
                <span className="hidden sm:inline ml-2">Complete</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-2 md:px-4 py-6 max-w-4xl space-y-6">
        {!isOnline && (
          <Alert className="border-warning bg-warning/10">
            <CloudOff className="h-4 w-4 text-warning" />
            <AlertDescription>
              Working offline — changes will sync automatically when you reconnect.
            </AlertDescription>
          </Alert>
        )}

        {isLocked && (
          <Alert>
            <Lock className="h-4 w-4" />
            <AlertDescription>
              This JCF is locked. Admins can unlock it from the report-lock
              dialog to make corrections.
              <Button
                variant="link"
                size="sm"
                className="ml-2 h-auto p-0"
                onClick={() => setShowCompletionLockDialog(true)}
              >
                Open lock dialog
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Job info */}
        <Card>
          <CardHeader>
            <CardTitle>Job Information</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Organization">
              <Input
                value={jcf.organization || ""}
                onChange={(e) => update("organization", e.target.value)}
                disabled={isReadOnly}
              />
            </Field>
            <Field label="Location">
              <Input
                value={jcf.location || ""}
                onChange={(e) => update("location", e.target.value)}
                disabled={isReadOnly}
              />
            </Field>
            <Field label="Date of work">
              <Input
                type="date"
                value={jcf.date_of_work || ""}
                onChange={(e) => update("date_of_work", e.target.value)}
                disabled={isReadOnly}
              />
            </Field>
            <Field label="Job status">
              <select
                className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                value={jcf.job_status || "ongoing"}
                onChange={(e) => update("job_status", e.target.value)}
                disabled={isReadOnly}
              >
                <option value="ongoing">Ongoing</option>
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
              </select>
            </Field>
            <Field label="Client name">
              <Input
                value={jcf.client_name || ""}
                onChange={(e) => update("client_name", e.target.value)}
                disabled={isReadOnly}
              />
            </Field>
            <Field label="Contact info">
              <Input
                value={jcf.contact_info || ""}
                onChange={(e) => update("contact_info", e.target.value)}
                disabled={isReadOnly}
              />
            </Field>
            <Field label="Address" className="md:col-span-2">
              <Input
                value={jcf.address || ""}
                onChange={(e) => update("address", e.target.value)}
                disabled={isReadOnly}
              />
            </Field>
            <Field label="Contract #">
              <Input
                value={jcf.contract_number || ""}
                onChange={(e) => update("contract_number", e.target.value)}
                disabled={isReadOnly}
              />
            </Field>
            <Field label="Invoice #">
              <Input
                value={jcf.invoice_number || ""}
                onChange={(e) => update("invoice_number", e.target.value)}
                disabled={isReadOnly}
              />
            </Field>
            <Field label="Staff names" className="md:col-span-2">
              <Input
                value={jcf.staff_names || ""}
                onChange={(e) => update("staff_names", e.target.value)}
                disabled={isReadOnly}
              />
            </Field>
            <Field label="# Inspectors">
              <Input
                type="number"
                value={jcf.num_inspectors ?? ""}
                onChange={(e) =>
                  update(
                    "num_inspectors",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
                disabled={isReadOnly}
              />
            </Field>
            <Field label="Hours to complete">
              <Input
                type="number"
                step="0.25"
                value={jcf.hours_to_complete ?? ""}
                onChange={(e) =>
                  update(
                    "hours_to_complete",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
                disabled={isReadOnly}
              />
            </Field>
          </CardContent>
        </Card>

        {/* Course types */}
        <Card>
          <CardHeader>
            <CardTitle>Course Type</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {COURSE_TYPES.map((opt) => (
                <CheckboxRow
                  key={String(opt.key)}
                  label={opt.label}
                  checked={!!jcf[opt.key]}
                  onChange={(v) => update(opt.key as any, v as any)}
                  disabled={isReadOnly}
                />
              ))}
              <CheckboxRow
                label="Other"
                checked={!!jcf.course_type_other}
                onChange={(v) => update("course_type_other", v as any)}
                disabled={isReadOnly}
              />
            </div>
            {jcf.course_type_other && (
              <Input
                placeholder="Other course type…"
                value={jcf.course_type_other_text || ""}
                onChange={(e) =>
                  update("course_type_other_text", e.target.value)
                }
                disabled={isReadOnly}
              />
            )}
          </CardContent>
        </Card>

        {/* Fall protection */}
        <Card>
          <CardHeader>
            <CardTitle>Fall Protection Used</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {FALL_PROTECTIONS.map((opt) => (
                <CheckboxRow
                  key={String(opt.key)}
                  label={opt.label}
                  checked={!!jcf[opt.key]}
                  onChange={(v) => update(opt.key as any, v as any)}
                  disabled={isReadOnly}
                />
              ))}
              <CheckboxRow
                label="Other"
                checked={!!jcf.fall_protection_other}
                onChange={(v) => update("fall_protection_other", v as any)}
                disabled={isReadOnly}
              />
            </div>
            {jcf.fall_protection_other && (
              <Input
                placeholder="Other fall protection…"
                value={jcf.fall_protection_other_text || ""}
                onChange={(e) =>
                  update("fall_protection_other_text", e.target.value)
                }
                disabled={isReadOnly}
              />
            )}
          </CardContent>
        </Card>

        {/* Manual & training */}
        <Card>
          <CardHeader>
            <CardTitle>On-Site Training</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Checkbox
                id="manual_present"
                checked={!!jcf.manual_present}
                onCheckedChange={(v) =>
                  update("manual_present", v === true ? true : false)
                }
                disabled={isReadOnly}
              />
              <Label htmlFor="manual_present">Operations manual on site</Label>
            </div>
            <Field label="Training status">
              <Textarea
                rows={2}
                value={jcf.training_status || ""}
                onChange={(e) => update("training_status", e.target.value)}
                disabled={isReadOnly}
              />
            </Field>
          </CardContent>
        </Card>

        {/* Emergency */}
        <Card>
          <CardHeader>
            <CardTitle>Emergency Information</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Emergency number">
              <Input
                value={jcf.emergency_number || ""}
                onChange={(e) => update("emergency_number", e.target.value)}
                disabled={isReadOnly}
              />
            </Field>
            <Field label="Nearest hospital">
              <Input
                value={jcf.hospital_info || ""}
                onChange={(e) => update("hospital_info", e.target.value)}
                disabled={isReadOnly}
              />
            </Field>
          </CardContent>
        </Card>

        {/* Work narratives */}
        <Card>
          <CardHeader>
            <CardTitle>Work Performed & Notes</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4">
            <Field label="Contracted work">
              <Textarea
                rows={3}
                value={jcf.contracted_work || ""}
                onChange={(e) => update("contracted_work", e.target.value)}
                disabled={isReadOnly}
              />
            </Field>
            <Field label="Additional work performed">
              <Textarea
                rows={3}
                value={jcf.additional_work_performed || ""}
                onChange={(e) =>
                  update("additional_work_performed", e.target.value)
                }
                disabled={isReadOnly}
              />
            </Field>
            <Field label="Work needed to complete">
              <Textarea
                rows={3}
                value={jcf.work_needed_to_complete || ""}
                onChange={(e) =>
                  update("work_needed_to_complete", e.target.value)
                }
                disabled={isReadOnly}
              />
            </Field>
            <Field label="Time & materials">
              <Textarea
                rows={3}
                value={jcf.time_and_materials || ""}
                onChange={(e) => update("time_and_materials", e.target.value)}
                disabled={isReadOnly}
              />
            </Field>
            <Field label="Equipment left with client">
              <Textarea
                rows={3}
                value={jcf.equipment_left_with_client || ""}
                onChange={(e) =>
                  update("equipment_left_with_client", e.target.value)
                }
                disabled={isReadOnly}
              />
            </Field>
            <Field label="Additional work this year">
              <Textarea
                rows={3}
                value={jcf.additional_work_this_year || ""}
                onChange={(e) =>
                  update("additional_work_this_year", e.target.value)
                }
                disabled={isReadOnly}
              />
            </Field>
            <Field label="Work needed next year">
              <Textarea
                rows={3}
                value={jcf.work_needed_next_year || ""}
                onChange={(e) =>
                  update("work_needed_next_year", e.target.value)
                }
                disabled={isReadOnly}
              />
            </Field>
            <Field label="Items to monitor">
              <Textarea
                rows={3}
                value={jcf.items_to_monitor || ""}
                onChange={(e) => update("items_to_monitor", e.target.value)}
                disabled={isReadOnly}
              />
            </Field>
            <Field label="JCF notes">
              <Textarea
                rows={4}
                value={jcf.jcf_notes || ""}
                onChange={(e) => update("jcf_notes", e.target.value)}
                disabled={isReadOnly}
              />
            </Field>
          </CardContent>
        </Card>

        {/* Photos */}
        <Card>
          <CardHeader>
            <CardTitle>Photos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isReadOnly && !id?.startsWith("temp-") && (
              <PhotoCapture
                inspectionId={id!}
                section="jcf"
                tableName="jcf_photos"
                foreignKeyColumn="jcf_id"
                storageBucket="jcf-photos"
                onPhotoAdded={() => {
                  /* PhotoGallery picks up the new row on its own polling */
                }}
              />
            )}
            {id?.startsWith("temp-") && (
              <p className="text-sm text-muted-foreground">
                Photos can be added once this JCF syncs to the cloud.
              </p>
            )}
            {!id?.startsWith("temp-") && (
              <PhotoGallery
                inspectionId={id!}
                section="jcf"
                tableName="jcf_photos"
                foreignKeyColumn="jcf_id"
                storageBucket="jcf-photos"
                readOnly={isReadOnly}
              />
            )}
          </CardContent>
        </Card>
      </main>

      <AttestationDialog
        open={showAttestationDialog}
        onOpenChange={setShowAttestationDialog}
        kind="jcf"
        signerName={signerName}
        signerId={signerId}
        organization={jcf.organization || ""}
        reportDate={jcf.date_of_work || new Date().toISOString().slice(0, 10)}
        onSigned={(payload) => completeJCF(payload)}
      />

      <CompletionLockDialog
        open={showCompletionLockDialog}
        onOpenChange={setShowCompletionLockDialog}
        onConfirm={async () => {
          await persist(
            { ...jcf, completion_locked: false, status: "draft" },
            { immediate: true },
          );
          setShowCompletionLockDialog(false);
          toast.success("JCF unlocked");
        }}
      />


      {reportHtml && (
        <HtmlReportViewer
          html={reportHtml}
          title={viewerTitle}
          filename={filename}
          isOpen={viewerOpen}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function CheckboxRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = `jcf-cb-${label.replace(/\W+/g, "-")}`;
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        disabled={disabled}
      />
      <Label htmlFor={id} className="cursor-pointer text-sm">
        {label}
      </Label>
    </div>
  );
}
