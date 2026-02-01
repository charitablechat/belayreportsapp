/**
 * NotificationCenter - Aggregated notification viewer
 * Accessible from user profile dropdown
 */

import { useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { Bell, Check, Cloud, AlertCircle, Info, Trash2, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useNotificationCenter } from '@/hooks/useNotificationCenter';
import { markAsRead, StatusNotification, NotificationType } from '@/lib/notification-center';

interface NotificationCenterProps {
  trigger?: React.ReactNode;
}

function getNotificationIcon(type: NotificationType) {
  switch (type) {
    case 'sync':
      return <Cloud className="h-4 w-4 text-blue-500" />;
    case 'save':
      return <Check className="h-4 w-4 text-green-500" />;
    case 'error':
      return <AlertCircle className="h-4 w-4 text-destructive" />;
    case 'info':
    default:
      return <Info className="h-4 w-4 text-muted-foreground" />;
  }
}

function NotificationItem({ notification }: { notification: StatusNotification }) {
  const handleClick = () => {
    if (!notification.read) {
      markAsRead(notification.id);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        'w-full text-left p-3 rounded-lg transition-colors',
        notification.read
          ? 'bg-background hover:bg-muted/50'
          : 'bg-muted/30 hover:bg-muted/50 border-l-2 border-primary'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{getNotificationIcon(notification.type)}</div>
        <div className="flex-1 min-w-0">
          <p className={cn(
            'text-sm',
            !notification.read && 'font-medium'
          )}>
            {notification.message}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {formatDistanceToNow(notification.timestamp, { addSuffix: true })}
          </p>
        </div>
      </div>
    </button>
  );
}

export function NotificationCenter({ trigger }: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, markAllAsRead, clearAll } = useNotificationCenter();

  const defaultTrigger = (
    <Button variant="ghost" size="icon" className="relative">
      <Bell className="h-5 w-5" />
      {unreadCount > 0 && (
        <Badge 
          variant="destructive" 
          className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs"
        >
          {unreadCount > 9 ? '9+' : unreadCount}
        </Badge>
      )}
    </Button>
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger || defaultTrigger}
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Activity
            </SheetTitle>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={markAllAsRead}
                  className="h-8 px-2 text-xs"
                >
                  <CheckCheck className="h-3.5 w-3.5 mr-1" />
                  Mark all read
                </Button>
              )}
              {notifications.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAll}
                  className="h-8 px-2 text-xs text-muted-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Clear
                </Button>
              )}
            </div>
          </div>
          <SheetDescription>
            Recent sync and save activity
          </SheetDescription>
        </SheetHeader>
        
        <ScrollArea className="h-[calc(100vh-10rem)] mt-4 -mx-6 px-6">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bell className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-sm text-muted-foreground">No recent activity</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Sync and save notifications will appear here
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {notifications.map((notification) => (
                <NotificationItem key={notification.id} notification={notification} />
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
