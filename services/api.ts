// Em um ambiente real, você apontaria para o IP da sua máquina ou URL de produção
// Para emuladores Android, localhost é 10.0.2.2. Para iOS é localhost ou 127.0.0.1.
// Para Expo Go em aparelho físico, precisa ser o IP da sua rede local (ex: 192.168.1.X)

import { Platform } from 'react-native';
import { supabase } from './supabase';

const getBaseUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:3005';
  }
  return 'http://localhost:3005';
};

export const API_URL = getBaseUrl();

// ============================================================================
// AUTH — todas as chamadas à API enviam o JWT do Supabase no header.
// O backend deriva a identidade do token (nunca confia em userId do corpo/URL).
// authedFetch injeta o Authorization automaticamente em cada requisição.
// ============================================================================
async function authHeaders(
  base: Record<string, string> = {}
): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { ...base, Authorization: `Bearer ${token}` } : base;
  } catch {
    return base;
  }
}

async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = await authHeaders((init.headers as Record<string, string>) ?? {});
  return fetch(input, { ...init, headers });
}

export type PetSize = 'pequeno' | 'medio' | 'grande';
export type PetSex = 'macho' | 'femea' | 'desconhecido';
export type PetAgeGroup = 'filhote' | 'adulto' | 'idoso' | 'desconhecido';
export type PetStatus = 'ativo' | 'pausado' | 'encontrado' | 'cancelado' | 'doado';
// Tipo do registro: perdido (dono), avistado na rua, resgatado ou em doação.
export type PetType = 'lost' | 'sighted' | 'rescued' | 'donation';
// Espécie do pet (null = não sei).
export type PetSpecies = 'cachorro' | 'gato' | 'passaro' | 'outro';
export type RewardStatus = 'pending' | 'locked' | 'paid' | 'refunded';
export type ChatStatus = 'open' | 'closed';

export interface PetSighting {
  id: string;
  name: string;
  breed?: string;
  color?: string;
  size?: PetSize;
  sex?: PetSex;
  age_group?: PetAgeGroup;
  description?: string;
  extra_info?: string;
  photo_url: string;
  latitude: number;
  longitude: number;
  distance: number;
  lost_date?: string;
  status?: PetStatus;
  type?: PetType;
  species?: PetSpecies | null;
  allow_contact?: boolean;
  is_with_finder?: boolean;
  adoption_rules?: string | null;
  reward?: {
    amount: number;
    status?: RewardStatus;
  };
  user?: {
    name: string;
    id: string;
    rescues_count?: number;
  };
}

export interface CreatePetInput {
  userId: string;
  name: string;
  breed?: string;
  color?: string;
  size?: PetSize;
  sex?: PetSex;
  age_group?: PetAgeGroup;
  description?: string;
  extra_info?: string;
  main_photo_url: string;
  latitude: number;
  longitude: number;
  lost_date?: string;
  reward_amount?: number;
  extra_photos?: string[]; // max 3
  type?: PetType; // default 'lost'
  species?: PetSpecies; // cachorro/gato/outro (undefined = não sei)
  allow_contact?: boolean; // sighted: permitir chat
  is_with_finder?: boolean; // rescued: pet está comigo
  adoption_rules?: string; // donation: regras para adoção
  consent_responsibility?: boolean; // donation: consentimento responsabilidade
  consent_searched_owner?: boolean; // donation: consentimento já procurou o dono
}

