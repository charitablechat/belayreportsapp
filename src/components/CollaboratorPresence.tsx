import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Users } from 'lucide-react';

interface Collaborator {
  user_id: string;
  name: string;
  online_at: string;
}

interface Props {
  reportId: string;
  reportType: 'inspection' | 'training' | 'daily_assessment';
  currentUserId: string | null;
  currentUserName: string;
}

/**
 * Subtle banner showing which other users are currently editing the same
 * report. Pure awareness — does not block edits. Helps prevent conflicts
 * before they happen by warning users in advance.
 *
 * Built on Supabase Realtime presence. No UI when alone.
 */
export function CollaboratorPresence({
  reportId,
  reportType,
  currentUserId,
  currentUserName,
}: Props) {
  const [others, setOthers] = useState<Collaborator[]>([]);

  useEffect(() => {
    if (!currentUserId || !reportId) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    const channelName = `report-presence:${reportType}:${reportId}`;
    const channel = supabase.channel(channelName, {
      config: { presence: { key: currentUserId } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<Collaborator>();
        const list: Collaborator[] = [];
        for (const [key, metas] of Object.entries(state)) {
          if (key === currentUserId) continue;
          const meta = (metas as Collaborator[])[0];
          if (meta) list.push(meta);
        }
        setOthers(list);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            user_id: currentUserId,
            name: currentUserName || 'Someone',
            online_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      channel.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [reportId, reportType, currentUserId, currentUserName]);

  if (others.length === 0) return null;

  const names = others.map((o) => o.name).join(', ');
  const label =
    others.length === 1
      ? `${names} is also editing this report`
      : `${others.length} others editing: ${names}`;

  return (
    <div
      className="flex items-center gap-2 rounded-md border border-warning/50 bg-warning/15 px-3 py-2 text-sm font-medium text-foreground"
      role="status"
      aria-live="polite"
    >
      <Users className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}. Changes from each device will be merged automatically.</span>
    </div>
  );
}
