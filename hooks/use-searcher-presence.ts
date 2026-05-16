import { useEffect, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';

export interface SearcherPresence {
  user_id: string;
  name: string;
  photo_url?: string;
  rescues_count: number;
  latitude: number;
  longitude: number;
  updated_at: number;
  is_premium?: boolean;
  pin_color?: string;
}

interface Self {
  user_id: string;
  name: string;
  photo_url?: string;
  rescues_count: number;
  latitude: number;
  longitude: number;
  is_premium?: boolean;
  pin_color?: string;
}

// ============================================================================
// Canal de presence COMPARTILHADO (singleton de módulo).
//
// Singleton porque o Supabase Realtime não permite registrar callbacks
// (`.on(...)`) num canal já inscrito. O canal é criado UMA vez por sessão.
//
// IMPORTANTE — limite de taxa de presence:
// O Realtime derruba updates de presence quando o cliente publica rápido
// demais (erro `client_rate_limit_exceeded`) — e o update derrubado pode ser
// justamente o `track()` que registra o buscador, fazendo-o sumir do mapa.
// Por isso:
//   - `track()` NÃO é precedido de `untrack()` a cada movimento — chamar
//     `track()` de novo já ATUALIZA a presença existente;
//   - updates de posição são limitados a 1 a cada TRACK_THROTTLE_MS;
//   - `untrack()` só é chamado ao realmente parar de publicar (sair do mapa
//     ou desligar "aparecer no mapa").
// ============================================================================

const TRACK_THROTTLE_MS = 7000;

let channel: RealtimeChannel | null = null;
let channelKey: string | null = null;
let joined = false;

let publishing = false;              // intenção: devo aparecer no mapa?
let currentSelf: Self | null = null; // meta mais recente a publicar
let lastTrackAt = 0;
let trackTimer: ReturnType<typeof setTimeout> | null = null;

let latest: SearcherPresence[] = [];
const subscribers = new Set<(list: SearcherPresence[]) => void>();

function readPresence(ch: RealtimeChannel): SearcherPresence[] {
  const state = ch.presenceState();
  const all: SearcherPresence[] = [];
  Object.entries(state).forEach(([key, presences]: any) => {
    const meta = presences?.[0];
    if (meta && typeof meta.latitude === 'number' && typeof meta.longitude === 'number') {
      all.push({
        user_id: key,
        name: meta.name ?? 'Buscador',
        photo_url: meta.photo_url,
        rescues_count: Number(meta.rescues_count ?? 0),
        latitude: Number(meta.latitude),
        longitude: Number(meta.longitude),
        updated_at: Number(meta.updated_at ?? Date.now()),
        is_premium: Boolean(meta.is_premium),
        pin_color: meta.pin_color,
      });
    }
  });
  return all;
}

function doTrack() {
  if (!channel || !joined || !publishing || !currentSelf) return;
  lastTrackAt = Date.now();
  channel.track({ ...currentSelf, updated_at: lastTrackAt });
}

// Agenda um track respeitando o limite de taxa (coalesce updates rápidos)
function scheduleTrack() {
  if (!publishing || trackTimer) return;
  const elapsed = Date.now() - lastTrackAt;
  if (elapsed >= TRACK_THROTTLE_MS) {
    doTrack();
  } else {
    trackTimer = setTimeout(() => {
      trackTimer = null;
      doTrack();
    }, TRACK_THROTTLE_MS - elapsed);
  }
}

function clearTrackTimer() {
  if (trackTimer) {
    clearTimeout(trackTimer);
    trackTimer = null;
  }
}

function ensureChannel(userId: string): RealtimeChannel {
  // Canal já existe pro mesmo usuário → reutiliza (NÃO chama .on/.subscribe de novo)
  if (channel && channelKey === userId) return channel;

  // Usuário mudou (logout/login) → descarta o canal antigo
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
    joined = false;
  }

  const ch = supabase.channel('searchers', {
    config: { presence: { key: userId } },
  });

  ch.on('presence', { event: 'sync' }, () => {
    latest = readPresence(ch);
    subscribers.forEach((cb) => cb(latest));
  });

  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      joined = true;
      if (publishing) doTrack(); // (re)publica imediatamente ao entrar
    } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      // socket caiu — o cliente Realtime reconecta e dispara SUBSCRIBED de novo
      joined = false;
    }
  });

  channel = ch;
  channelKey = userId;
  return ch;
}

function startPublishing(self: Self) {
  publishing = true;
  currentSelf = self;
  doTrack(); // publica de imediato (se ainda não entrou, o subscribe republica)
}

function stopPublishing() {
  publishing = false;
  currentSelf = null;
  clearTrackTimer();
  if (channel && joined) channel.untrack();
}

export function useSearcherPresence(self: Self | null, publishSelf: boolean): SearcherPresence[] {
  const [searchers, setSearchers] = useState<SearcherPresence[]>(latest);

  // Inscreve a tela no canal (cria o canal se ainda não existe)
  useEffect(() => {
    if (!self?.user_id) return;
    const ch = ensureChannel(self.user_id);
    subscribers.add(setSearchers);
    // Lê o estado atual imediatamente (direto do canal se já inscrito).
    setSearchers(joined ? readPresence(ch) : latest);
    // Reconsulta após o canal estabilizar — pega presenças que chegaram antes
    // de esta tela montar (evita "um vê e o outro não" por cache desatualizado).
    const t1 = setTimeout(() => { if (channel) { latest = readPresence(channel); subscribers.forEach((cb) => cb(latest)); } }, 1500);
    const t2 = setTimeout(() => { if (channel) { latest = readPresence(channel); subscribers.forEach((cb) => cb(latest)); } }, 4000);
    return () => {
      subscribers.delete(setSearchers);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [self?.user_id]);

  // Liga / desliga a publicação — NÃO depende da posição, então não recria
  // a presença a cada passo do GPS (o que estourava o limite de taxa).
  useEffect(() => {
    if (!self?.user_id) return;
    ensureChannel(self.user_id);
    if (publishSelf && self) startPublishing(self);
    else stopPublishing();
    return () => {
      // ao sair da tela do mapa, para de publicar (mas o canal continua vivo)
      stopPublishing();
    };
  }, [publishSelf, self?.user_id]);

  // Atualiza posição/meta enquanto publica — com limite de taxa, sem untrack
  useEffect(() => {
    if (!publishSelf || !self) return;
    currentSelf = self;
    scheduleTrack();
  }, [
    publishSelf,
    self?.user_id,
    self?.latitude,
    self?.longitude,
    self?.name,
    self?.photo_url,
    self?.rescues_count,
    self?.is_premium,
    self?.pin_color,
  ]);

  return searchers;
}
