import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, XCircle, Loader2, MailX } from "lucide-react";

type Status = "loading" | "valid" | "already_unsubscribed" | "invalid" | "success" | "error";

const Unsubscribe = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>("loading");
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return;
    }

    const validateToken = async () => {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const response = await fetch(
          `${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${token}`,
          { headers: { apikey: anonKey } }
        );
        const data = await response.json();

        if (!response.ok) {
          setStatus("invalid");
        } else if (data.valid === false && data.reason === "already_unsubscribed") {
          setStatus("already_unsubscribed");
        } else if (data.valid) {
          setStatus("valid");
        } else {
          setStatus("invalid");
        }
      } catch {
        setStatus("invalid");
      }
    };

    validateToken();
  }, [token]);

  const handleUnsubscribe = async () => {
    if (!token) return;
    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("handle-email-unsubscribe", {
        body: { token },
      });
      if (error) {
        setStatus("error");
      } else if (data?.success) {
        setStatus("success");
      } else if (data?.reason === "already_unsubscribed") {
        setStatus("already_unsubscribed");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <h1 className="flex items-center justify-center gap-2 text-xl font-semibold leading-none tracking-tight">
            <MailX className="h-6 w-6 text-muted-foreground" />
            Email Preferences
          </h1>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          {status === "loading" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Validating your request...</p>
            </div>
          )}

          {status === "valid" && (
            <>
              <p className="text-muted-foreground">
                Would you like to unsubscribe from email notifications from Belay Reports?
              </p>
              <Button onClick={handleUnsubscribe} disabled={processing} variant="destructive" className="w-full">
                {processing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Confirm Unsubscribe
              </Button>
            </>
          )}

          {status === "success" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle className="h-10 w-10 text-success" />
              <p className="font-medium">You've been unsubscribed</p>
              <p className="text-sm text-muted-foreground">
                You will no longer receive email notifications from Belay Reports.
              </p>
            </div>
          )}

          {status === "already_unsubscribed" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle className="h-10 w-10 text-muted-foreground" />
              <p className="font-medium">Already unsubscribed</p>
              <p className="text-sm text-muted-foreground">
                This email address has already been unsubscribed.
              </p>
            </div>
          )}

          {status === "invalid" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <XCircle className="h-10 w-10 text-destructive" />
              <p className="font-medium">Invalid or expired link</p>
              <p className="text-sm text-muted-foreground">
                This unsubscribe link is no longer valid.
              </p>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <XCircle className="h-10 w-10 text-destructive" />
              <p className="font-medium">Something went wrong</p>
              <p className="text-sm text-muted-foreground">
                Please try again later or contact support.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Unsubscribe;
