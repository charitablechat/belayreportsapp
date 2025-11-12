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
import Install from "./pages/Install";
import Capabilities from "./pages/Capabilities";
import AuroraLanding from "./pages/AuroraLanding";
import SuperAdminDashboard from "./pages/SuperAdminDashboard";
import NotFound from "./pages/NotFound";
import { InstallBanner } from "@/components/pwa/InstallBanner";
import { UpdateNotification } from "@/components/pwa/UpdateNotification";
import { InstallSuccessNotification } from "@/components/pwa/InstallSuccessNotification";
import { NetworkStatusIndicator } from "@/components/pwa/NetworkStatusIndicator";
import { SyncStatusIndicator } from "@/components/pwa/SyncStatusIndicator";
import { PWAProvider } from "@/components/pwa/PWAProvider";
import { syncInspections, syncPhotos } from "@/lib/sync-manager";
import { useBackgroundSync } from "@/hooks/useBackgroundSync";

const queryClient = new QueryClient();

const AppContent = () => {
  const { isSupported } = useBackgroundSync();
  
  useEffect(() => {
    // Sync on mount and when coming back online
    if (navigator.onLine) {
      syncInspections();
      syncPhotos();
    }

    // Periodic sync every 5 minutes
    const syncInterval = setInterval(() => {
      if (navigator.onLine) {
        syncInspections();
        syncPhotos();
      }
    }, 5 * 60 * 1000);

    // Sync when app becomes visible
    const handleVisibilityChange = () => {
      if (!document.hidden && navigator.onLine) {
        syncInspections();
        syncPhotos();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(syncInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

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
            <Route path="/install" element={<Install />} />
            <Route path="/capabilities" element={<Capabilities />} />
            <Route path="/admin" element={<SuperAdminDashboard />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </PWAProvider>
  </QueryClientProvider>
);

export default App;
