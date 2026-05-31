const API_URL = import.meta.env.VITE_API_URL as string;

// Token de acesso atual — definido pelo AuthContext a cada mudança de sessão.
// Lemos daqui em vez de chamar supabase.auth.getSession() dentro do fetch:
// chamar supabase.auth.* dentro do callback onAuthStateChange causa deadlock.
let accessToken: string | null = null;
export function setAccessToken(token: string | null) {
  accessToken = token;
}

// Chamada autenticada ao backend Express: anexa o JWT do Supabase.
// É assim que o painel "aponta" para o backend existente — só via HTTP.
async function authFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Erro HTTP ${res.status}`);
  }
  return res.json();
}

export interface AdminProfile {
  id: string;
  full_name: string | null;
  photo_url: string | null;
  email?: string;
  is_admin: boolean;
}

export interface AdminOverview {
  users: number;
  activeUsers24h: number;
  premiumActive: number;
  premiumLifetime: number;
  activeCases: number;
  resolvedThisMonth: number;
  activeDonations: number;
  adoptionsThisMonth: number;
  sightingsPending: number;
  openReports: number;
  activeRewardsTotal: number;
  openTickets: number | null;
  revenueMonth: number;
}

export interface FinanceSummary {
  feeRevenueTotal: number;
  premiumRevenueTotal: number;
  escrowHeld: number;
  paidToFinders: number;
  refundedToTutors: number;
  walletsTotal: number;
  withdrawPending: { count: number; total: number };
  withdrawCompleted: { count: number; total: number };
}

export interface LedgerRow {
  id: string;
  movement: string;
  amount: number;
  fee: number | null;
  status: string;
  description: string | null;
  created_at: string;
  user: { id: string; full_name: string | null; photo_url: string | null } | null;
  pet: { id: string; name: string } | null;
}

export interface LedgerPage {
  rows: LedgerRow[];
  total: number;
}

export interface LedgerFilters {
  group: 'rewards' | 'fees' | 'premium';
  movement?: string;
  status?: string;
  from?: string;
  to?: string;
  petId?: string;
  user?: string;
  limit?: number;
  offset?: number;
}

export interface Withdrawal {
  id: string;
  amount: number;
  status: string;
  description: string | null;
  external_id: string | null;
  created_at: string;
  user: {
    id: string;
    full_name: string | null;
    pix_key: string | null;
    wallet_balance: number;
  } | null;
}

export interface AppSettings {
  feeRate: number;
  matchThreshold?: number; // 0-1 (reconhecimento facial)
  matchRadiusM?: number;   // raio de busca em metros
}

export interface AdminUserRow {
  id: string;
  full_name: string | null;
  email: string | null;
  cpf: string | null;
  phone: string | null;
  photo_url: string | null;
  status: string;
  is_premium: boolean;
  is_admin: boolean;
  rescues_count: number;
  rating: number;
  wallet_balance: number;
  created_at: string;
}

export interface AdminUsersPage {
  rows: AdminUserRow[];
  total: number;
}

export interface AdminUsersFilters {
  q?: string;
  status?: string;
  premium?: string;
  admin?: string;
  limit?: number;
  offset?: number;
}

export interface UserDetail {
  profile: {
    id: string;
    full_name: string | null;
    email: string | null;
    cpf: string | null;
    phone: string | null;
    photo_url: string | null;
    bio: string | null;
    pix_key: string | null;
    rating: number;
    rescues_count: number;
    wallet_balance: number;
    is_premium: boolean;
    premium_expires_at: string | null;
    is_admin: boolean;
    status: string;
    status_reason: string | null;
    status_changed_at: string | null;
    created_at: string;
  };
  petsAsTutor: { id: string; name: string; status: string; created_at: string }[];
  casesAsFinder: {
    chatId: string;
    status: string;
    found: boolean | null;
    created_at: string;
    pet: { id: string; name: string; status: string } | null;
    tutorName: string | null;
  }[];
  transactions: {
    id: string;
    type: string;
    amount: number;
    fee_amount: number | null;
    status: string;
    description: string | null;
    created_at: string;
    pet: { id: string; name: string } | null;
  }[];
  premium: {
    id: string;
    plan_type: string;
    amount: number;
    status: string;
    starts_at: string;
    expires_at: string | null;
  }[];
  ratingsReceived: { id: string; score: number; comment: string | null; created_at: string }[];
}

export interface AdminTicketRow {
  id: string;
  subject: string;
  description: string | null;
  status: string;
  priority: string;
  category: string | null;
  created_at: string;
  updated_at: string;
  user: { id: string; full_name: string | null };
}

export interface AdminTicketsPage {
  rows: AdminTicketRow[];
  total: number;
}

export interface AdminTicketsFilters {
  status?: string;
  priority?: string;
  category?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface TicketMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

export interface TicketDetail {
  ticket: {
    id: string;
    conversation_id: string | null;
    user_id: string;
    subject: string;
    description: string | null;
    status: string;
    priority: string;
    category: string | null;
    admin_notes: string | null;
    created_at: string;
    updated_at: string;
  };
  user: {
    id: string;
    full_name: string | null;
    photo_url: string | null;
    phone: string | null;
    status: string;
    email: string | null;
  } | null;
  messages: TicketMessage[];
}

export interface TicketPatch {
  status?: string;
  priority?: string;
  category?: string | null;
  admin_notes?: string | null;
}

export interface SubscriptionsSummary {
  activeTotal: number;
  activeMonthly: number;
  activeLifetime: number;
  mrr: number;
  revenueTotal: number;
  expiringSoon: number;
  cancelled: number;
}

export interface SubscriptionRow {
  id: string;
  plan_type: string;
  amount: number;
  payment_method: string | null;
  status: string;
  starts_at: string;
  expires_at: string | null;
  created_at: string;
  user: { id: string; full_name: string | null };
}

export interface SubscriptionsPage {
  rows: SubscriptionRow[];
  total: number;
}

export interface SubscriptionsFilters {
  status?: string;
  plan?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface CasoRow {
  id: string;
  name: string;
  breed: string | null;
  color: string | null;
  size: string | null;
  species: string | null;
  type: string;
  sex: string | null;
  age_group: string | null;
  status: string;
  main_photo_url: string | null;
  lost_date: string | null;
  created_at: string;
  tutor: { id: string; full_name: string | null };
}

export interface CasosPage {
  rows: CasoRow[];
  total: number;
}

export interface CasosFilters {
  type?: string;
  species?: string;
  status?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface CasoDetail {
  pet: {
    id: string;
    name: string;
    breed: string | null;
    color: string | null;
    size: string | null;
    species: string | null;
    type: string;
    sex: string | null;
    age_group: string | null;
    status: string;
    description: string | null;
    extra_info: string | null;
    main_photo_url: string | null;
    latitude: number;
    longitude: number;
    lost_date: string | null;
    allow_contact: boolean | null;
    is_with_finder: boolean | null;
    adoption_rules: string | null;
    consent_responsibility: boolean | null;
    consent_searched_owner: boolean | null;
    adopter_user_id: string | null;
    created_at: string;
    updated_at: string;
    user_id: string;
  };
  tutor: {
    id: string;
    full_name: string | null;
    photo_url: string | null;
    phone: string | null;
    status: string;
    email: string | null;
  } | null;
  adopter: {
    id: string;
    full_name: string | null;
    photo_url: string | null;
    phone: string | null;
    status: string;
    is_admin: boolean;
    email: string | null;
  } | null;
  photos: { id: string; photo_url: string; position: number }[];
  rewards: {
    id: string;
    amount: number;
    fee_amount: number;
    status: string;
    finder_user_id: string | null;
    paid_at: string | null;
    refunded_at: string | null;
    created_at: string;
  }[];
  chats: {
    id: string;
    status: string;
    found: boolean | null;
    finder_id: string;
    finderName: string | null;
    created_at: string;
    closed_at: string | null;
  }[];
  sightings: {
    id: string;
    finder_id: string;
    finderName: string | null;
    latitude: number;
    longitude: number;
    photo_url: string | null;
    message: string | null;
    ai_match_score: number | null;
    confirmed_by_tutor: boolean | null;
    created_at: string;
  }[];
}

export interface DoacaoRow {
  id: string;
  name: string;
  breed: string | null;
  color: string | null;
  size: string | null;
  species: string | null;
  sex: string | null;
  age_group: string | null;
  status: string;
  main_photo_url: string | null;
  created_at: string;
  tutor: { id: string; full_name: string | null };
  adopter: { id: string; full_name: string | null } | null;
}

export interface DoacoesPage {
  rows: DoacaoRow[];
  total: number;
}

export interface DoacoesFilters {
  status?: string;
  species?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface SightingRow {
  id: string;
  latitude: number;
  longitude: number;
  photo_url: string | null;
  message: string | null;
  ai_match_score: number | null;
  confirmed_by_tutor: boolean | null;
  created_at: string;
  pet: { id: string; name: string | null; main_photo_url: string | null } | null;
  finder: { id: string; full_name: string | null };
}

export interface SightingsPage {
  rows: SightingRow[];
  total: number;
}

export interface SightingsFilters {
  q?: string;
  confirmed?: 'yes' | 'no' | 'pending';
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface ReportRow {
  id: string;
  reason: string;
  status: string;
  created_at: string;
  chat_id: string | null;
  reporter: { id: string; full_name: string | null };
  reported: { id: string; full_name: string | null };
  pet: { id: string; name: string | null } | null;
}

export interface ReportsPage {
  rows: ReportRow[];
  total: number;
}

export interface ReportsFilters {
  status?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface ReportProfile {
  id: string;
  full_name: string | null;
  photo_url: string | null;
  phone: string | null;
  status: string;
  is_admin: boolean;
  email: string | null;
}

export interface ReportDetail {
  report: {
    id: string;
    reporter_id: string;
    reported_id: string;
    chat_id: string | null;
    pet_id: string | null;
    reason: string;
    status: string;
    admin_notes: string | null;
    created_at: string;
  };
  reporter: ReportProfile | null;
  reported: ReportProfile | null;
  pet: {
    id: string;
    name: string;
    type: string;
    status: string;
    main_photo_url: string | null;
    user_id: string;
  } | null;
  messages: {
    id: string;
    sender_id: string;
    content: string | null;
    photo_url: string | null;
    created_at: string;
  }[];
}

export interface ReportPatch {
  status?: string;
  admin_notes?: string | null;
}

export const api = {
  // Verifica sessão + papel de admin. Lança erro 403 se não for admin.
  me: (): Promise<AdminProfile> => authFetch('/admin/me'),

  // Métricas resumidas do dashboard.
  overview: (): Promise<AdminOverview> => authFetch('/admin/overview'),

  // Financeiro — resumo consolidado.
  financeSummary: (): Promise<FinanceSummary> => authFetch('/admin/finance/summary'),

  // Financeiro — extrato (group: 'rewards' ou 'revenue') com filtros.
  financeLedger: (filters: LedgerFilters): Promise<LedgerPage> => {
    const qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    });
    return authFetch('/admin/finance/ledger?' + qs.toString());
  },

  // Financeiro — lista de saques (PIX).
  withdrawals: (status?: string): Promise<Withdrawal[]> =>
    authFetch('/admin/finance/withdrawals' + (status ? `?status=${status}` : '')),

  // Financeiro — marca um saque como pago ou recusado.
  settleWithdrawal: (
    id: string,
    action: 'paid' | 'rejected'
  ): Promise<{ success: boolean }> =>
    authFetch(`/admin/finance/withdrawals/${id}/settle`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),

  // Configurações — lê a taxa administrativa vigente.
  settings: (): Promise<AppSettings> => authFetch('/admin/settings'),

  // Configurações — atualiza taxa e/ou parâmetros de reconhecimento.
  updateSettings: (patch: {
    feeRate?: number;
    matchThreshold?: number;
    matchRadiusM?: number;
  }): Promise<AppSettings> =>
    authFetch('/admin/settings', {
      method: 'POST',
      body: JSON.stringify(patch),
    }),

  // Usuários — lista com filtros.
  users: (filters: AdminUsersFilters = {}): Promise<AdminUsersPage> => {
    const qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    });
    const query = qs.toString();
    return authFetch('/admin/users' + (query ? `?${query}` : ''));
  },

  // Usuários — detalhes (perfil, casos e histórico).
  userDetail: (id: string): Promise<UserDetail> => authFetch(`/admin/users/${id}`),

  // Usuários — bloquear, banir ou reativar.
  setUserStatus: (
    id: string,
    status: 'active' | 'blocked' | 'banned',
    reason?: string
  ): Promise<{ success: boolean; status: string }> =>
    authFetch(`/admin/users/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, reason }),
    }),

  // Chamados — lista com filtros.
  tickets: (filters: AdminTicketsFilters = {}): Promise<AdminTicketsPage> => {
    const qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    });
    const query = qs.toString();
    return authFetch('/admin/tickets' + (query ? `?${query}` : ''));
  },

  // Chamados — detalhe (ticket, usuário e conversa).
  ticketDetail: (id: string): Promise<TicketDetail> => authFetch(`/admin/tickets/${id}`),

  // Chamados — atualiza a triagem (status, prioridade, categoria, notas).
  updateTicket: (id: string, patch: TicketPatch): Promise<TicketDetail['ticket']> =>
    authFetch(`/admin/tickets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  // Chamados — resposta do admin ao usuário.
  replyTicket: (
    id: string,
    message: string
  ): Promise<{ message: TicketMessage; status: string }> =>
    authFetch(`/admin/tickets/${id}/reply`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  // Chamados — sugestão de resposta gerada por IA para o operador revisar.
  suggestTicketReply: (id: string): Promise<{ suggestion: string }> =>
    authFetch(`/admin/tickets/${id}/suggest-reply`, { method: 'POST' }),

  // Assinaturas — resumo (KPIs).
  subscriptionsSummary: (): Promise<SubscriptionsSummary> =>
    authFetch('/admin/subscriptions/summary'),

  // Assinaturas — lista com filtros.
  subscriptions: (filters: SubscriptionsFilters = {}): Promise<SubscriptionsPage> => {
    const qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    });
    const query = qs.toString();
    return authFetch('/admin/subscriptions' + (query ? `?${query}` : ''));
  },

  // Assinaturas — cancela uma assinatura (revoga o premium).
  cancelSubscription: (id: string): Promise<{ success: boolean }> =>
    authFetch(`/admin/subscriptions/${id}/cancel`, { method: 'POST' }),

  // Assinaturas — concede premium a um usuário como cortesia.
  grantPremium: (
    userId: string,
    planType: 'monthly' | 'lifetime'
  ): Promise<{ success: boolean }> =>
    authFetch('/admin/subscriptions/grant', {
      method: 'POST',
      body: JSON.stringify({ userId, planType }),
    }),

  // Casos — lista de pets (perdidos, vistos, resgatados) com filtros.
  casos: (filters: CasosFilters = {}): Promise<CasosPage> => {
    const qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    });
    const query = qs.toString();
    return authFetch('/admin/pets' + (query ? `?${query}` : ''));
  },

  // Casos — detalhe (pet, tutor, fotos, recompensas, chats, avistamentos).
  casoDetail: (id: string): Promise<CasoDetail> => authFetch(`/admin/pets/${id}`),

  // Casos — altera o status (ativo/pausado/encontrado/cancelado).
  setCasoStatus: (id: string, status: string): Promise<CasoDetail['pet']> =>
    authFetch(`/admin/pets/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  // Avistamentos — lista com filtros.
  sightings: (filters: SightingsFilters = {}): Promise<SightingsPage> => {
    const qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    });
    const query = qs.toString();
    return authFetch('/admin/sightings' + (query ? `?${query}` : ''));
  },

  // Avistamentos — exclui (spam, abuso, duplicidade).
  deleteSighting: (id: string): Promise<{ success: boolean }> =>
    authFetch(`/admin/sightings/${id}`, { method: 'DELETE' }),

  // Doações — lista de pets em adoção (type='donation').
  donations: (filters: DoacoesFilters = {}): Promise<DoacoesPage> => {
    const qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    });
    const query = qs.toString();
    return authFetch('/admin/donations' + (query ? `?${query}` : ''));
  },

  // Denúncias — lista com filtros.
  reports: (filters: ReportsFilters = {}): Promise<ReportsPage> => {
    const qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    });
    const query = qs.toString();
    return authFetch('/admin/reports' + (query ? `?${query}` : ''));
  },

  // Denúncias — detalhe (denunciante, denunciado, caso ligado, mensagens do chat).
  reportDetail: (id: string): Promise<ReportDetail> => authFetch(`/admin/reports/${id}`),

  // Denúncias — atualiza status e/ou notas internas.
  updateReport: (id: string, patch: ReportPatch): Promise<ReportDetail['report']> =>
    authFetch(`/admin/reports/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
};
