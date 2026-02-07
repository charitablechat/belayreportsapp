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
 import { LogOut, User, Bell, Settings, FileText, Download, MessageCircle, Loader2, Shield } from "lucide-react";
 import { UserAvatar } from "@/components/ui/user-avatar";
 import { usePWAInstall } from "@/hooks/usePWAInstall";
 import { ManualUpdateButton } from "@/components/pwa/ManualUpdateButton";
 import { ForceSyncButton } from "@/components/pwa/ForceSyncButton";
 import { NotificationCenter } from "@/components/pwa/NotificationCenter";
 import { PushNotificationManager } from "@/components/pwa/PushNotificationManager";
 import { ContactDeveloperSheet } from "@/components/ContactDeveloperSheet";
 import { VersionBadge } from "@/components/VersionBadge";
 import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
 
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
   const [notificationsDialogOpen, setNotificationsDialogOpen] = useState(false);
   const [contactSheetOpen, setContactSheetOpen] = useState(false);
 
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
 
       <DropdownMenu>
         <DropdownMenuTrigger asChild>
           <Button variant="ghost" size="icon" className="rounded-full">
             <UserAvatar 
               userEmail={currentUser?.email ?? null}
               avatarUrl={userProfile?.avatar_url ?? null}
               isSuperAdmin={isSuperAdmin}
             />
           </Button>
         </DropdownMenuTrigger>
         <DropdownMenuContent align="end" className="w-56">
           <DropdownMenuLabel>
             <div className="flex flex-col space-y-1">
               <div className="flex items-center justify-between">
                 <p className="text-sm font-medium">Account</p>
                 {isSuperAdmin && (
                   <Badge variant="default" className="bg-warning text-warning-foreground border-warning/50 shadow-md shadow-warning/20 animate-pulse text-xs flex items-center gap-1">
                     <Shield className="w-3 h-3" />
                     Admin
                   </Badge>
                 )}
               </div>
               <p className="text-xs text-muted-foreground truncate">
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
              <ForceSyncButton variant="menu-item" />
            </DropdownMenuItem>
            
            {/* Activity Log */}
            <NotificationCenter 
              trigger={
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                  <Bell className="w-4 h-4 mr-2" />
                  Activity Log
                </DropdownMenuItem>
              }
            />
            
            {/* Push Notifications */}
            <DropdownMenuItem onClick={() => setNotificationsDialogOpen(true)}>
              <Bell className="w-4 h-4 mr-2" />
              Push Notifications
            </DropdownMenuItem>
            
            {/* Device Capabilities */}
            <DropdownMenuItem onClick={() => navigate('/capabilities')}>
              Device Capabilities
            </DropdownMenuItem>
            
            {/* Install Instructions */}
            <DropdownMenuItem onClick={() => navigate('/install')}>
              <FileText className="w-4 h-4 mr-2" />
              Install Instructions
            </DropdownMenuItem>
            
            {/* Install App - only if installable and not installed */}
            {isInstallable && !isInstalled && (
              <DropdownMenuItem onClick={promptInstall}>
                <Download className="w-4 h-4 mr-2" />
                Install App
              </DropdownMenuItem>
            )}
           
           {/* Version Badge */}
           <div className="px-2 py-1.5">
             <VersionBadge compact />
           </div>
           
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