export const fetchNearbyPets = async (lat: number, lng: number, radius = 5000): Promise<PetSighting[]> => {
  try {
    const controller = new AbortController();
    // 8s: a 1ª conexão (DNS+TCP+TLS até a VPS) pode passar de alguns segundos.
    // Timeout curto fazia a busca cair no fallback "mock" sem necessidade.
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await authedFetch(`${API_URL}/pets/nearby?lat=${lat}&lng=${lng}&radius=${radius}`, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Erro HTTP: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Erro ao buscar pets próximos (API possivelmente offline). Retornando dados de teste:', error);
    // Fallback com dados de teste caso o backend não esteja rodando
    return [
      {
        id: 'mock-1',
        name: 'Rex (Mock)',
        description: 'Cachorro caramelo muito dócil, visto perto da praça.',
        photo_url: 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=400',
        latitude: lat + 0.002,
        longitude: lng + 0.002,
        distance: 300,
        lost_date: new Date(Date.now() - 86400000).toISOString(),
        reward: { amount: 150 },
        user: { name: 'João Silva', id: 'user-1' }
      },
      {
        id: 'mock-2',
        name: 'Mia (Mock)',
        description: 'Gata siamesa com coleira rosa, muito assustada.',
        photo_url: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=400',
        latitude: lat - 0.004,
        longitude: lng + 0.001,
        distance: 800,
        lost_date: new Date(Date.now() - 172800000).toISOString(),
        reward: { amount: 300 },
        user: { name: 'Maria Souza', id: 'user-2' }
      },
      {
        id: 'mock-3',
        name: 'Thor (Mock)',
        description: 'Golden Retriever grande, atende pelo nome de Thor.',
        photo_url: 'https://images.unsplash.com/photo-1552053831-71594a27632d?w=400',
        latitude: lat + 0.001,
        longitude: lng - 0.005,
        distance: 600,
        lost_date: new Date(Date.now() - 3600000).toISOString(),
        user: { name: 'Carlos', id: 'user-3' }
      }
    ];
  }
};

// ============================================================================
// DOAÇÃO — lista de pets para adoção (área própria, fora do mapa SOS)
// ============================================================================
export interface DonationPet {
  id: string;
  name: string;
  breed?: string | null;
  color?: string | null;
  size?: PetSize | null;
  sex?: PetSex | null;
  age_group?: PetAgeGroup | null;
  description?: string | null;
  extra_info?: string | null;
  type: 'donation';
  species?: PetSpecies | null;
  adoption_rules?: string | null;
  photo_url: string;
  latitude: number;
  longitude: number;
  distance: number | null;
  created_at?: string;
  user?: { id: string; name: string; photo_url?: string | null; rescues_count?: number };
}

export const fetchDonations = async (params?: {
  lat?: number;
  lng?: number;
  radius?: number;
  species?: PetSpecies | null;
}): Promise<DonationPet[]> => {
  const q = new URLSearchParams();
  if (params?.lat != null && params?.lng != null) {
    q.set('lat', String(params.lat));
    q.set('lng', String(params.lng));
  }
  if (params?.radius != null) q.set('radius', String(params.radius));
  if (params?.species) q.set('species', params.species);

  const response = await authedFetch(`${API_URL}/pets/donations?${q.toString()}`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Erro HTTP: ${response.status}`);
  }
  return response.json();
};

export const createPetReport = async (data: CreatePetInput) => {
  try {
    const response = await authedFetch(`${API_URL}/pets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Erro HTTP: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Erro ao criar alerta de pet:', error);
    throw error;
  }
};

export interface UpdatePetInput {
  userId: string;
  name?: string;
  breed?: string;
  color?: string;
  size?: PetSize;
  sex?: PetSex;
  age_group?: PetAgeGroup;
  description?: string;
  extra_info?: string;
  main_photo_url?: string;
  latitude?: number;
  longitude?: number;
  lost_date?: string;
  extra_photos?: string[];
  allow_contact?: boolean; // sighted: permitir chat
  is_with_finder?: boolean; // rescued: pet está comigo
  adoption_rules?: string; // donation: regras para adoção
}

export const updatePet = async (petId: string, patch: UpdatePetInput) => {
  const response = await authedFetch(`${API_URL}/pets/${petId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Erro HTTP: ${response.status}`);
  }
  return response.json();
};

export const increaseReward = async (petId: string, userId: string, delta: number) => {
  const response = await authedFetch(`${API_URL}/pets/${petId}/reward/increase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, delta }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Erro HTTP: ${response.status}`);
  }
  return response.json();
};

export const cancelPet = async (petId: string, userId: string) => {
  const response = await authedFetch(`${API_URL}/pets/${petId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Erro HTTP: ${response.status}`);
  }
  return response.json();
};

export interface PetMatch {
  id: string;
  name: string;
  breed?: string;
  color?: string;
  size?: PetSize;
  sex?: PetSex;
  age_group?: PetAgeGroup;
  description?: string;
  extra_info?: string;
  photo_url: string;
  latitude: number;
  longitude: number;
  lost_date?: string;
  status?: PetStatus;
  type?: PetType;
  species?: PetSpecies | null;
  user?: { id: string; name?: string; photo_url?: string | null };
  similarity: number; // 0-100
  distance: number | null; // metros
}

