import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
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
import { InstallBanner } from "@/components/pwa/InstallBanner";
import { UpdateNotification } from "@/components/pwa/UpdateNotification";
import { InstallSuccessNotification } from "@/components/pwa/InstallSuccessNotification";
import { NetworkStatusIndicator } from "@/components/pwa/NetworkStatusIndicator";
import { SyncStatusIndicator } from "@/components/pwa/SyncStatusIndicator";
import { PWAProvider } from "@/components/pwa/PWAProvider";
import { syncAllInspectionsAtomic } from "@/lib/atomic-sync-manager";
import { syncPhotos } from "@/lib/sync-manager";
import { useBackgroundSync } from "@/hooks/useBackgroundSync";
import { useIOSSync } from "@/hooks/useIOSSync";
import { isMobile, logMobileCapabilities } from "@/lib/mobile-detection";


const queryClient = new QueryClient();

const AppContent = () => {
  const { isSupported } = useBackgroundSync();
  const { isIOSDevice } = useIOSSync(); // iOS-specific sync behavior
  const isMobileDevice = isMobile();
  
  useEffect(() => {
    // Log mobile capabilities on mount
    if (import.meta.env.DEV) {
      logMobileCapabilities();
    }
    
    // Sync on mount and when coming back online
    if (navigator.onLine) {
      syncAllInspectionsAtomic();
      syncPhotos();
    }

    // iOS uses its own sync hook, so skip these for iOS
    if (isIOSDevice) {
      if (import.meta.env.DEV) {
        console.log('[App] iOS detected - using iOS-specific sync behavior');
      }
      return;
    }

    // Periodic sync - more aggressive on mobile (1 min vs 5 min)
    const syncInterval = setInterval(() => {
      if (navigator.onLine) {
        syncAllInspectionsAtomic();
        syncPhotos();
      }
    }, isMobileDevice ? 60 * 1000 : 5 * 60 * 1000);

    // Sync when app becomes visible
    const handleVisibilityChange = () => {
      if (!document.hidden && navigator.onLine) {
        syncAllInspectionsAtomic();
        syncPhotos();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(syncInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isIOSDevice, isMobileDevice]);

  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <PWAProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AppContent />
          
          {/* PWA Notifications */}
          <InstallBanner />
          <UpdateNotification />
          <InstallSuccessNotification />
          
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/welcome" element={<AuroraLanding />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/inspection/new" element={<NewInspection />} />
            <Route path="/inspection/:id" element={<InspectionForm />} />
            <Route path="/training/new" element={<NewTraining />} />
            <Route path="/daily-assessment/new" element={<NewDailyAssessment />} />
            <Route path="/daily-assessment/:id" element={<DailyAssessmentForm />} />
            <Route path="/install" element={<Install />} />
            <Route path="/capabilities" element={<Capabilities />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/admin" element={<SuperAdminDashboard />} />
            <Route path="/base64-converter" element={<Base64Converter />} />
            <Route path="/upload-logos" element={<UploadLogos />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </PWAProvider>
  </QueryClientProvider>
);

export default App;
