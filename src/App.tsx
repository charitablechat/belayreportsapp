import { MobileAwareToaster, MobileAwareSonner } from "@/components/ui/mobile-aware-toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
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

const AppContent = () => {
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

  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <PWAProvider>
      <TooltipProvider>
        <MobileAwareToaster />
        <MobileAwareSonner />
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
            <Route path="/training/:id" element={<TrainingForm />} />
            <Route path="/daily-assessment/new" element={<NewDailyAssessment />} />
            <Route path="/daily-assessment/:id" element={<DailyAssessmentForm />} />
            <Route path="/install" element={<Install />} />
            <Route path="/capabilities" element={<Capabilities />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/admin" element={<SuperAdminDashboard />} />
            <Route path="/base64-converter" element={<Base64Converter />} />
            <Route path="/upload-logos" element={<UploadLogos />} />
            <Route path="/upload-logos-storage" element={<UploadLogosToStorage />} />
            <Route path="/admin/logos" element={<AdminLogoManagement />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </PWAProvider>
  </QueryClientProvider>
);

export default App;
