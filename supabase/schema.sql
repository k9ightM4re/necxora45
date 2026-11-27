-- ============================================================
-- NEXORA - Supabase schema (idempotent: safe to re-run)
-- Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
-- ============================================================

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- profiles -----------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  avatar_url text,
  bio text,
  phone text,
  is_online boolean not null default false,
  last_seen timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(coalesce(new.email, 'user'), '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- feed ---------------------------------------------------------
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  media_url text,
  media_type text,
  like_count integer not null default 0,
  comment_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists posts_created_idx on public.posts (created_at desc);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists comments_post_idx on public.comments (post_id, created_at);

create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint no_self_follow check (follower_id <> following_id)
);

-- chat ---------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  name text,
  is_group boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text,
  media_url text,
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at desc);

-- communities --------------------------------------------------
create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  avatar_url text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

-- reels / stories ----------------------------------------------
create table if not exists public.reels (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  video_url text not null,
  caption text,
  like_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists reels_created_idx on public.reels (created_at desc);

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  media_url text not null,
  kind text not null default 'image',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

-- helper used by RLS (security definer avoids recursion) --------
create or replace function public.is_conversation_member(p_conversation uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation and user_id = auth.uid()
  );
$$;

-- row level security -------------------------------------------
alter table public.profiles             enable row level security;
alter table public.posts                enable row level security;
alter table public.comments             enable row level security;
alter table public.post_likes           enable row level security;
alter table public.follows              enable row level security;
alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;
alter table public.communities          enable row level security;
alter table public.community_members    enable row level security;
alter table public.reels                enable row level security;
alter table public.stories              enable row level security;

-- profiles
drop policy if exists "profiles_public_read" on public.profiles;
create policy "profiles_public_read" on public.profiles for select using (true);
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- posts
drop policy if exists "posts_public_read" on public.posts;
create policy "posts_public_read" on public.posts for select using (true);
drop policy if exists "posts_insert_own" on public.posts;
create policy "posts_insert_own" on public.posts for insert with check (auth.uid() = author_id);
drop policy if exists "posts_update_own" on public.posts;
create policy "posts_update_own" on public.posts for update using (auth.uid() = author_id);
drop policy if exists "posts_delete_own" on public.posts;
create policy "posts_delete_own" on public.posts for delete using (auth.uid() = author_id);

-- comments
drop policy if exists "comments_public_read" on public.comments;
create policy "comments_public_read" on public.comments for select using (true);
drop policy if exists "comments_insert_own" on public.comments;
create policy "comments_insert_own" on public.comments for insert with check (auth.uid() = author_id);
drop policy if exists "comments_delete_own" on public.comments;
create policy "comments_delete_own" on public.comments for delete using (auth.uid() = author_id);

-- likes / follows
drop policy if exists "likes_public_read" on public.post_likes;
create policy "likes_public_read" on public.post_likes for select using (true);
drop policy if exists "likes_insert_own" on public.post_likes;
create policy "likes_insert_own" on public.post_likes for insert with check (auth.uid() = user_id);
drop policy if exists "likes_delete_own" on public.post_likes;
create policy "likes_delete_own" on public.post_likes for delete using (auth.uid() = user_id);

drop policy if exists "follows_public_read" on public.follows;
create policy "follows_public_read" on public.follows for select using (true);
drop policy if exists "follows_insert_own" on public.follows;
create policy "follows_insert_own" on public.follows for insert with check (auth.uid() = follower_id);
drop policy if exists "follows_delete_own" on public.follows;
create policy "follows_delete_own" on public.follows for delete using (auth.uid() = follower_id);

-- chat
drop policy if exists "conversations_member_read" on public.conversations;
create policy "conversations_member_read" on public.conversations for select using (public.is_conversation_member(id) or created_by = auth.uid());
drop policy if exists "conversations_insert_auth" on public.conversations;
create policy "conversations_insert_auth" on public.conversations for insert with check (auth.uid() is not null);

drop policy if exists "members_read" on public.conversation_members;
create policy "members_read" on public.conversation_members for select using (public.is_conversation_member(conversation_id) or user_id = auth.uid());
drop policy if exists "members_insert" on public.conversation_members;
create policy "members_insert" on public.conversation_members for insert with check (user_id = auth.uid() or public.is_conversation_member(conversation_id));
drop policy if exists "members_delete_own" on public.conversation_members;
create policy "members_delete_own" on public.conversation_members for delete using (user_id = auth.uid());

drop policy if exists "messages_member_read" on public.messages;
create policy "messages_member_read" on public.messages for select using (public.is_conversation_member(conversation_id));
drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own" on public.messages for insert with check (auth.uid() = sender_id and public.is_conversation_member(conversation_id));

-- communities
drop policy if exists "communities_public_read" on public.communities;
create policy "communities_public_read" on public.communities for select using (true);
drop policy if exists "communities_insert_auth" on public.communities;
create policy "communities_insert_auth" on public.communities for insert with check (auth.uid() is not null);
drop policy if exists "communities_update_own" on public.communities;
create policy "communities_update_own" on public.communities for update using (auth.uid() = created_by);

drop policy if exists "community_members_public_read" on public.community_members;
create policy "community_members_public_read" on public.community_members for select using (true);
drop policy if exists "community_members_insert_own" on public.community_members;
create policy "community_members_insert_own" on public.community_members for insert with check (user_id = auth.uid());
drop policy if exists "community_members_delete_own" on public.community_members;
create policy "community_members_delete_own" on public.community_members for delete using (user_id = auth.uid());

-- reels / stories
drop policy if exists "reels_public_read" on public.reels;
create policy "reels_public_read" on public.reels for select using (true);
drop policy if exists "reels_insert_own" on public.reels;
create policy "reels_insert_own" on public.reels for insert with check (auth.uid() = author_id);
drop policy if exists "reels_delete_own" on public.reels;
create policy "reels_delete_own" on public.reels for delete using (auth.uid() = author_id);

drop policy if exists "stories_public_read" on public.stories;
create policy "stories_public_read" on public.stories for select using (true);
drop policy if exists "stories_insert_own" on public.stories;
create policy "stories_insert_own" on public.stories for insert with check (auth.uid() = author_id);
drop policy if exists "stories_delete_own" on public.stories;
create policy "stories_delete_own" on public.stories for delete using (auth.uid() = author_id);

-- realtime (safe re-run)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'posts') then
    alter publication supabase_realtime add table public.posts;
  end if;
end $$;
