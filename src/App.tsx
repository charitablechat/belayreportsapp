import { MobileAwareToaster, MobileAwareSonner } from "@/components/ui/mobile-aware-toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { createBrowserRouter, RouterProvider, useNavigate, Outlet, useLocation, useRouteError } from "react-router-dom";
import { lazy, Suspense, useEffect, useRef } from "react";
import { trackNavigation, getNavigationDepth, decrementNavigation, isOverlayActive, isReportTabActive } from "@/lib/navigation";
import Index from "./pages/Index";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { createGuestSession } from "@/lib/guest-session";
import { isLovablePreview } from "@/lib/environment";

// Keep offline-critical routes in the app shell. If a user launches the
// installed app offline on /dashboard or a report URL, lazy chunk fetches can
// fail before the service worker has warmed every chunk; these imports make the
// core field workflow available from the precached main bundle.
import Dashboard from "./pages/Dashboard";
import NewInspection from "./pages/NewInspection";
import InspectionForm from "./pages/InspectionForm";
import TrainingForm from "./pages/TrainingForm";
import NewTraining from "./pages/NewTraining";
import NewDailyAssessment from "./pages/NewDailyAssessment";
import DailyAssessmentForm from "./pages/DailyAssessmentForm";
import NewJCF from "./pages/NewJCF";
import JCFForm from "./pages/JCFForm";



