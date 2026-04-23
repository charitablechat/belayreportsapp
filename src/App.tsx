import { MobileAwareToaster, MobileAwareSonner } from "@/components/ui/mobile-aware-toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { createBrowserRouter, RouterProvider, useNavigate, Outlet, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect, useRef } from "react";
import { trackNavigation, getNavigationDepth, decrementNavigation, isOverlayActive, isReportTabActive } from "@/lib/navigation";
import Index from "./pages/Index";

// Lazy-loaded routes for code splitting
const Dashboard = lazy(() => import("./pages/Dashboard"));
const NewInspection = lazy(() => import("./pages/NewInspection"));
const InspectionForm = lazy(() => import("./pages/InspectionForm"));
const TrainingForm = lazy(() => import("./pages/TrainingForm"));
const NewTraining = lazy(() => import("./pages/NewTraining"));
const NewDailyAssessment = lazy(() => import("./pages/NewDailyAssessment"));
const DailyAssessmentForm = lazy(() => import("./pages/DailyAssessmentForm"));
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

import { RequireAuth } from "@/components/auth/RequireAuth";

import { InstallBanner } from "@/components/pwa/InstallBanner";
import { UpdateNotification } from "@/components/pwa/UpdateNotification";
import { StaleVersionBanner } from "@/components/pwa/StaleVersionBanner";
import { InstallSuccessNotification } from "@/components/pwa/InstallSuccessNotification";
import { MinVersionEnforcer } from "@/components/pwa/MinVersionEnforcer";
import { AuthenticatedHeader } from "@/components/AuthenticatedHeader";
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
  
  // History exit guard + haptic feedback + depth sync — single popstate listener
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
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <QueryClientProvider client={queryClient}>
        <PWAProvider>
          <TooltipProvider>
            <MobileAwareToaster />
            <MobileAwareSonner />
            {/* PWA Notifications */}
            <InstallBanner />
            <UpdateNotification />
            <StaleVersionBanner />
            <InstallSuccessNotification />
            <MinVersionEnforcer />
            <AuthenticatedHeader />
            <GlobalEnterToBlur />
            <Suspense fallback={null}>
              <Outlet />
            </Suspense>
          </TooltipProvider>
        </PWAProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
};

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <Index /> },
      { path: "/welcome", element: <AuroraLanding /> },
      { path: "/dashboard", element: <RequireAuth><Dashboard /></RequireAuth> },
      { path: "/inspection/new", element: <RequireAuth><NewInspection /></RequireAuth> },
      { path: "/inspection/:id", element: <RequireAuth><InspectionForm /></RequireAuth> },
      { path: "/training/new", element: <RequireAuth><NewTraining /></RequireAuth> },
      { path: "/training/:id", element: <RequireAuth><TrainingForm /></RequireAuth> },
      { path: "/daily-assessment/new", element: <RequireAuth><NewDailyAssessment /></RequireAuth> },
      { path: "/daily-assessment/:id", element: <RequireAuth><DailyAssessmentForm /></RequireAuth> },
      { path: "/install", element: <Install /> },
      { path: "/capabilities", element: <Capabilities /> },
      { path: "/profile", element: <RequireAuth><Profile /></RequireAuth> },
      { path: "/onboarding", element: <RequireAuth><Onboarding /></RequireAuth> },
      { path: "/admin", element: <RequireAuth><SuperAdminDashboard /></RequireAuth> },
      { path: "/base64-converter", element: <RequireAuth><Base64Converter /></RequireAuth> },
      { path: "/upload-logos", element: <UploadLogos /> },
      { path: "/upload-logos-storage", element: <UploadLogosToStorage /> },
      { path: "/admin/logos", element: <AdminLogoManagement /> },
      { path: "/unsubscribe", element: <Unsubscribe /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

const App = () => (
  <RouterProvider router={router} />
);

export default App;
