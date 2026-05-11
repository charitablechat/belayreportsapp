/**
 * TEMPORARY FEATURE: Known Issues Card
 * 
 * This component displays known issues/announcements to all users.
 * Only super admins can edit the content.
 * 
 * TO REMOVE THIS FEATURE:
 * 1. Delete this file
 * 2. Remove import and usage from Dashboard.tsx
 * 3. Run SQL: DROP TABLE public.app_announcements;
 */

import { useState, useEffect } from 'react';
import { AlertTriangle, Edit2, Save, X } from 'lucide-react';
import DOMPurify from 'dompurify';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { supabase } from '@/integrations/supabase/client';
import { getUserWithCache } from '@/lib/cached-auth';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { convertToBulletList } from '@/lib/html-content-cleaner';

interface KnownIssuesCardProps {
  isSuperAdmin: boolean;
}

interface Announcement {
  id: string;
  content: string;
  updated_at: string;
}

export const KnownIssuesCard = ({ isSuperAdmin }: KnownIssuesCardProps) => {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchAnnouncement();
  }, []);

  const fetchAnnouncement = async () => {
    try {
      const { data, error } = await supabase
        .from('app_announcements')
        .select('id, content, updated_at')
        .eq('announcement_type', 'known_issues')
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching announcement:', error);
      }

      if (data) {
        setAnnouncement(data);
        setEditContent(data.content);
      }
    } catch (error) {
      console.error('Error fetching announcement:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!announcement) return;

    setSaving(true);
    
    // Safety timeout - NEVER get stuck in saving state
    const safetyTimeout = setTimeout(() => {
      console.warn('[KnownIssuesCard] Safety timeout reached, forcing save state reset');
      setSaving(false);
    }, 8000);
    
    try {
      const user = await getUserWithCache();

      const { data, error } = await supabase
        .from('app_announcements')
        .update({
          content: editContent,
          updated_at: new Date().toISOString(),
          updated_by: user?.id
        })
        .eq('id', announcement.id)
        .select('id, content, updated_at')
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        toast.error("Save blocked — you don't have permission to edit Known Issues.");
        return;
      }

      setAnnouncement({
        ...announcement,
        content: data.content,
        updated_at: data.updated_at,
      });
      setIsEditing(false);
      toast.success('Known issues updated successfully');
    } catch (error) {
      console.error('Error saving announcement:', error);
      toast.error('Failed to save changes');
    } finally {
      clearTimeout(safetyTimeout);
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditContent(announcement?.content || '');
    setIsEditing(false);
  };

  // Don't render if loading or no content and not a super admin
  if (loading) return null;
  if (!announcement?.content && !isSuperAdmin) return null;

  // Check if there's actual content (not just empty HTML)
  const hasContent = announcement?.content && 
    announcement.content.replace(/<[^>]*>/g, '').trim().length > 0;

  // Only show card if there's content OR if user is super admin (so they can add content)
  if (!hasContent && !isSuperAdmin) return null;

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
            <AlertTriangle className="h-5 w-5" />
            Known Issues
          </CardTitle>
          {isSuperAdmin && !isEditing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsEditing(true)}
              className="text-muted-foreground hover:text-foreground"
            >
              <Edit2 className="h-4 w-4 mr-1" />
              Edit
            </Button>
          )}
          {isEditing && (
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                disabled={saving}
              >
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleSave}
                disabled={saving}
              >
                <Save className="h-4 w-4 mr-1" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isEditing ? (
          <RichTextEditor
            content={editContent}
            onChange={setEditContent}
            placeholder="Enter known issues (use bullet points for formatting)..."
          />
        ) : (
          <>
            {hasContent ? (
              <div 
                className="prose prose-sm dark:prose-invert max-w-none [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-1"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(convertToBulletList(announcement?.content || '')) }}
              />
            ) : (
              <p className="text-muted-foreground text-sm italic">
                No known issues at this time. Click "Edit" to add content.
              </p>
            )}
            {announcement?.updated_at && hasContent && (
              <p className="text-xs text-muted-foreground mt-4 pt-2 border-t border-border/50">
                Last updated: {format(new Date(announcement.updated_at), 'MMM d, yyyy h:mm a')}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
