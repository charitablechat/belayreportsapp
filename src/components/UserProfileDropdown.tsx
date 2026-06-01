 import { useState } from "react";
 import { useNavigate } from "react-router-dom";
 import { Button } from "@/components/ui/button";
 import { Badge } from "@/components/ui/badge";
 import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuLabel,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
 } from "@/components/ui/dropdown-menu";
import { LogOut, User, Bell, Settings, FileText, Download, MessageCircle, Loader2, Shield, Monitor, MoreVertical, Database, Sun, Moon, BookOpen, RefreshCw, LifeBuoy } from "lucide-react";
import { useTheme } from "next-themes";
 import { UserAvatar } from "@/components/ui/user-avatar";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { usePWA } from "@/hooks/usePWA";
 import { ManualUpdateButton } from "@/components/pwa/ManualUpdateButton";
 import { ForceSyncButton } from "@/components/pwa/ForceSyncButton";
 import { NotificationCenter } from "@/components/pwa/NotificationCenter";
 import { PushNotificationManager } from "@/components/pwa/PushNotificationManager";
import { ContactDeveloperSheet } from "@/components/ContactDeveloperSheet";
import { UserDataRecoverySheet } from "@/components/UserDataRecoverySheet";
import { VersionBadge } from "@/components/VersionBadge";
import { useVersionStatus } from "@/hooks/useVersionStatus";
 import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function VersionStatusLine() {
  const { installed, deployed, updateAvailable, environment } = useVersionStatus({ forceOnMount: true });
  const envLabel = environment === 'preview' ? 'PREVIEW' : environment === 'published' ? 'PUBLISHED' : 'LOCAL';
  return (
    <div className="mt-1 flex flex-col items-center gap-0.5 text-[10px] font-mono text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <span className="px-1 border border-border rounded-sm uppercase tracking-wider text-[9px]">{envLabel}</span>
        <span>installed v{installed}</span>
      </div>
      {deployed && (
        <div className={`flex items-center gap-1 ${updateAvailable ? 'text-amber-500' : 'text-emerald-500'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${updateAvailable ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
          <span>deployed v{deployed}{updateAvailable ? ' — update available' : ' — current'}</span>
        </div>
      )}
    </div>
  );
}
 
 interface UserProfileDropdownProps {
   currentUser: { email?: string; id?: string } | null;
   userProfile: { avatar_url?: string } | null;
   isSuperAdmin?: boolean;
   onSignOut: () => void;
   signingOut?: boolean;
 }
 
 export function UserProfileDropdown({
   currentUser,
   userProfile,
   isSuperAdmin = false,
   onSignOut,
   signingOut = false,
 }: UserProfileDropdownProps) {
   const navigate = useNavigate();
    const { isInstallable, isInstalled, promptInstall } = usePWAInstall();
    const { unsyncedCount, needsUpdate, updateAndReload } = usePWA();
    const { theme, setTheme } = useTheme();
  const [notificationsDialogOpen, setNotificationsDialogOpen] = useState(false);
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  const [dataRecoveryOpen, setDataRecoveryOpen] = useState(false);
 
   return (
     <>
       {/* Push Notifications Dialog */}
       <Dialog open={notificationsDialogOpen} onOpenChange={setNotificationsDialogOpen}>
         <DialogContent className="sm:max-w-md">
           <DialogHeader>
             <DialogTitle>Push Notifications</DialogTitle>
             <DialogDescription>
               Manage your push notification settings
             </DialogDescription>
           </DialogHeader>
           <PushNotificationManager />
         </DialogContent>
       </Dialog>
 
        {/* Contact Developer Sheet */}
        <ContactDeveloperSheet 
          open={contactSheetOpen} 
          onOpenChange={setContactSheetOpen} 
        />

        {/* Data Recovery Sheet */}
        <UserDataRecoverySheet
          open={dataRecoveryOpen}
          onOpenChange={setDataRecoveryOpen}
        />
 
       <DropdownMenu>
         <DropdownMenuTrigger asChild>
           <Button variant="ghost" size="icon" className="rounded-full p-0 bg-transparent hover:bg-transparent">
             <UserAvatar 
               userEmail={currentUser?.email ?? null}
               avatarUrl={userProfile?.avatar_url ?? null}
               isSuperAdmin={isSuperAdmin}
             />
           </Button>
         </DropdownMenuTrigger>
         <DropdownMenuContent align="end" className="w-72">
           <DropdownMenuLabel>
             <div className="flex flex-col space-y-1">
               <div className="flex items-center justify-between gap-2">
                 <p className="text-sm font-medium">Account</p>
                 {isSuperAdmin && (
                   <Badge variant="default" className="bg-warning text-warning-foreground border-warning/50 shadow-md shadow-warning/20 animate-pulse text-xs flex items-center gap-1">
                     <Shield className="w-3 h-3" />
                     Admin
                   </Badge>
                 )}
               </div>
               <p className="text-xs text-muted-foreground break-all">
                 {currentUser?.email || 'user@example.com'}
               </p>
             </div>
           </DropdownMenuLabel>
           <DropdownMenuSeparator />
           
           {/* Admin Dashboard - Super Admins only */}
           {isSuperAdmin && (
             <>
               <DropdownMenuItem onClick={() => navigate('/admin')}>
                 <Settings className="w-4 h-4 mr-2" />
                 Admin Dashboard
               </DropdownMenuItem>
               <DropdownMenuSeparator />
             </>
           )}
            
              {/* Profile */}
              <DropdownMenuItem onClick={() => navigate('/profile')}>
                <User className="w-4 h-4 mr-2" />
                Profile
              </DropdownMenuItem>

              {/* Update Now - only when update available */}
              {needsUpdate && (
                <DropdownMenuItem 
                  onClick={() => updateAndReload()}
                  className="text-amber-600 dark:text-amber-400 font-medium"
                >
                  <span className="relative mr-2">
                    <RefreshCw className="w-4 h-4" />
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                  </span>
                  Update Now
                </DropdownMenuItem>
              )}

             {/* Onboarding */}
             <DropdownMenuItem onClick={() => navigate('/onboarding')}>
               <BookOpen className="w-4 h-4 mr-2" />
               Onboarding
             </DropdownMenuItem>
            
            {/* Check for Updates */}
            <DropdownMenuItem asChild>
              <div className="w-full px-2 py-1.5">
                <ManualUpdateButton />
              </div>
            </DropdownMenuItem>
            
            {/* Contact Developer */}
            <DropdownMenuItem onClick={() => setContactSheetOpen(true)}>
              <MessageCircle className="w-4 h-4 mr-2" />
              Contact Developer
            </DropdownMenuItem>
            
              {/* Force Sync Now */}
              <DropdownMenuItem asChild>
                <ForceSyncButton variant="menu-item" unsyncedCount={unsyncedCount} />
              </DropdownMenuItem>
              
              {/* Recovery & Sync Health — permanent, read-only, for all users */}
              <DropdownMenuItem onClick={() => navigate('/recovery')}>
                <LifeBuoy className="w-4 h-4 mr-2" />
                Recovery & Sync Health
              </DropdownMenuItem>

              {/* Backups & Restore — restore-capable tool */}
              <DropdownMenuItem onClick={() => setDataRecoveryOpen(true)}>
                <Database className="w-4 h-4 mr-2" />
                Backups & Restore
              </DropdownMenuItem>
             
              <DropdownMenuSeparator />
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="flex items-center text-sm text-muted-foreground">
                  <Monitor className="w-4 h-4 mr-2" />
                  System & Device
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="left" className="z-[60]">
                    <NotificationCenter 
                      trigger={
                        <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                          <Bell className="w-4 h-4 mr-2" />
                          Activity Log
                        </DropdownMenuItem>
                      }
                    />
                    <DropdownMenuItem onClick={() => setNotificationsDialogOpen(true)}>
                      <Bell className="w-4 h-4 mr-2" />
                      Push Notifications
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate('/capabilities')}>
                      <Monitor className="w-4 h-4 mr-2" />
                      Device Capabilities
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate('/install')}>
                      <FileText className="w-4 h-4 mr-2" />
                      Install Instructions
                    </DropdownMenuItem>
                    {isInstallable && !isInstalled && (
                      <DropdownMenuItem onClick={promptInstall}>
                        <Download className="w-4 h-4 mr-2" />
                        Install App
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

             <DropdownMenuSeparator />
           {/* Version Badge + Deployed status */}
           <div className="px-2 py-1.5">
             <VersionBadge compact />
             <VersionStatusLine />
           </div>
           
           <DropdownMenuSeparator />
           
            {/* Dark/Light Mode Toggle */}
            <DropdownMenuItem onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? (
                <Sun className="w-4 h-4 mr-2" />
              ) : (
                <Moon className="w-4 h-4 mr-2" />
              )}
              {theme === "dark" ? "Light Mode" : "Dark Mode"}
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            
            {/* Sign Out */}
            <DropdownMenuItem onClick={onSignOut} disabled={signingOut}>
             {signingOut ? (
               <Loader2 className="w-4 h-4 mr-2 animate-spin" />
             ) : (
               <LogOut className="w-4 h-4 mr-2" />
             )}
             {signingOut ? "Signing out..." : "Sign Out"}
           </DropdownMenuItem>
         </DropdownMenuContent>
       </DropdownMenu>
     </>
   );
 }