// Lazy-loaded non-critical routes for code splitting
const Install = lazy(() => import("./pages/Install"));
const Capabilities = lazy(() => import("./pages/Capabilities"));
const AuroraLanding = lazy(() => import("./pages/AuroraLanding"));
const SuperAdminDashboard = lazy(() => import("./pages/SuperAdminDashboard"));
const Profile = lazy(() => import("./pages/Profile"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Base64Converter = lazy(() => import("./pages/Base64Converter"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const UploadLogos = lazy(() => import("./pages/UploadLogos"));
const UploadLogosToStorage = lazy(() => import("./pages/UploadLogosToStorage"));
const AdminLogoManagement = lazy(() => import("./pages/AdminLogoManagement"));
const Unsubscribe = lazy(() => import("./pages/Unsubscribe"));
const TrainingRecovery = lazy(() => import("./pages/TrainingRecovery"));
const RecoveryAndSyncHealth = lazy(() => import("./pages/RecoveryAndSyncHealth"));

import { RequireAuth } from "@/components/auth/RequireAuth";

import { InstallBanner } from "@/components/pwa/InstallBanner";
import { UpdateNotification } from "@/components/pwa/UpdateNotification";
import { StaleVersionBanner } from "@/components/pwa/StaleVersionBanner";
import { NetworkStatusBanner } from "@/components/pwa/NetworkStatusBanner";
import { InstallSuccessNotification } from "@/components/pwa/InstallSuccessNotification";
import { UpdateAppliedCelebration } from "@/components/pwa/UpdateAppliedCelebration";
import { RouteFallback } from "@/components/RouteFallback";
import { MinVersionEnforcer } from "@/components/pwa/MinVersionEnforcer";
import { AuthenticatedHeader } from "@/components/AuthenticatedHeader";
import { RemoteDeletedConflictDialog } from "@/components/RemoteDeletedConflictDialog";
import { GlobalEnterToBlur } from "@/components/GlobalEnterToBlur";
import { PWAProvider } from "@/components/pwa/PWAProvider";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { isMobile, logMobileCapabilities } from "@/lib/mobile-detection";
import { triggerNavigationHaptic } from "@/lib/haptics";
import { cleanupStaleCachedPhotos } from "@/lib/photo-cache";
import { reportVersionTelemetry } from "@/lib/version-telemetry";
import { toast } from "sonner";


const queryClient = new QueryClient();

const WINDOWS_REINSTALL_NOTICE_KEY = 'windows-pwa-reinstall-notice-shown-v2';

/**
 * One-time notice for Windows users with installed PWA from the
 * pre-Phase-2 era (when the self-destroying SW was active). Their PWA
 * shell may be pinned to a stale SW — recommend uninstall + reinstall.
 */
function maybeShowWindowsReinstallNotice() {
  try {
    if (localStorage.getItem(WINDOWS_REINSTALL_NOTICE_KEY)) return;
    const ua = navigator.userAgent || '';
    if (!/Windows/.test(ua)) return;
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // @ts-ignore
      navigator.standalone === true;
    if (!isStandalone) return;

    localStorage.setItem(WINDOWS_REINSTALL_NOTICE_KEY, '1');
    setTimeout(() => {
      toast.info(
        'Reinstall recommended for Windows PWA users — uninstall and reinstall this app once to receive the latest update mechanism.',
        { duration: 12_000 }
      );
    }, 4_000);
  } catch {
    // ignore
  }
}

const RootLayout = () => {
  const isMobileDevice = isMobile();
  const navigate = useNavigate();
  const location = useLocation();
  const prevLocation = useRef(location.pathname);
  
  // Track in-app navigations for reliable back button behavior
  useEffect(() => {
    if (location.pathname !== prevLocation.current) {
      trackNavigation();
      prevLocation.current = location.pathname;
    }
  }, [location.pathname]);
  
  // Enable scroll restoration
  useScrollRestoration(true);
  
  // History exit guard + haptic feedback + depth sync — single popstate listener.
  // L8: pushState seeds a sentinel history entry on every router mount so we can
  // intercept the user's last "Back" press and redirect them to /dashboard
  // instead of leaving the SPA. This means a deep-linked boot lands the user
  // one Back away from the landing route — intentional, not a bug.
  useEffect(() => {
    window.history.pushState({ lovableGuard: true }, "");

    const handlePopState = (event: PopStateEvent) => {
      if (isOverlayActive()) return;
      if (isReportTabActive()) return;

      // Don't decrement depth for non-router history entries
      // (lightbox and report-tab entries are pushed outside React Router)
      const state = event.state;
      if (state?.lightbox || state?.reportTab) return;

      // Haptic feedback on mobile
      if (isMobileDevice) {
        triggerNavigationHaptic();
      }

      if (state?.lovableGuard && getNavigationDepth() === 0) {
        // User exhausted in-app history — trap exit and redirect to dashboard
        window.history.pushState({ lovableGuard: true }, "");
        navigate("/dashboard");
      } else if (getNavigationDepth() > 0) {
        // Hardware back press — keep depth counter in sync
        decrementNavigation();
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [navigate, isMobileDevice]);

  useEffect(() => {
    // Log mobile capabilities on mount
    if (import.meta.env.DEV) {
      logMobileCapabilities();
      console.log('[App] Automatic sync is now managed by useAutoSync hook in PWAProvider');
    }
    
    // Clean up stale cached photos on mount
    if (navigator.onLine) {
      cleanupStaleCachedPhotos();
    }
    
    // Clean up stale cached photos every hour
    const cacheCleanupInterval = setInterval(() => {
      cleanupStaleCachedPhotos();
    }, 60 * 60 * 1000);

    // Report version telemetry (best-effort, never throws)
    void reportVersionTelemetry();

    // One-time Windows PWA reinstall notice (post-Phase-2 transition)
    maybeShowWindowsReinstallNotice();

    return () => {
      clearInterval(cacheCleanupInterval);
    };
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <QueryClientProvider client={queryClient}>
        <PWAProvider>
          <TooltipProvider>
            <MobileAwareToaster />
            <MobileAwareSonner />
            {/* PWA Notifications */}
            <InstallBanner />
            <UpdateNotification />
            <UpdateAppliedCelebration />
            <StaleVersionBanner />
            <NetworkStatusBanner />
            <InstallSuccessNotification />
            <MinVersionEnforcer />
            <AuthenticatedHeader />
            <GlobalEnterToBlur />
            <RemoteDeletedConflictDialog />
            <Suspense fallback={<RouteFallback />}>
              <Outlet />
            </Suspense>
          </TooltipProvider>
        </PWAProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
};

const OfflineRouteError = () => {
  const error = useRouteError();

  useEffect(() => {
    console.error('[Router] Route render failed:', error);
  }, [error]);

  const continueOffline = () => {
    createGuestSession();
    window.location.replace('/dashboard');
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-6 py-10">
      <main className="w-full max-w-sm text-center space-y-5">
        <img
          src="/__l5e/assets-v1/8c7f8dfa-a725-400e-8f7e-c806cf7d7039/belay-reports-wide.gif"
          alt="Belay Reports"
          className="mx-auto h-24 w-24 rounded-full object-contain bg-background"
        />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Open Belay Reports offline</h1>
          <p className="text-sm text-muted-foreground">
            The app shell is available. Continue offline and your work will stay on this device until you reconnect.
          </p>
        </div>
        <div className="space-y-3">
          <button
            type="button"
            onClick={continueOffline}
            className="w-full bg-primary text-primary-foreground px-4 py-3 font-semibold hover:bg-primary/90 transition-colors"
          >
            Continue offline
          </button>
          <button
            type="button"
            onClick={() => window.location.replace('/')}
            className="w-full border border-border px-4 py-3 font-semibold hover:bg-muted transition-colors"
          >
            Try opening again
          </button>
        </div>
      </main>
    </div>
  );
};

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <OfflineRouteError />,
    children: [
      { path: "/", element: <Index /> },
      { path: "/index", element: <Index /> },
      { path: "/index.html", element: <Index /> },
      { path: "/welcome", element: <AuroraLanding /> },
      { path: "/dashboard", element: <RequireAuth><Dashboard /></RequireAuth> },
      { path: "/inspection/new", element: <RequireAuth><NewInspection /></RequireAuth> },
      { path: "/inspection/:id", element: <RequireAuth><InspectionForm /></RequireAuth> },
      { path: "/training/new", element: <RequireAuth><NewTraining /></RequireAuth> },
      { path: "/training/:id", element: <RequireAuth><TrainingForm /></RequireAuth> },
      { path: "/daily-assessment/new", element: <RequireAuth><NewDailyAssessment /></RequireAuth> },
      { path: "/daily-assessment/:id", element: <RequireAuth><DailyAssessmentForm /></RequireAuth> },
      // JCF is gated to the Lovable preview environment only; production
      // builds intentionally exclude these routes while the underlying
      // codebase, offline storage, and database schema remain intact.
      ...(isLovablePreview()
        ? [
            { path: "/jcf/new", element: <RequireAuth><NewJCF /></RequireAuth> },
            { path: "/jcf/:id", element: <RequireAuth><JCFForm /></RequireAuth> },
          ]
        : []),

      { path: "/install", element: <Install /> },
      { path: "/capabilities", element: <Capabilities /> },
      { path: "/profile", element: <RequireAuth><Profile /></RequireAuth> },
      { path: "/onboarding", element: <RequireAuth><Onboarding /></RequireAuth> },
      { path: "/admin", element: <RequireAuth><SuperAdminDashboard /></RequireAuth> },
      // H2/M19 — admin-only utility routes. Components also call useRequireAdmin
      // for defense-in-depth; the RequireAuth wrapper prevents anonymous access
      // and the dev-only gate keeps /base64-converter out of production.
      ...(import.meta.env.DEV
        ? [{ path: "/base64-converter", element: <RequireAuth><Base64Converter /></RequireAuth> }]
        : []),
      { path: "/upload-logos", element: <RequireAuth><UploadLogos /></RequireAuth> },
      { path: "/upload-logos-storage", element: <RequireAuth><UploadLogosToStorage /></RequireAuth> },
      { path: "/admin/logos", element: <RequireAuth><AdminLogoManagement /></RequireAuth> },
      { path: "/admin/training-recovery", element: <RequireAuth><TrainingRecovery /></RequireAuth> },
      { path: "/recovery", element: <RequireAuth><RecoveryAndSyncHealth /></RequireAuth> },
      { path: "/unsubscribe", element: <Unsubscribe /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

import { HelmetProvider } from "react-helmet-async";

const App = () => (
  <AppErrorBoundary>
    <HelmetProvider>
      <RouterProvider router={router} />
    </HelmetProvider>
  </AppErrorBoundary>
);

export default App;