export const matchPetByPhoto = async (
  photo_url: string,
  latitude?: number,
  longitude?: number
): Promise<PetMatch[]> => {
  const response = await authedFetch(`${API_URL}/pets/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_url, latitude, longitude }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Erro HTTP: ${response.status}`);
  }
  return response.json();
};

// Inicia contato com o dono a partir de um match: cria chat vinculado ao alerta
// de visto/resgatado (sourcePetId) e retorna os dados para abrir o chat.
export const contactOwner = async (
  lostPetId: string,
  sourcePetId: string
): Promise<{ chatId: string; petId: string; tutorId: string; sourcePetId: string }> => {
  const response = await authedFetch(`${API_URL}/pets/${lostPetId}/contact-owner`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourcePetId }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Erro HTTP: ${response.status}`);
  }
  return response.json();
};

// "É o meu pet" (claim): o tutor de um pet perdido reivindica um pet visto/
// resgatado. Abre/continua o chat do caso (pet perdido).
export const claimSighting = async (
  sightedPetId: string,
  lostPetId: string
): Promise<{ chatId: string; petId: string; tutorId: string; finderId: string }> => {
  const response = await authedFetch(`${API_URL}/pets/${sightedPetId}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lostPetId }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Erro HTTP: ${response.status}`);
  }
  return response.json();
};

export interface SightingPoint {
  id: string;
  latitude: number;
  longitude: number;
  photo_url: string | null;
  created_at: string;
  source_pet_id: string | null;
  finder_id: string | null;
}

// Avistamentos confirmados de um pet (trilha cronológica no mapa).
export const getPetSightings = async (petId: string): Promise<SightingPoint[]> => {
  const response = await authedFetch(`${API_URL}/pets/${petId}/sightings`);
  if (!response.ok) return [];
  return response.json();
};

export interface ChatMeta {
  id: string;
  source_pet_id: string | null;
  tutor_id: string;
  finder_id: string;
}

// Metadados do chat (alerta relacionado + papéis) para o app exibir card/confirmar.
export const getChatMeta = async (petId: string, otherId: string): Promise<ChatMeta | null> => {
  const response = await authedFetch(`${API_URL}/pets/${petId}/chat-meta?otherId=${otherId}`);
  if (!response.ok) return null;
  return response.json();
};

// Cancela/encerra o chat (qualquer participante).
export const cancelChat = async (chatId: string): Promise<{ success: boolean }> => {
  const response = await authedFetch(`${API_URL}/chats/${chatId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Erro HTTP: ${response.status}`);
  }
  return response.json();
};

// Tutor confirma que o alerta relacionado é o seu pet (entra na timeline do caso).
export const confirmSighting = async (
  chatId: string
): Promise<{ success: boolean; sourceType: PetType; rescued?: boolean; reward?: number }> => {
  const response = await authedFetch(`${API_URL}/sightings/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Erro HTTP: ${response.status}`);
  }
  return response.json();
};

export const PET_REPORT_REASONS = [
  'Informações falsas ou enganosas',
  'Conteúdo impróprio ou ofensivo',
  'Golpe ou tentativa de fraude',
  'O pet não está perdido / spam',
  'Outro motivo',
] as const;

export interface ReportPetResult {
  success: boolean;
  reportsCount: number;
  paused: boolean;
}

// Denúncia de um alerta de pet inapropriado. Ao atingir o limite, o alerta é
// pausado e enviado para análise do admin (lógica no backend).
export const reportPet = async (
  petId: string,
  userId: string,
  reason: string
): Promise<ReportPetResult> => {
  const response = await authedFetch(`${API_URL}/pets/${petId}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, reason }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Erro HTTP: ${response.status}`);
  }
  return response.json();
};

export const getPetDetails = async (petId: string) => {
  const response = await authedFetch(`${API_URL}/pets/${petId}`);
  if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
  return response.json();
};

export const getPetCase = async (petId: string) => {
  const response = await authedFetch(`${API_URL}/pets/${petId}/case`);
  if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
  return response.json();
};

export interface RescueItem {
  chat_id: string;
  pet: {
    id: string;
    name: string;
    main_photo_url: string | null;
    breed: string | null;
    color: string | null;
    size: PetSize | null;
    status: PetStatus;
    lost_date: string | null;
  };
  tutor: { id: string; full_name: string | null; photo_url: string | null } | null;
  rescued_at: string | null;
  reward_amount: number;
}

export interface RescuesResponse {
  rescues: RescueItem[];
  totalEarned: number;
  count: number;
}

export const getUserRescues = async (userId: string): Promise<RescuesResponse> => {
  const response = await authedFetch(`${API_URL}/user/${userId}/rescues`);
  if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
  return response.json();
};

export const listUserChats = async (userId: string) => {
  const response = await authedFetch(`${API_URL}/user/${userId}/chats`);
  if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
  return response.json();
};

export const confirmRescueByChat = async (chatId: string, userId: string) => {
  const response = await authedFetch(`${API_URL}/chats/${chatId}/confirm-rescue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Erro HTTP: ${response.status}`);
  }
  return response.json();
};

// DOAÇÃO — transforma um pet resgatado em alerta de doação (exige consentimentos).
export const transformToDonation = async (
  petId: string,
  adoptionRules: string,
  consentResponsibility: boolean,
  consentSearchedOwner: boolean,
) => {
  const response = await authedFetch(`${API_URL}/pets/${petId}/transform-donation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      adoption_rules: adoptionRules,
      consent_responsibility: consentResponsibility,
      consent_searched_owner: consentSearchedOwner,
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Erro HTTP: ${response.status}`);
  }
  return response.json();
};

// DOAÇÃO — doador confirma a adoção pelo chat (relaciona o adotante). Sem recompensa.
export const confirmDonation = async (chatId: string): Promise<{ success: boolean }> => {
  const response = await authedFetch(`${API_URL}/chats/${chatId}/confirm-donation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Erro HTTP: ${response.status}`);
  }
  return response.json();
};

// DOAÇÃO — conclui a doação feita por outro local (offline), sem adotante do app.
export const concludeDonation = async (petId: string): Promise<{ success: boolean }> => {
  const response = await authedFetch(`${API_URL}/pets/${petId}/conclude-donation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Erro HTTP: ${response.status}`);
  }
  return response.json();
};

// Fila de adoção: posição deste chat (doação) na ordem de chegada.
export interface DonationQueue { isDonation: boolean; position: number; total: number; }
export const getDonationQueue = async (chatId: string): Promise<DonationQueue> => {
  const response = await authedFetch(`${API_URL}/chats/${chatId}/queue`);
  if (!response.ok) return { isDonation: false, position: 0, total: 0 };
  return response.json();
};

export const closeChat = async (chatId: string, userId: string, found: boolean) => {
  const response = await authedFetch(`${API_URL}/chats/${chatId}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, found }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Erro HTTP: ${response.status}`);
  }
  return response.json();
};

export interface Transaction {
  id: string;
  type: 'deposit' | 'escrow_hold' | 'escrow_release' | 'reward_received' | 'withdraw' | 'refund' | 'fee';
  amount: number;
  fee_amount: number;   // taxa gravada no momento da criação — não depende da taxa atual
  status: 'pending' | 'completed' | 'failed';
  description?: string;
  reward_id?: string;
  pet_id?: string;
  external_id?: string;
  created_at: string;
  pets?: { name: string; main_photo_url?: string; status?: string };
}

export const getTransactions = async (userId: string): Promise<Transaction[]> => {
  const response = await authedFetch(`${API_URL}/user/${userId}/transactions`);
  if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
  return response.json();
};

// Taxa administrativa configurada no painel admin (fallback 10% se indisponível).
export const getFeeRate = async (): Promise<number> => {
  try {
    const response = await authedFetch(`${API_URL}/config/fee-rate`);
    if (!response.ok) return 0.10;
    const data = await response.json();
    return typeof data.feeRate === 'number' ? data.feeRate : 0.10;
  } catch {
    return 0.10;
  }
};

export const requestWithdraw = async (userId: string, amount: number) => {
  const response = await authedFetch(`${API_URL}/user/${userId}/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Erro HTTP: ${response.status}`);
  }
  return response.json();
};

// Push: registra/remove o token de notificação do aparelho.
export const registerPushToken = async (token: string, platform: string): Promise<void> => {
  try {
    await authedFetch(`${API_URL}/user/push-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, platform }),
    });
  } catch {
    // silencioso — push é best-effort
  }
};

