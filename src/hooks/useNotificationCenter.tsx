/**
 * Hook for accessing the notification center
 */

import { useState, useEffect, useCallback } from 'react';
import {
  subscribeToNotifications,
  getNotifications,
  getUnreadCount,
  getRecentActivity,
  markAllAsRead,
  clearNotifications,
  StatusNotification,
} from '@/lib/notification-center';

export function useNotificationCenter() {
  const [notifications, setNotifications] = useState<StatusNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [recentActivity, setRecentActivity] = useState<{
    syncing: boolean;
    errors: number;
    lastActivity: string | null;
  }>({ syncing: false, errors: 0, lastActivity: null });

  useEffect(() => {
    // Initial load
    setNotifications(getNotifications());
    setUnreadCount(getUnreadCount());
    setRecentActivity(getRecentActivity());

    // Subscribe to changes
    const unsubscribe = subscribeToNotifications(() => {
      setNotifications(getNotifications());
      setUnreadCount(getUnreadCount());
      setRecentActivity(getRecentActivity());
    });

    // Periodic refresh for expiry cleanup
    const interval = setInterval(() => {
      setNotifications(getNotifications());
      setUnreadCount(getUnreadCount());
      setRecentActivity(getRecentActivity());
    }, 10000); // Every 10 seconds

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  const handleMarkAllAsRead = useCallback(() => {
    markAllAsRead();
  }, []);

  const handleClearAll = useCallback(() => {
    clearNotifications();
  }, []);

  return {
    notifications,
    unreadCount,
    recentActivity,
    markAllAsRead: handleMarkAllAsRead,
    clearAll: handleClearAll,
  };
}
