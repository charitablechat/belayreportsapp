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

import { InstallBanner } from "@/components/pwa/InstallBanner";
import { UpdateNotification } from "@/components/pwa/UpdateNotification";
import { InstallSuccessNotification } from "@/components/pwa/InstallSuccessNotification";
import { AuthenticatedHeader } from "@/components/AuthenticatedHeader";
import { NetworkStatusIndicator } from "@/components/pwa/NetworkStatusIndicator";
import { SyncStatusIndicator } from "@/components/pwa/SyncStatusIndicator";
import { PWAProvider } from "@/components/pwa/PWAProvider";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { isMobile, logMobileCapabilities } from "@/lib/mobile-detection";
import { triggerNavigationHaptic } from "@/lib/haptics";
import { cleanupStaleCachedPhotos } from "@/lib/photo-cache";


const queryClient = new QueryClient();

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

      // Haptic feedback on mobile
      if (isMobileDevice) {
        triggerNavigationHaptic();
      }

      if (event.state?.lovableGuard && getNavigationDepth() === 0) {
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
            <InstallSuccessNotification />
            <AuthenticatedHeader />
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
      { path: "/dashboard", element: <Dashboard /> },
      { path: "/inspection/new", element: <NewInspection /> },
      { path: "/inspection/:id", element: <InspectionForm /> },
      { path: "/training/new", element: <NewTraining /> },
      { path: "/training/:id", element: <TrainingForm /> },
      { path: "/daily-assessment/new", element: <NewDailyAssessment /> },
      { path: "/daily-assessment/:id", element: <DailyAssessmentForm /> },
      { path: "/install", element: <Install /> },
      { path: "/capabilities", element: <Capabilities /> },
      { path: "/profile", element: <Profile /> },
      { path: "/onboarding", element: <Onboarding /> },
      { path: "/admin", element: <SuperAdminDashboard /> },
      { path: "/base64-converter", element: <Base64Converter /> },
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
