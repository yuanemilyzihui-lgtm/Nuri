-- ============================================================
-- Nuri Recipes — Supabase schema
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- Enable required extensions
create extension if not exists pgcrypto;

-- ============================================================
-- Profiles (extends Supabase auth.users)
--   Every authenticated user gets a row here.
-- ============================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  full_name    text,
  avatar_url   text,
  is_rd        boolean not null default false,
  -- Stripe Customer ID (for the user-side of subscriptions)
  stripe_customer_id text unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user is created
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Dieticians (RDs) — sellers in the marketplace
-- ============================================================
create table if not exists public.dieticians (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null unique references public.profiles(id) on delete cascade,
  display_name    text not null,
  handle          text unique,        -- e.g. @rachelnutrition
  bio             text,
  specialties     text[] default '{}',
  -- Stripe Connect account id (acct_...). Null until they start onboarding.
  stripe_account_id text unique,
  -- Cached from Stripe Account.charges_enabled / payouts_enabled
  charges_enabled  boolean not null default false,
  payouts_enabled  boolean not null default false,
  details_submitted boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists dieticians_handle_idx on public.dieticians(handle);

-- ============================================================
-- Subscriptions — one row per user x dietician
--   A user may subscribe to multiple dieticians.
-- ============================================================
create type subscription_status as enum (
  'incomplete', 'incomplete_expired', 'trialing', 'active',
  'past_due', 'canceled', 'unpaid', 'paused'
);

create table if not exists public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  subscriber_id            uuid not null references public.profiles(id) on delete cascade,
  dietician_id             uuid not null references public.dieticians(id) on delete cascade,
  stripe_subscription_id   text not null unique,
  stripe_price_id          text not null,
  status                   subscription_status not null,
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  canceled_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (subscriber_id, dietician_id)
);

create index if not exists subs_subscriber_idx on public.subscriptions(subscriber_id);
create index if not exists subs_dietician_idx on public.subscriptions(dietician_id);
create index if not exists subs_status_idx on public.subscriptions(status);

-- ============================================================
-- Stripe events ledger — idempotency for webhooks
-- ============================================================
create table if not exists public.stripe_events (
  id          text primary key,        -- evt_...
  type        text not null,
  payload     jsonb not null,
  received_at timestamptz not null default now()
);

-- ============================================================
-- Helper: does user have an active subscription to a dietician?
-- ============================================================
create or replace function public.has_active_subscription(p_user uuid, p_dietician uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.subscriptions
    where subscriber_id = p_user
      and dietician_id = p_dietician
      and status in ('trialing','active')
  );
$$;

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.profiles      enable row level security;
alter table public.dieticians    enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security; -- nobody but service role

-- Profiles: users can read/update their own profile; dietician
-- profiles are publicly readable.
drop policy if exists "Profiles are viewable by self" on public.profiles;
create policy "Profiles are viewable by self"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Profiles are viewable if linked to dietician" on public.profiles;
create policy "Profiles are viewable if linked to dietician"
  on public.profiles for select
  using (exists (select 1 from public.dieticians d where d.profile_id = profiles.id));

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Dieticians: anyone can read; only the owner can update display info.
drop policy if exists "Dieticians are public" on public.dieticians;
create policy "Dieticians are public"
  on public.dieticians for select using (true);

drop policy if exists "Dieticians update self" on public.dieticians;
create policy "Dieticians update self"
  on public.dieticians for update
  using (auth.uid() = profile_id);

-- Subscriptions: a user can only see their own subs; a dietician
-- can see subs that belong to them.
drop policy if exists "Subscriber reads own subs" on public.subscriptions;
create policy "Subscriber reads own subs"
  on public.subscriptions for select
  using (auth.uid() = subscriber_id);

drop policy if exists "Dietician reads own subs" on public.subscriptions;
create policy "Dietician reads own subs"
  on public.subscriptions for select
  using (exists (
    select 1 from public.dieticians d
    where d.id = subscriptions.dietician_id and d.profile_id = auth.uid()
  ));

-- No client-side writes: writes happen only via Stripe webhook (service role)