export const removePushToken = async (token: string): Promise<void> => {
  try {
    await authedFetch(`${API_URL}/user/push-token`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  } catch {
    // silencioso
  }
};

// Exclusão de conta (LGPD). O backend valida pendências e remove os dados.
export const deleteAccount = async (): Promise<{ success: boolean }> => {
  const response = await authedFetch(`${API_URL}/user/account`, { method: 'DELETE' });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Erro HTTP: ${response.status}`);
  }
  return response.json();
};

export const getUserSettings = async (userId: string) => {
  const response = await authedFetch(`${API_URL}/user/${userId}/settings`);
  if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
  return response.json();
};

export const updateUserSettings = async (
  userId: string,
  patch: {
    show_on_map?: boolean;
    notification_channel?: 'email' | 'whatsapp' | 'both' | 'none';
    default_search_radius_m?: number;
    travel_mode?: 'walking' | 'driving' | 'bicycling' | 'transit';
    pin_color?: string;
    show_profile_photo?: boolean;
  }
) => {
  const response = await authedFetch(`${API_URL}/user/${userId}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
  return response.json();
};

export const getUserProfile = async (userId: string) => {
  try {
    const response = await authedFetch(`${API_URL}/pets/user/${userId}/profile`);
    if (!response.ok) {
      throw new Error(`Erro HTTP: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Erro ao buscar perfil:', error);
    throw error;
  }
};

export interface PublicProfile {
  id: string;
  full_name: string | null;
  photo_url: string | null;
  rescues_count: number;
  rating: number | null;
  bio: string | null;
  created_at: string | null;
  is_premium: boolean;
}

// Perfil público de outro usuário (sem dados sensíveis) — usado no chat
export const getPublicProfile = async (userId: string): Promise<PublicProfile | null> => {
  const response = await authedFetch(`${API_URL}/user/${userId}/public-profile`);
  if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
  return response.json();
};

export const confirmRescue = async (petId: string, tutorId: string, finderEmail: string) => {
  try {
    const response = await authedFetch(`${API_URL}/pets/${petId}/confirm-rescue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tutorId, finderEmail }),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || `Erro HTTP: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Erro ao confirmar resgate:', error);
    throw error;
  }
};

export const getMessages = async (petId: string, userId1: string, userId2: string) => {
  try {
    const response = await authedFetch(`${API_URL}/pets/${petId}/messages?userId1=${userId1}&userId2=${userId2}`);
    if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error('Erro ao buscar mensagens:', error);
    throw error;
  }
};

export const sendMessage = async (petId: string, senderId: string, receiverId: string, content?: string, photo_url?: string) => {
  try {
    const response = await authedFetch(`${API_URL}/pets/${petId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senderId, receiverId, content, photo_url }),
    });
    if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    throw error;
  }
};

