import { MobileAwareToaster, MobileAwareSonner } from "@/components/ui/mobile-aware-toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider, useNavigate, Outlet } from "react-router-dom";
import { useEffect } from "react";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import NewInspection from "./pages/NewInspection";
import InspectionForm from "./pages/InspectionForm";
import TrainingForm from "./pages/TrainingForm";
import NewTraining from "./pages/NewTraining";
import NewDailyAssessment from "./pages/NewDailyAssessment";
import DailyAssessmentForm from "./pages/DailyAssessmentForm";
import Install from "./pages/Install";
import Capabilities from "./pages/Capabilities";
import AuroraLanding from "./pages/AuroraLanding";
import SuperAdminDashboard from "./pages/SuperAdminDashboard";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound";
import Base64Converter from "./pages/Base64Converter";
import UploadLogos from "./pages/UploadLogos";
import UploadLogosToStorage from "./pages/UploadLogosToStorage";
import AdminLogoManagement from "./pages/AdminLogoManagement";
import { InstallBanner } from "@/components/pwa/InstallBanner";
import { UpdateNotification } from "@/components/pwa/UpdateNotification";
import { InstallSuccessNotification } from "@/components/pwa/InstallSuccessNotification";
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
  
  // Enable scroll restoration
  useScrollRestoration(true);
  
  // Trigger haptic feedback on navigation (mobile only)
  useEffect(() => {
    if (!isMobileDevice) return;
    
    const handleNavigation = () => {
      triggerNavigationHaptic();
    };
    
    // Listen for route changes
    window.addEventListener('popstate', handleNavigation);
    
    return () => {
      window.removeEventListener('popstate', handleNavigation);
    };
  }, [isMobileDevice]);
  
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
    <>
      {/* PWA Notifications */}
      <InstallBanner />
      <UpdateNotification />
      <InstallSuccessNotification />
      <Outlet />
    </>
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
      { path: "/admin", element: <SuperAdminDashboard /> },
      { path: "/base64-converter", element: <Base64Converter /> },
      { path: "/upload-logos", element: <UploadLogos /> },
      { path: "/upload-logos-storage", element: <UploadLogosToStorage /> },
      { path: "/admin/logos", element: <AdminLogoManagement /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <PWAProvider>
      <TooltipProvider>
        <MobileAwareToaster />
        <MobileAwareSonner />
        <RouterProvider router={router} />
      </TooltipProvider>
    </PWAProvider>
  </QueryClientProvider>
);

export default App;
