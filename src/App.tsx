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
import NotFound from "./pages/NotFound";
import { InstallBanner } from "@/components/pwa/InstallBanner";
import { UpdateNotification } from "@/components/pwa/UpdateNotification";
import { InstallSuccessNotification } from "@/components/pwa/InstallSuccessNotification";
import { NetworkStatusIndicator } from "@/components/pwa/NetworkStatusIndicator";
import { SyncStatusIndicator } from "@/components/pwa/SyncStatusIndicator";
import { PWAProvider } from "@/components/pwa/PWAProvider";
import { syncInspections } from "@/lib/sync-manager";

const queryClient = new QueryClient();

const AppContent = () => {
  useEffect(() => {
    // Initial sync on app load
    if (navigator.onLine) {
      if (import.meta.env.DEV) {
        console.log('[App] Initial sync on load');
      }
      syncInspections();
    }

    // Periodic sync every 5 minutes when online
    const syncInterval = setInterval(() => {
      if (navigator.onLine) {
        if (import.meta.env.DEV) {
          console.log('[App] Periodic sync triggered');
        }
        syncInspections();
      }
    }, 5 * 60 * 1000);

    // Sync when app becomes visible
    const handleVisibilityChange = () => {
      if (!document.hidden && navigator.onLine) {
        if (import.meta.env.DEV) {
          console.log('[App] Sync on visibility change');
        }
        syncInspections();
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
          
          {/* Global PWA Status Indicators */}
          <div className="fixed top-4 right-4 z-40 flex flex-col gap-2">
            <NetworkStatusIndicator />
            <SyncStatusIndicator />
          </div>
          
          {/* PWA Notifications */}
          <InstallBanner />
          <UpdateNotification />
          <InstallSuccessNotification />
          
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/inspection/new" element={<NewInspection />} />
            <Route path="/inspection/:id" element={<InspectionForm />} />
            <Route path="/install" element={<Install />} />
            <Route path="/capabilities" element={<Capabilities />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </PWAProvider>
  </QueryClientProvider>
);

export default App;