export const updateUserProfile = async (
  userId: string,
  patch: {
    full_name?: string;
    name?: string; // alias compat
    bio?: string;
    photo_url?: string;
    cpf?: string;
    phone?: string;
    pix_key?: string;
  }
) => {
  try {
    const response = await authedFetch(`${API_URL}/pets/user/${userId}/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error('Erro ao atualizar perfil:', error);
    throw error;
  }
};

// ============================================================================
// PREMIUM
// ============================================================================
export interface PremiumStatus {
  isPremium: boolean;
  expiresAt: string | null;
  plan: 'monthly' | 'lifetime' | null;
  aiSearchesLeft: number | null;
  aiSearchesUsed: number;
  aiSearchesLimit: number;
  premiumSettings: {
    rewardMinAmount: number;
    rewardMaxAmount: number | null;
    alertEnabled: boolean;
    highlightOnMap: boolean;
  };
}

export const getPremiumStatus = async (userId: string): Promise<PremiumStatus> => {
  const response = await authedFetch(`${API_URL}/user/${userId}/premium/status`);
  if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
  return response.json();
};

export const subscribePremium = async (userId: string, planType: 'monthly' | 'lifetime') => {
  const response = await authedFetch(`${API_URL}/user/${userId}/premium/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planType }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || `Erro HTTP: ${response.status}`);
  }
  return response.json();
};

