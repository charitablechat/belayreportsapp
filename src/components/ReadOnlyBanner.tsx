import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShieldAlert, Eye } from "lucide-react";

interface ReadOnlyBannerProps {
  reason: string | null;
  isSuperAdmin?: boolean;
}

/**
 * Banner displayed when a report is in read-only mode.
 * Shows different messaging for Super Admins vs. other access scenarios.
 */
export function ReadOnlyBanner({ reason, isSuperAdmin }: ReadOnlyBannerProps) {
  return (
    <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 mb-4">
      <div className="flex items-start gap-3">
        {isSuperAdmin ? (
          <Eye className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        ) : (
          <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
        )}
        <div>
          <AlertTitle className="text-amber-800 dark:text-amber-200 font-semibold">
            {isSuperAdmin ? 'View-Only Mode' : 'Read-Only Access'}
          </AlertTitle>
          <AlertDescription className="text-amber-700 dark:text-amber-300 text-sm mt-1">
            {reason || 'You cannot modify this report.'}
            {isSuperAdmin && (
              <span className="block mt-1 text-xs opacity-80">
                As a Super Admin, you can view all reports but editing is reserved for the original inspector.
              </span>
            )}
          </AlertDescription>
        </div>
      </div>
    </Alert>
  );
}
