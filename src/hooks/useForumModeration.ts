import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface ForumFlag {
  id: string;
  post_id: string | null;
  reply_id: string | null;
  flagged_by: string;
  reason: string;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  post?: {
    title: string;
    content: string;
  } | null;
  reply?: {
    content: string;
  } | null;
  reporter?: {
    full_name: string | null;
  };
}

export function useUnansweredPosts() {
  return useQuery({
    queryKey: ['forum-unanswered-posts'],
    queryFn: async () => {
      // No foreign keys exist between these tables, so the author and category are loaded separately
      // and attached here (an embedded join would be rejected by the database).
      const { data: posts, error } = await supabase
        .from('forum_posts')
        .select('*')
        .eq('is_answered', false)
        .eq('status', 'published')
        .order('created_at', { ascending: true });

      if (error) throw error;
      const rows = posts ?? [];
      const authorIds = [...new Set(rows.map((p) => p.author_id).filter(Boolean))];
      const categoryIds = [...new Set(rows.map((p) => p.category_id).filter(Boolean))];

      const [{ data: authors }, { data: categories }] = await Promise.all([
        authorIds.length
          ? supabase.from('profiles').select('id, full_name, avatar_url').in('id', authorIds)
          : Promise.resolve({ data: [] as any[] }),
        categoryIds.length
          ? supabase.from('forum_categories').select('id, name, slug, is_general').in('id', categoryIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const authorById = new Map((authors ?? []).map((a: any) => [a.id, { full_name: a.full_name, avatar_url: a.avatar_url }]));
      const categoryById = new Map((categories ?? []).map((c: any) => [c.id, { name: c.name, slug: c.slug, is_general: c.is_general }]));
      return rows.map((p) => ({
        ...p,
        author: authorById.get(p.author_id) ?? null,
        category: categoryById.get(p.category_id) ?? null,
      }));
    },
  });
}

export function useFlaggedContent() {
  return useQuery({
    queryKey: ['forum-flagged-content'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('forum_flags')
        .select(`
          *,
          post:forum_posts(title, content),
          reply:forum_replies(content)
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch reporter profiles
      const reporterIds = [...new Set((data || []).map(f => f.flagged_by))];
      const { data: profiles } = await supabase
        .from('public_profiles')
        .select('id, full_name')
        .in('id', reporterIds);

      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

      return (data || []).map(flag => ({
        ...flag,
        reporter: profileMap.get(flag.flagged_by) || null,
      })) as ForumFlag[];
    },
  });
}

export function useReviewFlag() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ 
      flagId, 
      action 
    }: { 
      flagId: string; 
      action: 'dismiss' | 'action';
    }) => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error('Not authenticated');

      const { data: flag, error: flagError } = await supabase
        .from('forum_flags')
        .select('post_id, reply_id')
        .eq('id', flagId)
        .single();

      if (flagError) throw flagError;

      // Update flag status
      const { error } = await supabase
        .from('forum_flags')
        .update({
          status: action === 'dismiss' ? 'dismissed' : 'actioned',
          reviewed_by: user.user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', flagId);

      if (error) throw error;

      // If action, update the post/reply status
      if (action === 'action') {
        if (flag.post_id) {
          await supabase
            .from('forum_posts')
            .update({ status: 'flagged' })
            .eq('id', flag.post_id);
        }
        if (flag.reply_id) {
          await supabase
            .from('forum_replies')
            .update({ status: 'flagged' })
            .eq('id', flag.reply_id);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forum-flagged-content'] });
      queryClient.invalidateQueries({ queryKey: ['forum-posts'] });
      toast({
        title: 'Flag Reviewed',
        description: 'The content has been reviewed.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to review flag',
        variant: 'destructive',
      });
    },
  });
}

export function useDeletePost() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await supabase
        .from('forum_posts')
        .update({ status: 'deleted' })
        .eq('id', postId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['forum-posts'] });
      queryClient.invalidateQueries({ queryKey: ['forum-unanswered-posts'] });
      toast({
        title: 'Post Deleted',
        description: 'The post has been removed.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete post',
        variant: 'destructive',
      });
    },
  });
}

export function useTriggerAIReply() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (postId: string) => {
      const { data, error } = await supabase.functions.invoke('forum-ai-reply', {
        body: { postId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (_, postId) => {
      queryClient.invalidateQueries({ queryKey: ['forum-replies', postId] });
      queryClient.invalidateQueries({ queryKey: ['forum-post', postId] });
      toast({
        title: 'AI Reply Generated',
        description: 'An AI response has been added to this post.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to generate AI reply',
        variant: 'destructive',
      });
    },
  });
}