export const useAiSearchApi = async (userId: string): Promise<{ allowed: boolean; aiSearchesLeft: number | null; isPremium: boolean; error?: string }> => {
  const response = await authedFetch(`${API_URL}/user/${userId}/ai-search/use`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await response.json();
  return data;
};

export const updatePremiumSettings = async (
  userId: string,
  settings: {
    rewardMinAmount?: number;
    rewardMaxAmount?: number | null;
    alertEnabled?: boolean;
    highlightOnMap?: boolean;
  }
) => {
  const response = await authedFetch(`${API_URL}/user/${userId}/premium/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
  return response.json();
};

export const reportUser = async (params: {
  reporterId: string;
  reportedId: string;
  chatId?: string;
  petId?: string;
  reason: string;
}) => {
  const response = await authedFetch(`${API_URL}/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Erro HTTP: ${response.status}`);
  }
  return response.json();
};

export const rateUser = async (params: {
  petId: string;
  raterId: string;
  ratedId: string;
  score: number;
  comment?: string;
}) => {
  const response = await authedFetch(`${API_URL}/ratings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Erro HTTP: ${response.status}`);
  }
  return response.json();
};

export const getNotifications = async (userId: string) => {
  try {
    const response = await authedFetch(`${API_URL}/pets/user/${userId}/notifications`);
    if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error('Erro ao buscar notificações:', error);
    throw error;
  }
};

export const markNotificationsRead = async (userId: string) => {
  try {
    const response = await authedFetch(`${API_URL}/pets/user/${userId}/notifications/read`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error('Erro ao marcar notificações:', error);
    throw error;
  }
};

// ============================================================================
// SUPPORT — chat de suporte com IA + tickets
// ============================================================================

export interface SupportMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'support';
  content: string;
  created_at: string;
}

export interface SupportConversation {
  id: string;
  status: 'open' | 'ticket_created' | 'resolved';
}

export async function getSupportConversation(userId: string): Promise<{
  conversation: SupportConversation;
  messages: SupportMessage[];
}> {
  const res = await authedFetch(`${API_URL}/support/conversation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error('Erro ao carregar conversa de suporte');
  return res.json();
}

// Retorna a resposta da IA, ou null quando a conversa tem um ticket aberto
// (nesse caso a mensagem fica salva para a equipe humana responder).
export async function sendSupportMessage(
  userId: string,
  conversationId: string,
  message: string
): Promise<SupportMessage | null> {
  const res = await authedFetch(`${API_URL}/support/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, conversationId, message }),
  });
  if (!res.ok) throw new Error('Erro ao enviar mensagem');
  const data = await res.json();
  return data.message ?? null;
}

export async function createSupportTicket(
  userId: string,
  conversationId: string | null,
  subject: string,
  description: string
): Promise<{ id: string; subject: string; status: string }> {
  const res = await authedFetch(`${API_URL}/support/ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, conversationId, subject, description }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? 'Erro ao criar ticket');
  }
  const data = await res.json();
  return data.ticket;
}

export type SupportTicketStatus = 'pending' | 'in_progress' | 'resolved' | 'closed';

export interface SupportTicket {
  id: string;
  subject: string;
  description: string | null;
  status: SupportTicketStatus;
  admin_notes: string | null;
  conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

// Lista os tickets de suporte do usuário (mais recentes primeiro).
export async function listUserTickets(userId: string): Promise<SupportTicket[]> {
  const res = await authedFetch(`${API_URL}/support/user/${userId}/tickets`);
  if (!res.ok) throw new Error('Erro ao carregar seus chamados');
  return res.json();
}

// Detalhe de um ticket + thread completa da conversa.
export async function getTicketDetail(
  ticketId: string,
  userId: string,
): Promise<{ ticket: SupportTicket; messages: SupportMessage[] }> {
  const res = await authedFetch(`${API_URL}/support/tickets/${ticketId}?userId=${userId}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? 'Erro ao carregar o chamado');
  }
  return res.json();
}

