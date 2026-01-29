import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getUserWithCache } from '@/lib/cached-auth';

interface Profile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  acct_number: string | null;
}

export function useUserProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const user = await getUserWithCache();
        
        if (!user) {
          setLoading(false);
          return;
        }

        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        if (error) {
          console.error('Error fetching profile:', error);
        } else {
          setProfile(data);
        }
      } catch (error) {
        console.error('Error in useUserProfile:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  const fullName = profile 
    ? [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim()
    : '';

  return { profile, loading, fullName };
}
