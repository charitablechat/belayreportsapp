/**
 * JCFForm — placeholder.
 *
 * Phase 4 lands this page in a follow-up pass because the full port is a
 * ~2,000-line adaptation of TrainingForm with attestation, completion-lock,
 * Promise.race HTML generation, and the JCF column matrix (course_type_*,
 * fall_protection_*, training_status, etc.). This stub exists only so
 * /jcf/:id resolves and the build stays green until that pass lands.
 */
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import belayReportsLogoAsset from "@/assets/belay-reports-wide.gif.asset.json";
const belayReportsLogo = belayReportsLogoAsset.url;

export default function JCFForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-white/20 bg-white/10 dark:bg-black/20 backdrop-blur-[12px] shadow-md shadow-black/5">
        <div className="container mx-auto px-2 md:px-4 py-4 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline ml-2">Back to Dashboard</span>
          </Button>
          <img
            src={belayReportsLogo}
            alt="Belay Reports"
            className="h-8 md:h-10 w-auto object-contain"
          />
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Job Completion Form</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              The full JCF edit form is being implemented as a follow-up pass of
              the Phase 4 port. This placeholder ensures the route resolves.
            </p>
            <p className="font-mono text-xs">JCF ID: {id}</p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
