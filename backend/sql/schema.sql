-- ============================================================================
-- PetPerdidoSOS — Schema canônico (Fase 0 + 1 aplicado via Supabase MCP)
-- Migrations já aplicadas no projeto remoto:
--   01_cleanup_old_schema
--   02_extensions_and_enums
--   03_core_tables
--   04_business_tables
--   05_triggers
--   06_rls_policies
--   07_security_hardening
--   08_storage_policies
--
-- Este arquivo é a fonte da verdade documentada. Para reaplicar do zero em
-- outro projeto Supabase, rode os blocos abaixo em ordem.
-- ============================================================================

-- 1. EXTENSIONS
create extension if not exists "uuid-ossp";

-- 2. ENUMS
create type pet_status           as enum ('ativo','pausado','encontrado','cancelado');
create type pet_size              as enum ('pequeno','medio','grande');
create type reward_status         as enum ('pending','locked','paid','refunded');
create type chat_status           as enum ('open','closed');
create type transaction_type      as enum ('deposit','escrow_hold','escrow_release','reward_received','withdraw','refund','fee');
create type transaction_status    as enum ('pending','completed','failed');
create type notification_channel  as enum ('email','whatsapp','both','none');
create type travel_mode           as enum ('walking','driving','bicycling','transit');

-- 3. TABLES
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text,
  cpf             text unique,
  phone           text,
  photo_url       text,
  pix_key         text,
  rating          numeric(3,2) default 0 check (rating >= 0 and rating <= 5),
  rescues_count   int default 0 check (rescues_count >= 0),
  wallet_balance  numeric(12,2) default 0 check (wallet_balance >= 0),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
-- Colunas adicionadas por migrations posteriores:
--   bio text, is_premium boolean, premium_expires_at timestamptz, is_admin boolean
--   status text ('active'|'blocked'|'banned'), status_reason text, status_changed_at timestamptz
-- (migration: profiles_user_status — moderação; bloqueio/banimento também aplica
--  o ban nativo do Supabase Auth, impedindo o login)

create table public.user_settings (
  user_id                  uuid primary key references public.profiles(id) on delete cascade,
  show_on_map              boolean default true,
  notification_channel     notification_channel default 'email',
  default_search_radius_m  int default 5000 check (default_search_radius_m between 100 and 50000),
  travel_mode              travel_mode default 'driving',
  updated_at               timestamptz default now()
);

create table public.pets (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  name            text not null,
  breed           text,
  color           text,
  size            pet_size,
  description     text,
  extra_info      text,
  main_photo_url  text not null,
  latitude        double precision not null,
  longitude       double precision not null,
  lost_date       timestamptz default now(),
  status          pet_status default 'ativo',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create table public.pet_photos (
  id          uuid primary key default uuid_generate_v4(),
  pet_id      uuid not null references public.pets(id) on delete cascade,
  photo_url   text not null,
  position    smallint not null check (position between 1 and 3),
  created_at  timestamptz default now(),
  unique (pet_id, position)
);

create table public.rewards (
  id                uuid primary key default uuid_generate_v4(),
  pet_id            uuid not null references public.pets(id) on delete cascade,
  amount            numeric(12,2) not null check (amount >= 0),
  fee_amount        numeric(12,2) not null default 0 check (fee_amount >= 0),
  status            reward_status default 'pending',
  payer_user_id     uuid not null references public.profiles(id) on delete restrict,
  finder_user_id    uuid references public.profiles(id) on delete set null,
  payment_provider  text,
  payment_id        text,
  paid_at           timestamptz,
  refunded_at       timestamptz,
  created_at        timestamptz default now()
);

create table public.chats (
  id          uuid primary key default uuid_generate_v4(),
  pet_id      uuid not null references public.pets(id) on delete cascade,
  tutor_id    uuid not null references public.profiles(id) on delete cascade,
  finder_id   uuid not null references public.profiles(id) on delete cascade,
  status      chat_status default 'open',
  found       boolean,
  closed_at   timestamptz,
  created_at  timestamptz default now(),
  unique (pet_id, finder_id),
  check (tutor_id <> finder_id)
);

create table public.messages (
  id          uuid primary key default uuid_generate_v4(),
  chat_id     uuid not null references public.chats(id) on delete cascade,
  sender_id   uuid not null references public.profiles(id) on delete cascade,
  content     text,
  photo_url   text,
  read        boolean default false,
  created_at  timestamptz default now(),
  check (content is not null or photo_url is not null)
);

create table public.sightings (
  id              uuid primary key default uuid_generate_v4(),
  pet_id          uuid references public.pets(id) on delete cascade,
  finder_id       uuid not null references public.profiles(id) on delete cascade,
  latitude        double precision not null,
  longitude       double precision not null,
  photo_url       text,
  message         text,
  ai_match_score  numeric(5,4) check (ai_match_score is null or (ai_match_score >= 0 and ai_match_score <= 1)),
  created_at      timestamptz default now()
);

create table public.ratings (
  id          uuid primary key default uuid_generate_v4(),
  pet_id      uuid not null references public.pets(id) on delete cascade,
  rater_id    uuid not null references public.profiles(id) on delete cascade,
  rated_id    uuid not null references public.profiles(id) on delete cascade,
  score       smallint not null check (score between 1 and 5),
  comment     text,
  created_at  timestamptz default now(),
  unique (pet_id, rater_id, rated_id),
  check (rater_id <> rated_id)
);

create table public.transactions (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  type          transaction_type not null,
  amount        numeric(12,2) not null,
  status        transaction_status default 'completed',
  reward_id     uuid references public.rewards(id) on delete set null,
  pet_id        uuid references public.pets(id) on delete set null,
  description   text,
  external_id   text,
  created_at    timestamptz default now()
);

create table public.notifications (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  body        text,
  type        text,
  pet_id      uuid references public.pets(id) on delete set null,
  chat_id     uuid references public.chats(id) on delete set null,
  read        boolean default false,
  created_at  timestamptz default now()
);

-- Configurações globais do app (linha única, id sempre = 1).
-- migration: app_settings_fee_rate
create table public.app_settings (
  id          int primary key default 1 check (id = 1),
  fee_rate    numeric(5,4) not null default 0.10 check (fee_rate >= 0 and fee_rate <= 1),
  updated_at  timestamptz not null default now()
);
-- RLS habilitado sem policies: apenas o backend (service role) acessa;
-- o app lê a taxa via GET /config/fee-rate.

-- Suporte (Central de Ajuda) — tabelas criadas por migration anterior:
--   support_conversations (id, user_id, status, created_at, updated_at)
--   support_messages       (id, conversation_id, role, content, created_at)
--   support_tickets        (id, conversation_id, user_id, subject, description,
--                           status, admin_notes, created_at, updated_at)
-- migration: support_tickets_triage —
--   support_messages.role passa a aceitar 'support' (resposta humana do admin);
--   support_tickets ganha priority (baixa/normal/alta/urgente) e category.

-- Para os índices, triggers, RLS e policies completos, consulte as migrations
-- aplicadas no Supabase (Dashboard → Database → Migrations).
