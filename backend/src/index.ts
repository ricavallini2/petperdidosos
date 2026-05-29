import './env.js';
import Anthropic from '@anthropic-ai/sdk';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { supabase } from './supabase.js';
import { haversineMeters } from './distance.js';
import { generateImageEmbedding, isEmbeddingEnabled } from './embedding.js';

const app = express();
app.set('trust proxy', 1); // atrás de proxy/LB — necessário para rate limit por IP

// Cabeçalhos de segurança HTTP
app.use(helmet());

// CORS: libera origens conhecidas (painel admin/web). Requisições sem Origin
// (app mobile nativo, curl) são permitidas — a segurança da API é o JWT, não o
// CORS. Defina ALLOWED_ORIGINS (separado por vírgula) em produção; vazio = libera.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Origem não permitida pelo CORS'));
    },
  })
);

app.use(express.json({ limit: '10mb' }));

// Rate limiting: limite geral por IP + limite estrito para endpoints caros
// (IA: match, suporte, criação de alerta com embedding, backfill).
// Limite geral por IP. Janela de 1 min e teto alto porque o app faz polling
// legítimo (chat a cada 3s busca mensagens + lista de chats). É um guarda
// anti-abuso amplo — a proteção forte fica no aiLimiter dos endpoints caros.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em alguns minutos.' },
});
app.use(generalLimiter);

const PORT = Number(process.env.PORT ?? 3005);
const APP_FEE_RATE = 0.10; // taxa padrão (fallback) — a vigente fica em app_settings

// Nº de denúncias que pausa um alerta e o envia para análise do admin.
// TODO: tornar configurável pelo painel administrativo (app_settings).
const REPORTS_TO_PAUSE = 3;

// Similaridade mínima (0-1) para um pet aparecer no reconhecimento por IA.
// Abaixo disso o match é improvável (ex.: foto de gato x cachorro) e é descartado.
const MATCH_MIN_SIMILARITY = 0.70;

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// Lê a taxa administrativa configurada em app_settings; cai no fallback se
// estiver indisponível ou inválida.
async function getFeeRate(): Promise<number> {
  const { data } = await supabase
    .from('app_settings')
    .select('fee_rate')
    .eq('id', 1)
    .maybeSingle();
  const rate = Number(data?.fee_rate);
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : APP_FEE_RATE;
}

// Config global do reconhecimento por foto (limiar de similaridade + raio de busca).
async function getMatchConfig(): Promise<{ threshold: number; radiusM: number }> {
  const { data } = await supabase
    .from('app_settings')
    .select('match_threshold, match_radius_m')
    .eq('id', 1)
    .maybeSingle();
  const t = Number(data?.match_threshold);
  const r = Number(data?.match_radius_m);
  return {
    threshold: Number.isFinite(t) && t >= 0 && t <= 1 ? t : 0.80,
    radiusM: Number.isFinite(r) && r >= 100 ? r : 10000,
  };
}

// ============================================================================
// HEALTH
// ============================================================================
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Configuração pública lida pelo app para o cálculo da taxa
app.get(
  '/config/fee-rate',
  asyncHandler(async (_req, res) => {
    res.json({ feeRate: await getFeeRate() });
  })
);

// ============================================================================
// AUTH — autenticação de usuário comum (app mobile)
// O app envia o JWT do Supabase no header Authorization. A identidade SEMPRE
// é derivada do token (req.user.id) — nunca confie no userId do path/body.
// ============================================================================
type AuthedRequest = Request & { user?: { id: string; email?: string } };

const requireUser = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token de autenticação ausente' });

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Sessão inválida' });

  (req as AuthedRequest).user = { id: userData.user.id, email: userData.user.email };
  next();
});

// Helper: id autenticado da requisição (após requireUser).
const authedId = (req: Request): string => (req as AuthedRequest).user!.id;

// Privacidade da foto: zera o photo_url de quem desativou "mostrar minha foto"
// e remove o flag do objeto retornado a terceiros (o app exibe imagem padrão).
function gateProfilePhoto(p: any): any {
  if (!p) return p;
  if (p.show_profile_photo === false) p.photo_url = null;
  delete p.show_profile_photo;
  return p;
}

// ============================================================================
// ADMIN — painel administrativo (acesso restrito a is_admin)
// O painel web envia o JWT do Supabase no header Authorization.
// ============================================================================
const requireAdmin = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token de autenticação ausente' });

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Sessão inválida' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, photo_url, is_admin')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (!profile?.is_admin) {
    return res.status(403).json({ error: 'Acesso restrito a administradores' });
  }

  (req as Request & { admin?: unknown }).admin = { ...profile, email: userData.user.email };
  next();
});

// Confirma sessão + papel de admin (o painel chama isto no login)
app.get('/admin/me', requireAdmin, (req, res) => {
  res.json((req as Request & { admin?: unknown }).admin);
});

// Métricas resumidas para o dashboard do painel
app.get(
  '/admin/overview',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    ).toISOString();

    // Total de usuários cadastrados
    const { count: users } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true });

    // Chamados abertos (pendentes ou em andamento)
    const { count: openTickets } = await supabase
      .from('support_tickets')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'in_progress']);

    // Usuários ativos nas últimas 24h: distintos que enviaram mensagem,
    // registraram avistamento ou cadastraram um pet.
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [{ data: msgUsers }, { data: sightingUsers }, { data: petUsers }] =
      await Promise.all([
        supabase.from('messages').select('sender_id').gte('created_at', since24h),
        supabase.from('sightings').select('finder_id').gte('created_at', since24h),
        supabase.from('pets').select('user_id').gte('created_at', since24h),
      ]);
    const activeSet = new Set<string>();
    (msgUsers ?? []).forEach((m) => activeSet.add(m.sender_id));
    (sightingUsers ?? []).forEach((s) => activeSet.add(s.finder_id));
    (petUsers ?? []).forEach((p) => activeSet.add(p.user_id));
    const activeUsers24h = activeSet.size;

    // Assinantes premium ativos: vitalício (sem expiração) ou mensal não vencido
    const { data: premiumRows } = await supabase
      .from('profiles')
      .select('premium_expires_at')
      .eq('is_premium', true);
    const premiumActive = (premiumRows ?? []).filter(
      (p) => !p.premium_expires_at || new Date(p.premium_expires_at) > now
    ).length;
    // Premium vitalício = assinante ativo sem data de expiração
    const premiumLifetime = (premiumRows ?? []).filter(
      (p) => !p.premium_expires_at
    ).length;

    // Receita do mês = taxa do app (10%) sobre recompensas resolvidas no mês +
    // assinaturas premium iniciadas no mês. O app retém a taxa tanto em
    // resgates pagos quanto em cancelamentos (reembolso = valor - taxa).
    const { data: paidRewards } = await supabase
      .from('rewards')
      .select('fee_amount')
      .eq('status', 'paid')
      .gte('paid_at', monthStart);
    const { data: refundedRewards } = await supabase
      .from('rewards')
      .select('fee_amount')
      .eq('status', 'refunded')
      .gte('refunded_at', monthStart);
    const feeRevenue = [...(paidRewards ?? []), ...(refundedRewards ?? [])].reduce(
      (sum, r) => sum + Number(r.fee_amount),
      0
    );

    const { data: subRows } = await supabase
      .from('premium_subscriptions')
      .select('amount')
      .eq('status', 'active')
      .gte('starts_at', monthStart);
    const subRevenue = (subRows ?? []).reduce(
      (sum, s) => sum + Number(s.amount),
      0
    );

    // Valor total em recompensas ativas (ainda não resolvidas)
    const { data: activeRewards } = await supabase
      .from('rewards')
      .select('amount')
      .in('status', ['pending', 'locked']);
    const activeRewardsTotal = (activeRewards ?? []).reduce(
      (sum, r) => sum + Number(r.amount),
      0
    );

    res.json({
      users: users ?? 0,
      activeUsers24h,
      premiumActive,
      premiumLifetime,
      activeRewardsTotal: Number(activeRewardsTotal.toFixed(2)),
      openTickets: openTickets ?? 0,
      revenueMonth: Number((feeRevenue + subRevenue).toFixed(2)),
    });
  })
);

// ----------------------------------------------------------------------------
// Financeiro — resumo, extrato e controle de saques
// ----------------------------------------------------------------------------
const round2 = (n: number) => Number(n.toFixed(2));
const sumField = (rows: { [k: string]: unknown }[] | null, key: string) =>
  (rows ?? []).reduce((s, r) => s + Number(r[key] ?? 0), 0);

// Resumo financeiro consolidado (KPIs)
app.get(
  '/admin/finance/summary',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const [
      feeHolds,
      premiumSubs,
      activeRewards,
      rewardReceived,
      refunds,
      wallets,
      withdrawPending,
      withdrawDone,
    ] = await Promise.all([
      // A taxa do app é cobrada no escrow (oferta/aumento) — fica em fee_amount.
      supabase.from('transactions').select('fee_amount').eq('type', 'escrow_hold').neq('status', 'failed'),
      supabase.from('premium_subscriptions').select('amount').eq('status', 'active'),
      supabase.from('rewards').select('amount').in('status', ['pending', 'locked']),
      supabase.from('transactions').select('amount').eq('type', 'reward_received').eq('status', 'completed'),
      supabase.from('transactions').select('amount').eq('type', 'refund').eq('status', 'completed'),
      supabase.from('profiles').select('wallet_balance'),
      supabase.from('transactions').select('amount').eq('type', 'withdraw').eq('status', 'pending'),
      supabase.from('transactions').select('amount').eq('type', 'withdraw').eq('status', 'completed'),
    ]);

    // Em garantia = soma das recompensas ativas, sem a taxa do app.
    const escrowHeld = (activeRewards.data ?? []).reduce(
      (s, r) => s + Number(r.amount),
      0
    );
    const withdrawPendingTotal = (withdrawPending.data ?? []).reduce(
      (s, t) => s + Math.abs(Number(t.amount)),
      0
    );
    const withdrawDoneTotal = (withdrawDone.data ?? []).reduce(
      (s, t) => s + Math.abs(Number(t.amount)),
      0
    );

    res.json({
      feeRevenueTotal: round2(sumField(feeHolds.data, 'fee_amount')),
      premiumRevenueTotal: round2(sumField(premiumSubs.data, 'amount')),
      escrowHeld: round2(escrowHeld),
      paidToFinders: round2(sumField(rewardReceived.data, 'amount')),
      refundedToTutors: round2(sumField(refunds.data, 'amount')),
      walletsTotal: round2(sumField(wallets.data, 'wallet_balance')),
      withdrawPending: {
        count: withdrawPending.data?.length ?? 0,
        total: round2(withdrawPendingTotal),
      },
      withdrawCompleted: {
        count: withdrawDone.data?.length ?? 0,
        total: round2(withdrawDoneTotal),
      },
    });
  })
);

// Extrato financeiro. group=rewards → recompensas e saques; group=revenue →
// taxas do app e assinaturas premium. Cada linha vem com o caso (pet) ligado.
const ledgerOne = (v: unknown) =>
  (Array.isArray(v) ? v[0] : v) as Record<string, unknown> | null;
const ledgerUser = (u: Record<string, unknown> | null) =>
  u ? { id: u.id, full_name: u.full_name, photo_url: u.photo_url ?? null } : null;
const ledgerPet = (p: Record<string, unknown> | null) =>
  p ? { id: p.id, name: p.name } : null;

app.get(
  '/admin/finance/ledger',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const groupParam = req.query.group;
    const group =
      groupParam === 'fees' || groupParam === 'premium' ? groupParam : 'rewards';
    const from = str(req.query.from);
    const toRaw = str(req.query.to);
    const to = toRaw ? (toRaw.length === 10 ? `${toRaw}T23:59:59.999Z` : toRaw) : null;
    const userTerm = str(req.query.user);
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    // Filtro por nome de usuário → resolve para uma lista de ids
    let userIds: string[] | null = null;
    if (userTerm) {
      const { data: matches } = await supabase
        .from('profiles')
        .select('id')
        .ilike('full_name', `%${userTerm}%`);
      userIds = (matches ?? []).map((m) => m.id);
      if (userIds.length === 0) return res.json({ rows: [], total: 0 });
    }

    const byDateDesc = (a: { created_at: string }, b: { created_at: string }) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime();

    if (group === 'fees') {
      // A taxa do app é cobrada no escrow (oferta/aumento) e fica em fee_amount;
      // cada escrow_hold com taxa vira um lançamento "Taxa do app".
      let feeQuery = supabase
        .from('transactions')
        .select(
          'id, fee_amount, description, created_at, user:profiles(id, full_name, photo_url), pet:pets(id, name)'
        )
        .eq('type', 'escrow_hold')
        .neq('status', 'failed')
        .gt('fee_amount', 0);
      if (from) feeQuery = feeQuery.gte('created_at', from);
      if (to) feeQuery = feeQuery.lte('created_at', to);
      if (userIds) feeQuery = feeQuery.in('user_id', userIds);

      const feeRes = await feeQuery;
      if (feeRes.error) throw feeRes.error;

      const rows = ((feeRes.data ?? []) as Record<string, unknown>[]).map((t) => {
        const desc = (t.description as string) ?? '';
        const origem = desc.startsWith('Recompensa ofertada')
          ? 'recompensa ofertada'
          : 'aumento de recompensa';
        return {
          id: `fee:${t.id}`,
          movement: 'app_fee',
          amount: Number(t.fee_amount),
          fee: null as number | null,
          status: 'completed',
          description: `Taxa sobre ${origem}`,
          created_at: t.created_at as string,
          user: ledgerUser(ledgerOne(t.user)),
          pet: ledgerPet(ledgerOne(t.pet)),
        };
      });
      rows.sort(byDateDesc);
      return res.json({ rows: rows.slice(offset, offset + limit), total: rows.length });
    }

    if (group === 'premium') {
      let subQuery = supabase
        .from('premium_subscriptions')
        .select('id, user_id, amount, plan_type, status, starts_at');
      if (from) subQuery = subQuery.gte('starts_at', from);
      if (to) subQuery = subQuery.lte('starts_at', to);
      if (userIds) subQuery = subQuery.in('user_id', userIds);

      const subRes = await subQuery;
      if (subRes.error) throw subRes.error;

      // Resolve os usuários das assinaturas numa consulta separada
      const subData = (subRes.data ?? []) as Record<string, unknown>[];
      const subUserIds = [...new Set(subData.map((s) => s.user_id as string))];
      const { data: subProfiles } = subUserIds.length
        ? await supabase
            .from('profiles')
            .select('id, full_name, photo_url')
            .in('id', subUserIds)
        : { data: [] as Record<string, unknown>[] };
      const profMap = new Map((subProfiles ?? []).map((p) => [p.id as string, p]));

      const rows = subData.map((s) => ({
        id: `sub:${s.id}`,
        movement: 'premium',
        amount: Number(s.amount),
        fee: null as number | null,
        status: s.status === 'active' ? 'completed' : (s.status as string),
        description:
          s.plan_type === 'lifetime'
            ? 'Assinatura premium vitalícia'
            : 'Assinatura premium mensal',
        created_at: s.starts_at as string,
        user: ledgerUser(profMap.get(s.user_id as string) ?? null),
        pet: null,
      }));
      rows.sort(byDateDesc);
      return res.json({ rows: rows.slice(offset, offset + limit), total: rows.length });
    }

    // group === 'rewards': recompensa ofertada, aumento, transferida, saque, estorno
    const status = str(req.query.status);
    const petId = str(req.query.petId);
    const movement = str(req.query.movement);

    let query = supabase
      .from('transactions')
      .select(
        'id, type, amount, fee_amount, status, description, reward_id, created_at, user:profiles(id, full_name, photo_url), pet:pets(id, name)',
        { count: 'exact' }
      )
      .in('type', ['escrow_hold', 'reward_received', 'withdraw', 'refund'])
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);
    if (petId) query = query.eq('pet_id', petId);
    if (userIds) query = query.in('user_id', userIds);

    if (movement === 'reward_offered') {
      query = query.eq('type', 'escrow_hold').ilike('description', 'Recompensa ofertada%');
    } else if (movement === 'reward_increase') {
      query = query.eq('type', 'escrow_hold').ilike('description', 'Aumento%');
    } else if (movement === 'reward_transferred') {
      query = query.eq('type', 'reward_received');
    } else if (movement === 'withdraw') {
      query = query.eq('type', 'withdraw');
    } else if (movement === 'reward_refund') {
      query = query.eq('type', 'refund');
    }

    const { data, count, error } = await query;
    if (error) throw error;

    const rows = ((data ?? []) as Record<string, unknown>[]).map((t) => {
      const type = t.type as string;
      const rawAmount = Number(t.amount);
      const feeAmount = t.fee_amount != null ? Number(t.fee_amount) : 0;
      let movementKey: string;
      let amount: number;
      let fee: number | null = null;
      if (type === 'escrow_hold') {
        const desc = (t.description as string) ?? '';
        movementKey = desc.startsWith('Recompensa ofertada')
          ? 'reward_offered'
          : 'reward_increase';
        amount = Math.round((Math.abs(rawAmount) - feeAmount) * 100) / 100;
        fee = feeAmount;
      } else if (type === 'reward_received') {
        movementKey = 'reward_transferred';
        amount = Math.abs(rawAmount);
      } else if (type === 'withdraw') {
        movementKey = 'withdraw';
        amount = Math.abs(rawAmount);
      } else {
        movementKey = 'reward_refund';
        amount = Math.abs(rawAmount);
      }
      return {
        id: t.id as string,
        movement: movementKey,
        amount,
        fee,
        status: t.status,
        description: t.description,
        created_at: t.created_at,
        user: ledgerUser(ledgerOne(t.user)),
        pet: ledgerPet(ledgerOne(t.pet)),
      };
    });
    res.json({ rows, total: count ?? 0 });
  })
);

// Lista de saques (PIX) — inclui dados necessários ao controle
app.get(
  '/admin/finance/withdrawals',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    let query = supabase
      .from('transactions')
      .select(
        'id, amount, status, description, external_id, created_at, user:profiles(id, full_name, pix_key, wallet_balance)'
      )
      .eq('type', 'withdraw')
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    const rows = ((data ?? []) as Record<string, unknown>[]).map((w) => {
      const u = (Array.isArray(w.user) ? w.user[0] : w.user) as Record<string, unknown> | null;
      return {
        id: w.id,
        amount: Number(w.amount),
        status: w.status,
        description: w.description,
        external_id: w.external_id,
        created_at: w.created_at,
        user: u
          ? {
              id: u.id,
              full_name: u.full_name,
              pix_key: u.pix_key,
              wallet_balance: Number(u.wallet_balance),
            }
          : null,
      };
    });
    res.json(rows);
  })
);

// Controle de saque: marcar como pago ou recusar (recusa estorna à carteira)
app.post(
  '/admin/finance/withdrawals/:txId/settle',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { txId } = req.params;
    const { action } = req.body ?? {};
    if (action !== 'paid' && action !== 'rejected') {
      return res.status(400).json({ error: "action deve ser 'paid' ou 'rejected'" });
    }

    const { data: tx } = await supabase
      .from('transactions')
      .select('id, type, amount, status, user_id')
      .eq('id', txId)
      .maybeSingle();

    if (!tx || tx.type !== 'withdraw') {
      return res.status(404).json({ error: 'Saque não encontrado' });
    }
    if (tx.status !== 'pending') {
      return res.status(400).json({ error: `Este saque já foi resolvido (${tx.status})` });
    }

    const value = Math.abs(Number(tx.amount));

    if (action === 'paid') {
      await supabase.from('transactions').update({ status: 'completed' }).eq('id', txId);
      await supabase.from('notifications').insert({
        user_id: tx.user_id,
        title: 'Saque processado',
        body: `Seu saque de R$ ${value.toFixed(2)} foi pago via PIX.`,
        type: 'withdraw',
      });
    } else {
      // Recusado: devolve o valor à carteira (crédito atômico).
      const { error: creditErr } = await supabase
        .rpc('wallet_credit', { p_user_id: tx.user_id, p_amount: value });
      if (creditErr) throw creditErr;
      await supabase.from('transactions').update({ status: 'failed' }).eq('id', txId);
      await supabase.from('notifications').insert({
        user_id: tx.user_id,
        title: 'Saque recusado',
        body: `Seu saque de R$ ${value.toFixed(2)} foi recusado e o valor devolvido à sua carteira.`,
        type: 'withdraw',
      });
    }

    res.json({ success: true });
  })
);

// Configurações do app — taxa administrativa + reconhecimento por foto
app.get(
  '/admin/settings',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const { threshold, radiusM } = await getMatchConfig();
    res.json({ feeRate: await getFeeRate(), matchThreshold: threshold, matchRadiusM: radiusM });
  })
);

app.post(
  '/admin/settings',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (req.body?.feeRate !== undefined) {
      const feeRate = Number(req.body.feeRate);
      if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > 1) {
        return res.status(400).json({ error: 'feeRate deve ser um número entre 0 e 1' });
      }
      patch.fee_rate = feeRate;
    }
    if (req.body?.matchThreshold !== undefined) {
      const t = Number(req.body.matchThreshold);
      if (!Number.isFinite(t) || t < 0 || t > 1) {
        return res.status(400).json({ error: 'matchThreshold deve ser um número entre 0 e 1' });
      }
      patch.match_threshold = t;
    }
    if (req.body?.matchRadiusM !== undefined) {
      const r = Number(req.body.matchRadiusM);
      if (!Number.isInteger(r) || r < 100 || r > 500000) {
        return res.status(400).json({ error: 'matchRadiusM deve ser um inteiro entre 100 e 500000' });
      }
      patch.match_radius_m = r;
    }

    const { error } = await supabase.from('app_settings').update(patch).eq('id', 1);
    if (error) throw error;

    const { threshold, radiusM } = await getMatchConfig();
    res.json({ feeRate: await getFeeRate(), matchThreshold: threshold, matchRadiusM: radiusM });
  })
);

// Config pública do reconhecimento (o app usa para exibir, ex.: o raio).
app.get(
  '/config/match',
  asyncHandler(async (_req, res) => {
    const { threshold, radiusM } = await getMatchConfig();
    res.json({ matchThreshold: threshold, matchRadiusM: radiusM });
  })
);

// ----------------------------------------------------------------------------
// Usuários — listagem, detalhes e moderação (bloquear / banir)
// ----------------------------------------------------------------------------

// Lista de usuários com filtros
app.get(
  '/admin/users',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const q = str(req.query.q);
    const status = str(req.query.status);
    const premium = str(req.query.premium);
    const admin = str(req.query.admin);
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    let pq = supabase
      .from('profiles')
      .select(
        'id, full_name, cpf, phone, photo_url, status, is_premium, is_admin, rescues_count, rating, wallet_balance, created_at'
      )
      .order('created_at', { ascending: false });
    if (status) pq = pq.eq('status', status);
    if (premium === 'true') pq = pq.eq('is_premium', true);
    if (premium === 'false') pq = pq.eq('is_premium', false);
    if (admin === 'true') pq = pq.eq('is_admin', true);
    if (admin === 'false') pq = pq.eq('is_admin', false);

    const { data: profiles, error } = await pq;
    if (error) throw error;

    // E-mails vêm do Supabase Auth (não ficam em profiles)
    const { data: authData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const emailMap = new Map((authData?.users ?? []).map((u) => [u.id, u.email ?? null]));

    let rows = (profiles ?? []).map((p) => ({ ...p, email: emailMap.get(p.id) ?? null }));

    // Busca textual (nome / e-mail / CPF / telefone) aplicada em memória
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter((r) =>
        [r.full_name, r.email, r.cpf, r.phone].some(
          (f) => typeof f === 'string' && f.toLowerCase().includes(needle)
        )
      );
    }

    res.json({ rows: rows.slice(offset, offset + limit), total: rows.length });
  })
);

// Detalhes de um usuário: perfil, casos e histórico
app.get(
  '/admin/users/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!profile) return res.status(404).json({ error: 'Usuário não encontrado' });

    const { data: authUser } = await supabase.auth.admin.getUserById(id);

    const [petsRes, chatsRes, txRes, premiumRes, ratingsRes] = await Promise.all([
      supabase
        .from('pets')
        .select('id, name, status, created_at')
        .eq('user_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('chats')
        .select('id, status, found, created_at, tutor_id, pet:pets(id, name, status)')
        .eq('finder_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('transactions')
        .select('id, type, amount, fee_amount, status, description, created_at, pet:pets(id, name)')
        .eq('user_id', id)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('premium_subscriptions')
        .select('id, plan_type, amount, status, starts_at, expires_at')
        .eq('user_id', id)
        .order('starts_at', { ascending: false }),
      supabase
        .from('ratings')
        .select('id, score, comment, created_at')
        .eq('rated_id', id)
        .order('created_at', { ascending: false }),
    ]);

    const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as Record<string, unknown> | null;

    // Nomes dos tutores dos casos onde o usuário foi buscador
    const chats = (chatsRes.data ?? []) as Record<string, unknown>[];
    const tutorIds = [...new Set(chats.map((c) => c.tutor_id as string))];
    const { data: tutors } = tutorIds.length
      ? await supabase.from('profiles').select('id, full_name').in('id', tutorIds)
      : { data: [] as Record<string, unknown>[] };
    const tutorMap = new Map((tutors ?? []).map((t) => [t.id as string, t.full_name]));

    const casesAsFinder = chats.map((c) => {
      const pet = one(c.pet);
      return {
        chatId: c.id as string,
        status: c.status,
        found: c.found,
        created_at: c.created_at,
        pet: pet ? { id: pet.id, name: pet.name, status: pet.status } : null,
        tutorName: tutorMap.get(c.tutor_id as string) ?? null,
      };
    });

    const transactions = ((txRes.data ?? []) as Record<string, unknown>[]).map((t) => {
      const pet = one(t.pet);
      return {
        id: t.id as string,
        type: t.type,
        amount: Number(t.amount),
        fee_amount: t.fee_amount != null ? Number(t.fee_amount) : null,
        status: t.status,
        description: t.description,
        created_at: t.created_at,
        pet: pet ? { id: pet.id, name: pet.name } : null,
      };
    });

    res.json({
      profile: { ...profile, email: authUser?.user?.email ?? null },
      petsAsTutor: petsRes.data ?? [],
      casesAsFinder,
      transactions,
      premium: premiumRes.data ?? [],
      ratingsReceived: ratingsRes.data ?? [],
    });
  })
);

// Moderação: bloquear, banir ou reativar um usuário
app.post(
  '/admin/users/:id/status',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status, reason } = req.body ?? {};
    if (!['active', 'blocked', 'banned'].includes(status)) {
      return res.status(400).json({ error: "status deve ser 'active', 'blocked' ou 'banned'" });
    }

    const { data: target } = await supabase
      .from('profiles')
      .select('id, is_admin')
      .eq('id', id)
      .maybeSingle();
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (target.is_admin) {
      return res.status(400).json({ error: 'Não é possível alterar o status de um administrador' });
    }

    // Aplica/remove o ban no Supabase Auth — impede o login do usuário
    const banDuration = status === 'active' ? 'none' : '876000h';
    const { error: banErr } = await supabase.auth.admin.updateUserById(id, {
      ban_duration: banDuration,
    });
    if (banErr) throw banErr;

    const { error } = await supabase
      .from('profiles')
      .update({
        status,
        status_reason: status === 'active' ? null : reason ?? null,
        status_changed_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw error;

    res.json({ success: true, status });
  })
);

// ----------------------------------------------------------------------------
// Chamados — tickets de suporte (gestão e resposta pelo painel admin)
// ----------------------------------------------------------------------------
const TICKET_STATUS = ['pending', 'in_progress', 'resolved', 'closed'];
const TICKET_PRIORITY = ['baixa', 'normal', 'alta', 'urgente'];
const TICKET_CATEGORY = ['financeiro', 'conta', 'caso', 'denuncia', 'bug', 'duvida', 'outros'];

// Lista de chamados com filtros
app.get(
  '/admin/tickets',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const status = str(req.query.status);
    const priority = str(req.query.priority);
    const category = str(req.query.category);
    const q = str(req.query.q);
    const from = str(req.query.from);
    const toRaw = str(req.query.to);
    const to = toRaw ? (toRaw.length === 10 ? `${toRaw}T23:59:59.999Z` : toRaw) : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    let query = supabase
      .from('support_tickets')
      .select('id, subject, description, status, priority, category, user_id, created_at, updated_at')
      .order('updated_at', { ascending: false });
    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);
    if (category) query = query.eq('category', category);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data, error } = await query;
    if (error) throw error;

    const tickets = (data ?? []) as Record<string, unknown>[];
    const userIds = [...new Set(tickets.map((t) => t.user_id as string))];
    const { data: profs } = userIds.length
      ? await supabase.from('profiles').select('id, full_name').in('id', userIds)
      : { data: [] as Record<string, unknown>[] };
    const nameMap = new Map((profs ?? []).map((p) => [p.id as string, p.full_name]));

    let rows = tickets.map((t) => ({
      id: t.id,
      subject: t.subject,
      description: t.description,
      status: t.status,
      priority: t.priority,
      category: t.category,
      created_at: t.created_at,
      updated_at: t.updated_at,
      user: { id: t.user_id, full_name: nameMap.get(t.user_id as string) ?? null },
    }));

    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter((r) =>
        [r.subject, r.description, r.user.full_name].some(
          (f) => typeof f === 'string' && f.toLowerCase().includes(needle)
        )
      );
    }

    res.json({ rows: rows.slice(offset, offset + limit), total: rows.length });
  })
);

// Detalhe de um chamado: ticket + usuário + conversa completa
app.get(
  '/admin/tickets/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { data: ticket } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado' });

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, full_name, photo_url, phone, status')
      .eq('id', ticket.user_id)
      .maybeSingle();
    const { data: authUser } = await supabase.auth.admin.getUserById(ticket.user_id);

    let messages: unknown[] = [];
    if (ticket.conversation_id) {
      const { data: msgs } = await supabase
        .from('support_messages')
        .select('id, role, content, created_at')
        .eq('conversation_id', ticket.conversation_id)
        .order('created_at', { ascending: true });
      messages = msgs ?? [];
    }

    res.json({
      ticket,
      user: profile ? { ...profile, email: authUser?.user?.email ?? null } : null,
      messages,
    });
  })
);

// Atualiza triagem do chamado (status, prioridade, categoria, notas internas)
app.patch(
  '/admin/tickets/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = req.body ?? {};
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.status !== undefined) {
      if (!TICKET_STATUS.includes(body.status)) {
        return res.status(400).json({ error: 'status inválido' });
      }
      update.status = body.status;
    }
    if (body.priority !== undefined) {
      if (!TICKET_PRIORITY.includes(body.priority)) {
        return res.status(400).json({ error: 'priority inválida' });
      }
      update.priority = body.priority;
    }
    if (body.category !== undefined) {
      if (body.category !== null && !TICKET_CATEGORY.includes(body.category)) {
        return res.status(400).json({ error: 'category inválida' });
      }
      update.category = body.category;
    }
    if (body.admin_notes !== undefined) {
      update.admin_notes =
        typeof body.admin_notes === 'string' && body.admin_notes.trim()
          ? body.admin_notes.trim()
          : null;
    }

    const { data, error } = await supabase
      .from('support_tickets')
      .update(update)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Chamado não encontrado' });
    res.json(data);
  })
);

// Resposta do admin ao usuário — entra na conversa e gera notificação
app.post(
  '/admin/tickets/:id/reply',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const message =
      typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) return res.status(400).json({ error: 'A mensagem é obrigatória' });

    const { data: ticket } = await supabase
      .from('support_tickets')
      .select('id, conversation_id, user_id, status')
      .eq('id', id)
      .maybeSingle();
    if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado' });
    if (!ticket.conversation_id) {
      return res.status(400).json({ error: 'Este chamado não tem uma conversa vinculada' });
    }

    const { data: msg, error } = await supabase
      .from('support_messages')
      .insert({
        conversation_id: ticket.conversation_id,
        role: 'support',
        content: message,
      })
      .select('id, role, content, created_at')
      .single();
    if (error) throw error;

    // Notifica o usuário pela tabela de notificações do app
    await supabase.from('notifications').insert({
      user_id: ticket.user_id,
      title: 'Suporte respondeu seu chamado',
      body: message.length > 120 ? `${message.slice(0, 117)}…` : message,
      type: 'support',
      ticket_id: ticket.id,
    });

    // Chamado pendente passa a "em andamento" quando o admin responde
    const newStatus = ticket.status === 'pending' ? 'in_progress' : ticket.status;
    await supabase
      .from('support_tickets')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', id);

    res.json({ message: msg, status: newStatus });
  })
);

// ----------------------------------------------------------------------------
// Assinaturas — gestão dos planos premium pelo painel admin
// ----------------------------------------------------------------------------
const subIsActive = (s: { status?: unknown; expires_at?: unknown }) =>
  s.status === 'active' &&
  (!s.expires_at || new Date(s.expires_at as string).getTime() > Date.now());

// Resumo (KPIs) das assinaturas premium
app.get(
  '/admin/subscriptions/summary',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const { data, error } = await supabase
      .from('premium_subscriptions')
      .select('plan_type, amount, status, expires_at');
    if (error) throw error;
    const subs = (data ?? []) as Record<string, unknown>[];

    const active = subs.filter(subIsActive);
    const activeMonthly = active.filter((s) => s.plan_type === 'monthly');
    const activeLifetime = active.filter((s) => s.plan_type === 'lifetime');
    const soonLimit = Date.now() + 7 * 24 * 60 * 60 * 1000;

    res.json({
      activeTotal: active.length,
      activeMonthly: activeMonthly.length,
      activeLifetime: activeLifetime.length,
      mrr: round2(activeMonthly.reduce((s, x) => s + Number(x.amount), 0)),
      revenueTotal: round2(subs.reduce((s, x) => s + Number(x.amount), 0)),
      expiringSoon: activeMonthly.filter(
        (s) => s.expires_at && new Date(s.expires_at as string).getTime() <= soonLimit
      ).length,
      cancelled: subs.filter((s) => s.status === 'cancelled').length,
    });
  })
);

// Lista de assinaturas com filtros
app.get(
  '/admin/subscriptions',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const status = str(req.query.status);
    const plan = str(req.query.plan);
    const q = str(req.query.q);
    const from = str(req.query.from);
    const toRaw = str(req.query.to);
    const to = toRaw ? (toRaw.length === 10 ? `${toRaw}T23:59:59.999Z` : toRaw) : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    let query = supabase
      .from('premium_subscriptions')
      .select('id, user_id, plan_type, amount, payment_method, status, starts_at, expires_at, created_at')
      .order('starts_at', { ascending: false });
    if (status) query = query.eq('status', status);
    if (plan) query = query.eq('plan_type', plan);
    if (from) query = query.gte('starts_at', from);
    if (to) query = query.lte('starts_at', to);

    const { data, error } = await query;
    if (error) throw error;

    const subs = (data ?? []) as Record<string, unknown>[];
    const userIds = [...new Set(subs.map((s) => s.user_id as string))];
    const { data: profs } = userIds.length
      ? await supabase.from('profiles').select('id, full_name').in('id', userIds)
      : { data: [] as Record<string, unknown>[] };
    const nameMap = new Map((profs ?? []).map((p) => [p.id as string, p.full_name]));

    let rows = subs.map((s) => ({
      id: s.id,
      plan_type: s.plan_type,
      amount: Number(s.amount),
      payment_method: s.payment_method,
      status: s.status,
      starts_at: s.starts_at,
      expires_at: s.expires_at,
      created_at: s.created_at,
      user: { id: s.user_id, full_name: nameMap.get(s.user_id as string) ?? null },
    }));

    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter(
        (r) =>
          typeof r.user.full_name === 'string' &&
          r.user.full_name.toLowerCase().includes(needle)
      );
    }

    res.json({ rows: rows.slice(offset, offset + limit), total: rows.length });
  })
);

// Cancela uma assinatura e revoga o premium (se for a única ativa do usuário)
app.post(
  '/admin/subscriptions/:id/cancel',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { data: sub } = await supabase
      .from('premium_subscriptions')
      .select('id, user_id, status')
      .eq('id', id)
      .maybeSingle();
    if (!sub) return res.status(404).json({ error: 'Assinatura não encontrada' });
    if (sub.status === 'cancelled') {
      return res.status(400).json({ error: 'Esta assinatura já está cancelada' });
    }

    await supabase
      .from('premium_subscriptions')
      .update({ status: 'cancelled' })
      .eq('id', id);

    // Mantém o premium só se o usuário tiver outra assinatura ainda ativa
    const { data: others } = await supabase
      .from('premium_subscriptions')
      .select('status, expires_at')
      .eq('user_id', sub.user_id)
      .eq('status', 'active');
    if (!(others ?? []).some(subIsActive)) {
      await supabase
        .from('profiles')
        .update({ is_premium: false, premium_expires_at: null })
        .eq('id', sub.user_id);
    }

    await supabase.from('notifications').insert({
      user_id: sub.user_id,
      title: 'Assinatura Premium cancelada',
      body: 'Sua assinatura Premium foi cancelada. Em caso de dúvida, fale com o suporte.',
      type: 'premium_cancelled',
    });

    res.json({ success: true });
  })
);

// Concede premium a um usuário como cortesia (sem cobrança)
app.post(
  '/admin/subscriptions/grant',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { userId, planType } = req.body ?? {};
    if (!userId) return res.status(400).json({ error: 'userId obrigatório' });
    if (!['monthly', 'lifetime'].includes(planType)) {
      return res.status(400).json({ error: "planType deve ser 'monthly' ou 'lifetime'" });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();
    if (!profile) return res.status(404).json({ error: 'Usuário não encontrado' });

    const expiresAt =
      planType === 'lifetime'
        ? null
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: sub, error } = await supabase
      .from('premium_subscriptions')
      .insert({
        user_id: userId,
        plan_type: planType,
        amount: 0,
        payment_method: 'admin_grant',
        payment_id: `grant_${Date.now()}`,
        status: 'active',
        starts_at: new Date().toISOString(),
        expires_at: expiresAt,
      })
      .select()
      .single();
    if (error) throw error;

    await supabase
      .from('profiles')
      .update({ is_premium: true, premium_expires_at: expiresAt })
      .eq('id', userId);

    await supabase.from('notifications').insert({
      user_id: userId,
      title: 'Premium ativado! ⭐',
      body:
        planType === 'lifetime'
          ? 'Você recebeu o Premium vitalício, cortesia da equipe PetPerdidoSOS.'
          : 'Você recebeu 30 dias de Premium, cortesia da equipe PetPerdidoSOS.',
      type: 'premium_activated',
    });

    res.json({ success: true, subscription: sub });
  })
);

// ============================================================================
// PETS — listagem por proximidade
// ============================================================================
app.get(
  '/pets/nearby',
  asyncHandler(async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radius = Number(req.query.radius ?? 5000);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'lat e lng obrigatórios' });
    }

    const degRange = radius / 111000;

    const { data, error } = await supabase
      .from('pets')
      .select(
        `id, user_id, name, breed, color, size, sex, age_group, description, extra_info,
         type, species, allow_contact, is_with_finder, adoption_rules, main_photo_url, latitude, longitude, lost_date, status, created_at,
         profiles!pets_user_id_fkey ( full_name, rescues_count ),
         rewards ( amount, status )`
      )
      .eq('status', 'ativo')
      .gte('latitude', lat - degRange)
      .lte('latitude', lat + degRange)
      .gte('longitude', lng - degRange)
      .lte('longitude', lng + degRange)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const enriched = (data ?? [])
      .map((p: any) => {
        const distance = haversineMeters(lat, lng, p.latitude, p.longitude);
        const reward = (p.rewards ?? []).find((r: any) => r.status === 'locked' || r.status === 'pending');
        return {
          id: p.id,
          name: p.name,
          breed: p.breed,
          color: p.color,
          size: p.size,
          sex: p.sex,
          age_group: p.age_group,
          description: p.description,
          extra_info: p.extra_info,
          type: p.type ?? 'lost',
          species: p.species ?? null,
          allow_contact: p.allow_contact !== false,
          is_with_finder: p.is_with_finder === true,
          adoption_rules: p.adoption_rules ?? null,
          photo_url: p.main_photo_url,
          latitude: p.latitude,
          longitude: p.longitude,
          distance,
          lost_date: p.lost_date,
          status: p.status,
          reward: reward ? { amount: Number(reward.amount), status: reward.status } : undefined,
          user: {
            id: p.user_id,
            name: p.profiles?.full_name ?? 'Usuário',
            rescues_count: p.profiles?.rescues_count ?? 0,
          },
        };
      })
      .filter((p) => p.distance <= radius)
      .sort((a, b) => a.distance - b.distance);

    res.json(enriched);
  })
);

// ============================================================================
// DOAÇÃO — lista de pets disponíveis para adoção (área própria, fora do mapa).
// Filtros opcionais: lat/lng/radius (distância) e species. Sem localização,
// retorna as doações ativas mais recentes. Adoção costuma abranger área maior,
// então o raio padrão é generoso.
// ============================================================================
app.get(
  '/pets/donations',
  asyncHandler(async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const hasLoc = Number.isFinite(lat) && Number.isFinite(lng);
    const radius = Number(req.query.radius ?? 50000); // 50km padrão
    const species = typeof req.query.species === 'string' ? req.query.species : null;

    let query = supabase
      .from('pets')
      .select(
        `id, user_id, name, breed, color, size, sex, age_group, description, extra_info,
         type, species, adoption_rules, main_photo_url, latitude, longitude, created_at,
         profiles!pets_user_id_fkey ( full_name, photo_url, rescues_count )`
      )
      .eq('type', 'donation')
      .eq('status', 'ativo')
      .order('created_at', { ascending: false });

    if (species && ['cachorro', 'gato', 'passaro', 'outro'].includes(species)) {
      query = query.eq('species', species);
    }
    if (hasLoc) {
      const degRange = radius / 111000;
      query = query
        .gte('latitude', lat - degRange).lte('latitude', lat + degRange)
        .gte('longitude', lng - degRange).lte('longitude', lng + degRange);
    }

    const { data, error } = await query;
    if (error) throw error;

    let list = (data ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      breed: p.breed,
      color: p.color,
      size: p.size,
      sex: p.sex,
      age_group: p.age_group,
      description: p.description,
      extra_info: p.extra_info,
      type: 'donation',
      species: p.species ?? null,
      adoption_rules: p.adoption_rules ?? null,
      photo_url: p.main_photo_url,
      latitude: p.latitude,
      longitude: p.longitude,
      distance: hasLoc ? haversineMeters(lat, lng, p.latitude, p.longitude) : null,
      created_at: p.created_at,
      lost_date: p.created_at,
      user: {
        id: p.user_id,
        name: p.profiles?.full_name ?? 'Usuário',
        photo_url: p.profiles?.photo_url ?? null,
        rescues_count: p.profiles?.rescues_count ?? 0,
      },
    }));

    if (hasLoc) {
      list = list
        .filter((p) => (p.distance ?? Infinity) <= radius)
        .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    }

    res.json(list);
  })
);

// ============================================================================
// PETS — detalhes
// ============================================================================
app.get(
  '/pets/:petId',
  asyncHandler(async (req, res) => {
    const { petId } = req.params;
    const { data, error } = await supabase
      .from('pets')
      .select(
        `*, profiles!pets_user_id_fkey ( id, full_name, photo_url, rating, rescues_count, show_profile_photo ),
         pet_photos ( id, photo_url, position ),
         rewards ( id, amount, status, fee_amount )`
      )
      .eq('id', petId)
      .single();
    if (error) return res.status(404).json({ error: 'Pet não encontrado' });
    gateProfilePhoto((data as any).profiles);
    res.json(data);
  })
);

// ============================================================================
// PETS — ficha completa do caso (histórico de pet finalizado)
// ============================================================================
app.get(
  '/pets/:petId/case',
  asyncHandler(async (req, res) => {
    const { petId } = req.params;

    // 1. Pet + tutor + fotos
    const { data: pet, error: petErr } = await supabase
      .from('pets')
      .select(
        `id, user_id, name, breed, color, size, description, extra_info,
         main_photo_url, latitude, longitude, lost_date, status, created_at, updated_at,
         profiles!pets_user_id_fkey ( id, full_name, photo_url, show_profile_photo ),
         pet_photos ( photo_url, position )`
      )
      .eq('id', petId)
      .single();
    if (petErr || !pet) return res.status(404).json({ error: 'Pet não encontrado' });

    // 2. Recompensa (se houve)
    const { data: reward } = await supabase
      .from('rewards')
      .select('amount, fee_amount, status, paid_at, refunded_at, finder_user_id')
      .eq('pet_id', petId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // 3. Chat do resgate (found=true) — quem resgatou
    const { data: foundChat } = await supabase
      .from('chats')
      .select(
        `id, tutor_id, finder_id, status, found, closed_at, created_at,
         finder:profiles!chats_finder_id_fkey ( id, full_name, photo_url, rescues_count, show_profile_photo )`
      )
      .eq('pet_id', petId)
      .eq('found', true)
      .order('closed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // 4. Mensagens do chat do resgate
    let messages: any[] = [];
    if (foundChat) {
      const { data: msgs } = await supabase
        .from('messages')
        .select('id, sender_id, content, photo_url, created_at')
        .eq('chat_id', foundChat.id)
        .order('created_at', { ascending: true });
      messages = msgs ?? [];
    }

    // 5. Datas e tempo
    const lostDate = pet.lost_date ? new Date(pet.lost_date) : null;
    const foundDate = foundChat?.closed_at
      ? new Date(foundChat.closed_at)
      : reward?.paid_at
        ? new Date(reward.paid_at)
        : pet.status !== 'ativo'
          ? new Date(pet.updated_at)
          : null;
    const daysLost =
      lostDate && foundDate
        ? Math.max(0, Math.round((foundDate.getTime() - lostDate.getTime()) / 86400000))
        : null;

    gateProfilePhoto((pet as any).profiles);
    if (foundChat) gateProfilePhoto((foundChat as any).finder);

    res.json({
      pet,
      reward: reward ?? null,
      finder: foundChat?.finder ?? null,
      chat: foundChat ? { id: foundChat.id, created_at: foundChat.created_at, closed_at: foundChat.closed_at } : null,
      messages,
      timeline: {
        lost_date: pet.lost_date,
        found_date: foundDate ? foundDate.toISOString() : null,
        days_lost: daysLost,
      },
    });
  })
);

// ============================================================================
// PETS — criar alerta
// ============================================================================
app.post(
  '/pets',
  aiLimiter,
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const {
      name,
      breed,
      color,
      size,
      sex,
      age_group,
      description,
      extra_info,
      photo_url, // mantém compat com frontend antigo
      main_photo_url,
      latitude,
      longitude,
      lost_date,
      reward_amount,
      extra_photos, // array de até 3 urls
      type, // 'lost' | 'sighted' | 'rescued' | 'donation' — default 'lost'
      allow_contact, // só relevante p/ 'sighted'
      is_with_finder, // só relevante p/ 'rescued'
      species, // 'cachorro' | 'gato' | 'outro' | null (não sei)
      adoption_rules, // só relevante p/ 'donation'
      consent_responsibility, // doação: consentimento de responsabilidade
      consent_searched_owner, // doação: consentimento de já ter procurado o dono
    } = req.body ?? {};

    const mainPhoto = main_photo_url ?? photo_url;
    const petType = ['lost', 'sighted', 'rescued', 'donation'].includes(type) ? type : 'lost';
    const petSpecies = ['cachorro', 'gato', 'passaro', 'outro'].includes(species) ? species : null;
    // lost/rescued/donation sempre permitem chat; só 'sighted' respeita a escolha.
    const allowContact = petType === 'sighted' ? allow_contact !== false : true;
    const isWithFinder = petType === 'rescued' ? is_with_finder === true : false;

    if (!name || !mainPhoto || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ error: 'name, main_photo_url, latitude e longitude obrigatórios' });
    }

    // Doação exige os dois consentimentos (responsabilidade + já procurou o dono).
    if (petType === 'donation' && !(consent_responsibility === true && consent_searched_owner === true)) {
      return res.status(400).json({ error: 'Para doar é necessário aceitar os dois consentimentos' });
    }

    const { data: pet, error } = await supabase
      .from('pets')
      .insert({
        user_id: userId,
        name,
        breed,
        color,
        size,
        sex: sex ?? 'desconhecido',
        age_group: age_group ?? 'desconhecido',
        description,
        extra_info,
        main_photo_url: mainPhoto,
        latitude,
        longitude,
        lost_date: lost_date ?? new Date().toISOString(),
        status: 'ativo',
        type: petType,
        allow_contact: allowContact,
        is_with_finder: isWithFinder,
        species: petSpecies,
        adoption_rules: petType === 'donation' ? (adoption_rules ?? null) : null,
        consent_responsibility: petType === 'donation' ? consent_responsibility === true : false,
        consent_searched_owner: petType === 'donation' ? consent_searched_owner === true : false,
      })
      .select()
      .single();
    if (error) throw error;

    // Fotos adicionais
    if (Array.isArray(extra_photos) && extra_photos.length > 0) {
      const rows = extra_photos.slice(0, 3).map((url: string, i: number) => ({
        pet_id: pet.id,
        photo_url: url,
        position: i + 1,
      }));
      await supabase.from('pet_photos').insert(rows);
    }

    // Recompensa: só para pet perdido (lost). Avistado/resgatado não têm recompensa.
    if (petType === 'lost' && reward_amount && Number(reward_amount) > 0) {
      const amount = Number(reward_amount);
      const fee = Number((amount * (await getFeeRate())).toFixed(2));
      const { data: reward } = await supabase
        .from('rewards')
        .insert({
          pet_id: pet.id,
          amount,
          fee_amount: fee,
          status: 'pending',
          payer_user_id: userId,
        })
        .select('id')
        .single();

      // Registra escrow no extrato para aparecer na carteira
      if (reward) {
        await supabase.from('transactions').insert({
          user_id: userId,
          type: 'escrow_hold',
          amount: amount + fee,
          fee_amount: fee,
          status: 'pending',
          reward_id: reward.id,
          pet_id: pet.id,
          description: `Recompensa ofertada (R$ ${amount.toFixed(2)} + taxa R$ ${fee.toFixed(2)})`,
        });
      }
    }

    // Responde já — embedding é gerado em background (não bloqueia o cadastro)
    res.status(201).json(pet);

    if (isEmbeddingEnabled()) {
      generateImageEmbedding(mainPhoto)
        .then(async (embedding) => {
          await supabase.from('pets').update({ embedding }).eq('id', pet.id);
          console.log(`[embedding] pet ${pet.id} indexado`);
        })
        .catch((e) => console.error(`[embedding] falha no pet ${pet.id}:`, e.message));
    }
  })
);

// ============================================================================
// PETS — editar (PATCH) — apenas o dono, somente status='ativo'
// ============================================================================
app.patch(
  '/pets/:petId',
  requireUser,
  asyncHandler(async (req, res) => {
    const { petId } = req.params;
    const userId = authedId(req);
    const {
      name, breed, color, size, sex, age_group, description, extra_info,
      main_photo_url, latitude, longitude, lost_date,
      allow_contact, is_with_finder, // sighted / rescued
      adoption_rules, // donation
      extra_photos, // array de até 3 urls (substitui as atuais)
    } = req.body ?? {};

    const { data: pet, error: petErr } = await supabase
      .from('pets')
      .select('id, user_id, status, type')
      .eq('id', petId)
      .single();
    if (petErr || !pet) return res.status(404).json({ error: 'Pet não encontrado' });
    if (pet.user_id !== userId) return res.status(403).json({ error: 'Apenas o tutor pode editar' });
    if (pet.status !== 'ativo') return res.status(400).json({ error: `Pet com status ${pet.status} não pode ser editado` });

    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name;
    if (breed !== undefined) patch.breed = breed;
    if (color !== undefined) patch.color = color;
    if (size !== undefined) patch.size = size;
    if (sex !== undefined) patch.sex = sex;
    if (age_group !== undefined) patch.age_group = age_group;
    if (description !== undefined) patch.description = description;
    if (extra_info !== undefined) patch.extra_info = extra_info;
    if (main_photo_url !== undefined) patch.main_photo_url = main_photo_url;
    if (Number.isFinite(latitude)) patch.latitude = latitude;
    if (Number.isFinite(longitude)) patch.longitude = longitude;
    if (lost_date !== undefined) patch.lost_date = lost_date;
    // Flags por tipo: só aplica na coluna relevante ao tipo do pet.
    if (pet.type === 'sighted' && allow_contact !== undefined) patch.allow_contact = !!allow_contact;
    if (pet.type === 'rescued' && is_with_finder !== undefined) patch.is_with_finder = !!is_with_finder;
    if (pet.type === 'donation' && adoption_rules !== undefined) patch.adoption_rules = adoption_rules;

    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from('pets').update(patch).eq('id', petId);
      if (error) throw error;
    }

    // Fotos adicionais: substitui o conjunto inteiro se foi enviado
    if (Array.isArray(extra_photos)) {
      await supabase.from('pet_photos').delete().eq('pet_id', petId);
      const rows = extra_photos.slice(0, 3).map((url: string, i: number) => ({
        pet_id: petId,
        photo_url: url,
        position: i + 1,
      }));
      if (rows.length > 0) {
        const { error } = await supabase.from('pet_photos').insert(rows);
        if (error) throw error;
      }
    }

    res.json({ success: true });
  })
);

// ============================================================================
// RECOMPENSA — aumentar (delta + 10% taxa)
// ============================================================================
app.post(
  '/pets/:petId/reward/increase',
  requireUser,
  asyncHandler(async (req, res) => {
    const { petId } = req.params;
    const userId = authedId(req);
    const { delta } = req.body ?? {};
    const value = Number(delta);

    if (!Number.isFinite(value) || value <= 0) return res.status(400).json({ error: 'Valor de aumento inválido' });

    const { data: pet } = await supabase
      .from('pets')
      .select('id, user_id, status')
      .eq('id', petId)
      .single();
    if (!pet) return res.status(404).json({ error: 'Pet não encontrado' });
    if (pet.user_id !== userId) return res.status(403).json({ error: 'Apenas o tutor pode aumentar a recompensa' });
    if (pet.status !== 'ativo') return res.status(400).json({ error: 'Pet não está ativo' });

    const feeDelta = Number((value * (await getFeeRate())).toFixed(2));

    // Procura recompensa existente ainda aberta
    const { data: existing } = await supabase
      .from('rewards')
      .select('id, amount, fee_amount, status')
      .eq('pet_id', petId)
      .in('status', ['pending', 'locked'])
      .maybeSingle();

    let rewardId: string;
    if (existing) {
      const newAmount = Number(existing.amount) + value;
      const newFee = Number(existing.fee_amount) + feeDelta;
      const { error } = await supabase
        .from('rewards')
        .update({ amount: newAmount, fee_amount: newFee })
        .eq('id', existing.id);
      if (error) throw error;
      rewardId = existing.id;
    } else {
      const { data: created, error } = await supabase
        .from('rewards')
        .insert({
          pet_id: petId,
          amount: value,
          fee_amount: feeDelta,
          status: 'pending',
          payer_user_id: userId,
        })
        .select('id')
        .single();
      if (error) throw error;
      rewardId = created.id;
    }

    // Transação de escrow_hold pra rastreabilidade. A primeira recompensa de um
    // caso é "Recompensa ofertada"; valores adicionados depois são "Aumento".
    const description = existing
      ? `Aumento de recompensa (+R$ ${value.toFixed(2)} + taxa R$ ${feeDelta.toFixed(2)})`
      : `Recompensa ofertada (R$ ${value.toFixed(2)} + taxa R$ ${feeDelta.toFixed(2)})`;
    await supabase.from('transactions').insert({
      user_id: userId,
      type: 'escrow_hold',
      amount: value + feeDelta,
      fee_amount: feeDelta,
      status: 'pending',
      reward_id: rewardId,
      pet_id: petId,
      description,
    });

    res.json({ success: true, rewardId, deltaAmount: value, deltaFee: feeDelta });
  })
);

// ============================================================================
// PETS — cancelar (somente se não há chats abertos)
// ============================================================================
app.post(
  '/pets/:petId/cancel',
  requireUser,
  asyncHandler(async (req, res) => {
    const { petId } = req.params;
    const userId = authedId(req);

    const { data: pet, error: petErr } = await supabase
      .from('pets')
      .select('id, user_id, status')
      .eq('id', petId)
      .single();
    if (petErr || !pet) return res.status(404).json({ error: 'Pet não encontrado' });
    if (pet.user_id !== userId) return res.status(403).json({ error: 'Apenas o tutor pode cancelar' });
    if (pet.status !== 'ativo') return res.status(400).json({ error: `Pet com status ${pet.status} não pode ser cancelado` });

    const { count } = await supabase
      .from('chats')
      .select('id', { count: 'exact', head: true })
      .eq('pet_id', petId)
      .eq('status', 'open');

    if ((count ?? 0) > 0) {
      return res.status(400).json({ error: 'Existem chats abertos. Encerre-os antes de cancelar.' });
    }

    await supabase.from('pets').update({ status: 'cancelado' }).eq('id', petId);

    // Devolve recompensa (com taxa descontada) se houver
    const { data: reward } = await supabase
      .from('rewards')
      .select('id, amount, fee_amount, status, payer_user_id')
      .eq('pet_id', petId)
      .in('status', ['pending', 'locked'])
      .maybeSingle();

    if (reward) {
      const refund = Number(reward.amount) - Number(reward.fee_amount);
      await supabase
        .from('rewards')
        .update({ status: 'refunded', refunded_at: new Date().toISOString() })
        .eq('id', reward.id);

      const { error: creditErr } = await supabase
        .rpc('wallet_credit', { p_user_id: reward.payer_user_id, p_amount: refund });
      if (creditErr) throw creditErr;

      await supabase.from('transactions').insert([
        { user_id: reward.payer_user_id, type: 'refund', amount: refund, reward_id: reward.id, pet_id: petId, description: 'Reembolso de cancelamento (taxa descontada)' },
        { user_id: reward.payer_user_id, type: 'fee', amount: -Number(reward.fee_amount), reward_id: reward.id, pet_id: petId, description: 'Taxa do app' },
      ]);
    }

    res.json({ success: true });
  })
);

// ============================================================================
// DOAÇÃO — transformar um pet resgatado em alerta de doação.
// Exige os dois consentimentos (responsabilidade + já procurou o dono).
// ============================================================================
app.post(
  '/pets/:petId/transform-donation',
  requireUser,
  asyncHandler(async (req, res) => {
    const { petId } = req.params;
    const userId = authedId(req);
    const { adoption_rules, consent_responsibility, consent_searched_owner } = req.body ?? {};

    const { data: pet, error: petErr } = await supabase
      .from('pets')
      .select('id, user_id, status, type')
      .eq('id', petId)
      .single();
    if (petErr || !pet) return res.status(404).json({ error: 'Pet não encontrado' });
    if (pet.user_id !== userId) return res.status(403).json({ error: 'Apenas o tutor pode doar' });
    if (pet.type !== 'rescued') return res.status(400).json({ error: 'Apenas um pet resgatado pode virar doação' });
    if (pet.status !== 'ativo') return res.status(400).json({ error: `Pet com status ${pet.status} não pode ser doado` });
    if (!(consent_responsibility === true && consent_searched_owner === true)) {
      return res.status(400).json({ error: 'É necessário aceitar os dois consentimentos' });
    }

    const { error } = await supabase
      .from('pets')
      .update({
        type: 'donation',
        adoption_rules: adoption_rules ?? null,
        consent_responsibility: true,
        consent_searched_owner: true,
        allow_contact: true,
      })
      .eq('id', petId);
    if (error) throw error;

    res.json({ success: true });
  })
);

// ============================================================================
// DOAÇÃO — concluir doação feita por outro local (offline), sem relacionar
// um adotante do app. Apenas o tutor; marca o alerta como 'doado'.
// ============================================================================
app.post(
  '/pets/:petId/conclude-donation',
  requireUser,
  asyncHandler(async (req, res) => {
    const { petId } = req.params;
    const userId = authedId(req);

    const { data: pet, error: petErr } = await supabase
      .from('pets')
      .select('id, user_id, status, type')
      .eq('id', petId)
      .single();
    if (petErr || !pet) return res.status(404).json({ error: 'Pet não encontrado' });
    if (pet.user_id !== userId) return res.status(403).json({ error: 'Apenas o tutor pode concluir' });
    if (pet.type !== 'donation') return res.status(400).json({ error: 'Este alerta não é uma doação' });
    if (pet.status !== 'ativo') return res.status(400).json({ error: `Doação com status ${pet.status}` });

    await supabase.from('pets').update({ status: 'doado' }).eq('id', petId);
    // Encerra eventuais chats abertos da doação
    await supabase.from('chats')
      .update({ status: 'closed', found: false, closed_at: new Date().toISOString() })
      .eq('pet_id', petId).eq('status', 'open');

    res.json({ success: true });
  })
);

// ============================================================================
// DOAÇÃO — confirmar doação pelo chat, relacionando o adotante.
// O tutor (doador) confirma que doou o pet para o participante (adotante)
// do chat. Marca o alerta como 'doado' e registra adopter_user_id. Sem recompensa.
// ============================================================================
app.post(
  '/chats/:chatId/confirm-donation',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { chatId } = req.params;

    const { data: chat } = await supabase
      .from('chats')
      .select('id, pet_id, tutor_id, finder_id, status')
      .eq('id', chatId)
      .single();
    if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });
    if (chat.tutor_id !== userId) return res.status(403).json({ error: 'Apenas o doador pode confirmar a doação' });

    const { data: pet } = await supabase
      .from('pets').select('id, name, type, status').eq('id', chat.pet_id).single();
    if (!pet) return res.status(404).json({ error: 'Pet não encontrado' });
    if (pet.type !== 'donation') return res.status(400).json({ error: 'Este alerta não é uma doação' });
    if (pet.status !== 'ativo') return res.status(400).json({ error: `Doação com status ${pet.status}` });

    const adopterId = chat.finder_id;

    // Marca a doação como concluída e relaciona o adotante.
    await supabase.from('pets')
      .update({ status: 'doado', adopter_user_id: adopterId })
      .eq('id', chat.pet_id);
    // Encerra o chat do adotante (found=true) e os demais chats da doação.
    await supabase.from('chats')
      .update({ status: 'closed', found: true, closed_at: new Date().toISOString() })
      .eq('id', chat.id);
    await supabase.from('chats')
      .update({ status: 'closed', found: false, closed_at: new Date().toISOString() })
      .eq('pet_id', chat.pet_id).eq('status', 'open');

    await supabase.from('messages').insert({
      chat_id: chat.id, sender_id: userId,
      content: '🏡 Doação confirmada! O pet foi adotado. Obrigado por dar um novo lar a ele.',
      system: true,
    });
    await supabase.from('notifications').insert({
      user_id: adopterId,
      title: 'Doação confirmada! 🏡',
      body: `O doador confirmou que você adotou ${pet.name}. Cuide bem dele!`,
      type: 'donation_confirmed', pet_id: chat.pet_id, chat_id: chat.id,
    });

    res.json({ success: true });
  })
);

// ============================================================================
// PERFIL
// ============================================================================
app.get(
  '/pets/user/:userId/profile',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);

    const { data: profile, error: pErr } = await supabase
      .from('profiles')
      .select('id, full_name, bio, cpf, phone, photo_url, pix_key, rating, rescues_count, wallet_balance, is_premium, premium_expires_at')
      .eq('id', userId)
      .maybeSingle();
    if (pErr) throw pErr;

    const { data: pets } = await supabase
      .from('pets')
      .select(
        `id, name, type, breed, color, size, sex, age_group, allow_contact, is_with_finder, adoption_rules, main_photo_url, latitude, longitude, status, created_at, lost_date,
         rewards ( amount, status ),
         chats!chats_pet_id_fkey ( id, status )`
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    const enrichedPets = (pets ?? []).map((p: any) => {
      const reward = (p.rewards ?? []).find((r: any) => r.status === 'pending' || r.status === 'locked');
      const openChats = (p.chats ?? []).filter((c: any) => c.status === 'open').length;
      return {
        id: p.id,
        name: p.name,
        type: p.type ?? 'lost',
        breed: p.breed,
        color: p.color,
        size: p.size,
        sex: p.sex,
        age_group: p.age_group,
        allow_contact: p.allow_contact !== false,
        is_with_finder: p.is_with_finder === true,
        adoption_rules: p.adoption_rules ?? null,
        main_photo_url: p.main_photo_url,
        latitude: p.latitude,
        longitude: p.longitude,
        status: p.status,
        created_at: p.created_at,
        lost_date: p.lost_date,
        reward: reward ? { amount: Number(reward.amount), status: reward.status } : null,
        open_chats_count: openChats,
      };
    });

    res.json({
      ...(profile ?? { id: userId, full_name: null, photo_url: null, wallet_balance: 0 }),
      name: profile?.full_name,
      pets: enrichedPets,
    });
  })
);

app.post(
  '/pets/user/:userId/profile',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { name, full_name, bio, photo_url, cpf, phone, pix_key } = req.body ?? {};

    const update: Record<string, unknown> = { id: userId };
    if (name || full_name) update.full_name = full_name ?? name;
    if (bio !== undefined) update.bio = bio;
    if (photo_url !== undefined) update.photo_url = photo_url;
    if (cpf !== undefined) update.cpf = cpf;
    if (phone !== undefined) update.phone = phone;
    if (pix_key !== undefined) update.pix_key = pix_key;

    const { data, error } = await supabase.from('profiles').upsert(update).select().single();
    if (error) throw error;
    res.json(data);
  })
);

// ============================================================================
// PERFIL PÚBLICO — dados não-sensíveis de um usuário (exibido no chat).
// Retorna SOMENTE campos públicos: nunca cpf, telefone, chave PIX ou saldo.
// ============================================================================
app.get(
  '/user/:userId/public-profile',
  requireUser,
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, photo_url, rescues_count, rating, bio, created_at, is_premium, show_profile_photo')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    res.json(gateProfilePhoto(data) ?? null);
  })
);

// ============================================================================
// SETTINGS
// ============================================================================
app.get(
  '/user/:userId/settings',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    // show_profile_photo vive em profiles — mescla na resposta de settings.
    const { data: prof } = await supabase
      .from('profiles')
      .select('show_profile_photo')
      .eq('id', userId)
      .maybeSingle();
    res.json({ ...(data ?? {}), show_profile_photo: prof?.show_profile_photo !== false });
  })
);

app.post(
  '/user/:userId/settings',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { show_on_map, notification_channel, default_search_radius_m, travel_mode, pin_color, show_profile_photo } = req.body ?? {};

    const { data, error } = await supabase
      .from('user_settings')
      .upsert({
        user_id: userId,
        show_on_map,
        notification_channel,
        default_search_radius_m,
        travel_mode,
        pin_color,
      })
      .select()
      .single();
    if (error) throw error;

    // Privacidade da foto fica em profiles.
    if (show_profile_photo !== undefined) {
      await supabase.from('profiles').update({ show_profile_photo: !!show_profile_photo }).eq('id', userId);
    }
    res.json({ ...data, ...(show_profile_photo !== undefined ? { show_profile_photo: !!show_profile_photo } : {}) });
  })
);

// ============================================================================
// CHATS — listar chats do usuário
// ============================================================================
app.get(
  '/user/:userId/chats',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { data, error } = await supabase
      .from('chats')
      .select(
        `id, pet_id, tutor_id, finder_id, status, found, closed_at, created_at, source_pet_id,
         pets!chats_pet_id_fkey ( id, name, main_photo_url, status ),
         tutor:profiles!chats_tutor_id_fkey ( id, full_name, photo_url, show_profile_photo ),
         finder:profiles!chats_finder_id_fkey ( id, full_name, photo_url, show_profile_photo )`
      )
      .or(`tutor_id.eq.${userId},finder_id.eq.${userId}`)
      .order('created_at', { ascending: false });
    if (error) throw error;
    (data ?? []).forEach((c: any) => { gateProfilePhoto(c.tutor); gateProfilePhoto(c.finder); });
    res.json(data ?? []);
  })
);

// ============================================================================
// RESGATES — lista de pets que o usuário resgatou (foi o finder, chat found=true)
// + total de recompensas já ganhas
// ============================================================================
app.get(
  '/user/:userId/rescues',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);

    const { data: chats, error } = await supabase
      .from('chats')
      .select(
        `id, pet_id, tutor_id, closed_at, created_at,
         pets!chats_pet_id_fkey ( id, name, main_photo_url, breed, color, size, status, lost_date ),
         tutor:profiles!chats_tutor_id_fkey ( id, full_name, photo_url, show_profile_photo )`
      )
      .eq('finder_id', userId)
      .eq('found', true)
      .order('closed_at', { ascending: false });
    if (error) throw error;

    const { data: rewards } = await supabase
      .from('rewards')
      .select('pet_id, amount, status, paid_at')
      .eq('finder_user_id', userId)
      .eq('status', 'paid');

    const rewardByPet = new Map((rewards ?? []).map((r: any) => [r.pet_id, r]));

    const rescues = (chats ?? []).map((c: any) => {
      const reward = rewardByPet.get(c.pet_id);
      return {
        chat_id: c.id,
        pet: c.pets,
        tutor: gateProfilePhoto(c.tutor),
        rescued_at: c.closed_at ?? c.created_at,
        reward_amount: reward ? Number(reward.amount) : 0,
      };
    });

    const totalEarned = rescues.reduce((sum, r) => sum + r.reward_amount, 0);

    res.json({ rescues, totalEarned, count: rescues.length });
  })
);

// ============================================================================
// MENSAGENS — get/create chat + lista
// Mantém contrato antigo: /pets/:petId/messages?userId1=&userId2=
// userId1 = quem está consultando; userId2 = a outra parte (tutor ou finder)
// ============================================================================
async function getOrCreateChat(petId: string, userA: string, userB: string) {
  const { data: pet } = await supabase.from('pets').select('user_id, status').eq('id', petId).single();
  if (!pet) throw new Error('Pet não encontrado');

  const tutorId = pet.user_id;
  const finderId = userA === tutorId ? userB : userA;
  if (finderId === tutorId) throw new Error('finder não pode ser o próprio tutor');

  const { data: existing } = await supabase
    .from('chats')
    .select('*')
    .eq('pet_id', petId)
    .eq('finder_id', finderId)
    .maybeSingle();
  if (existing) return existing;

  if (pet.status !== 'ativo') throw new Error(`Pet com status ${pet.status} não aceita novos chats`);

  const { data: created, error } = await supabase
    .from('chats')
    .insert({ pet_id: petId, tutor_id: tutorId, finder_id: finderId })
    .select()
    .single();
  if (error) throw error;
  return created;
}

app.get(
  '/pets/:petId/messages',
  requireUser,
  asyncHandler(async (req, res) => {
    const { petId } = req.params;
    const userId1 = authedId(req);
    const userId2 = String(req.query.userId2 ?? '');

    if (!userId2) return res.status(400).json({ error: 'userId2 obrigatório' });

    const chat = await getOrCreateChat(petId, userId1, userId2);

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('chat_id', chat.id)
      .order('created_at', { ascending: true });
    if (error) throw error;

    // Mantém compat com frontend: adiciona pet_id em cada msg
    const enriched = (data ?? []).map((m: any) => ({
      ...m,
      pet_id: petId,
      receiver_id: m.sender_id === chat.tutor_id ? chat.finder_id : chat.tutor_id,
    }));
    res.json(enriched);
  })
);

app.post(
  '/pets/:petId/messages',
  requireUser,
  asyncHandler(async (req, res) => {
    const { petId } = req.params;
    const senderId = authedId(req);
    const { receiverId, content, photo_url } = req.body ?? {};

    if (!receiverId || (!content && !photo_url)) {
      return res.status(400).json({ error: 'receiverId e content/photo_url obrigatórios' });
    }

    const chat = await getOrCreateChat(petId, senderId, receiverId);

    const { data: msg, error } = await supabase
      .from('messages')
      .insert({ chat_id: chat.id, sender_id: senderId, content, photo_url })
      .select()
      .single();
    if (error) throw error;

    await supabase.from('notifications').insert({
      user_id: receiverId,
      title: 'Nova mensagem',
      body: content ? String(content).slice(0, 80) : '📷 Foto',
      type: 'message',
      pet_id: petId,
      chat_id: chat.id,
    });

    res.status(201).json({ ...msg, pet_id: petId, receiver_id: receiverId });
  })
);

// ============================================================================
// CHAT — confirmar resgate (sem email — usa o finder do próprio chat)
// ============================================================================
app.post(
  '/chats/:chatId/confirm-rescue',
  requireUser,
  asyncHandler(async (req, res) => {
    const { chatId } = req.params;
    const userId = authedId(req);

    const { data: chat, error: chatErr } = await supabase
      .from('chats')
      .select('id, pet_id, tutor_id, finder_id, status')
      .eq('id', chatId)
      .single();
    if (chatErr || !chat) return res.status(404).json({ error: 'Chat não encontrado' });
    if (chat.tutor_id !== userId) return res.status(403).json({ error: 'Apenas o tutor pode confirmar' });

    const { data: pet, error: petErr } = await supabase
      .from('pets')
      .select('id, name, status')
      .eq('id', chat.pet_id)
      .single();
    if (petErr || !pet) return res.status(404).json({ error: 'Pet não encontrado' });
    if (pet.status !== 'ativo') return res.status(400).json({ error: `Pet com status ${pet.status} não pode ser confirmado` });

    const finderId = chat.finder_id;

    // 1. Marca pet como encontrado
    await supabase.from('pets').update({ status: 'encontrado' }).eq('id', chat.pet_id);

    // 2. Encerra este chat (found=true) e os demais chats abertos do pet (found=false)
    await supabase
      .from('chats')
      .update({ status: 'closed', found: true, closed_at: new Date().toISOString() })
      .eq('id', chat.id);
    await supabase
      .from('chats')
      .update({ status: 'closed', found: false, closed_at: new Date().toISOString() })
      .eq('pet_id', chat.pet_id)
      .eq('status', 'open');

    // 3. Libera recompensa (se houver)
    const { data: reward } = await supabase
      .from('rewards')
      .select('id, amount, fee_amount, status, payer_user_id')
      .eq('pet_id', chat.pet_id)
      .in('status', ['pending', 'locked'])
      .maybeSingle();

    let rewardAmount = 0;
    if (reward) {
      rewardAmount = Number(reward.amount);
      await supabase
        .from('rewards')
        .update({ status: 'paid', finder_user_id: finderId, paid_at: new Date().toISOString() })
        .eq('id', reward.id);

      // Crédito de recompensa + incremento de resgates de forma atômica.
      const { error: payoutErr } = await supabase
        .rpc('reward_payout', { p_user_id: finderId, p_amount: rewardAmount });
      if (payoutErr) throw payoutErr;

      const petName1 = pet?.name ?? 'Pet';
      await supabase.from('transactions').insert([
        { user_id: finderId, type: 'reward_received', amount: rewardAmount, reward_id: reward.id, pet_id: chat.pet_id, description: `Recompensa recebida - Caso ${petName1}` },
        { user_id: reward.payer_user_id, type: 'escrow_release', amount: -rewardAmount, reward_id: reward.id, pet_id: chat.pet_id, description: `Liberação de recompensa - Caso ${petName1}` },
      ]);
    } else {
      // Sem recompensa monetária: só incrementa contador
      await supabase.rpc('profile_increment_rescues', { p_user_id: finderId });
    }

    // 4. Notificação
    await supabase.from('notifications').insert({
      user_id: finderId,
      title: 'Resgate confirmado! 🎉',
      body: rewardAmount > 0
        ? `Recompensa de R$ ${rewardAmount.toFixed(2)} adicionada à sua carteira.`
        : 'Obrigado pelo resgate!',
      type: 'rescue_confirmed',
      pet_id: chat.pet_id,
      chat_id: chat.id,
    });

    res.json({ success: true, finderId, reward: rewardAmount });
  })
);

// ============================================================================
// CHAT — encerrar (somente tutor)
// ============================================================================
app.post(
  '/chats/:chatId/close',
  requireUser,
  asyncHandler(async (req, res) => {
    const { chatId } = req.params;
    const userId = authedId(req);
    const { found } = req.body ?? {};

    const { data: chat, error: chatErr } = await supabase.from('chats').select('*').eq('id', chatId).single();
    if (chatErr || !chat) return res.status(404).json({ error: 'Chat não encontrado' });
    if (chat.tutor_id !== userId) return res.status(403).json({ error: 'Apenas o tutor pode encerrar' });
    if (chat.status === 'closed') return res.status(400).json({ error: 'Chat já encerrado' });

    await supabase
      .from('chats')
      .update({ status: 'closed', closed_at: new Date().toISOString(), found: Boolean(found) })
      .eq('id', chatId);

    res.json({ success: true });
  })
);

// CHAT — cancelar/encerrar (qualquer participante). Usado no fluxo de avistamento:
// quem viu só pode cancelar; o tutor pode confirmar ou cancelar.
app.post(
  '/chats/:chatId/cancel',
  requireUser,
  asyncHandler(async (req, res) => {
    const { chatId } = req.params;
    const userId = authedId(req);

    const { data: chat, error: chatErr } = await supabase
      .from('chats').select('id, tutor_id, finder_id, status').eq('id', chatId).single();
    if (chatErr || !chat) return res.status(404).json({ error: 'Chat não encontrado' });
    if (chat.tutor_id !== userId && chat.finder_id !== userId) {
      return res.status(403).json({ error: 'Sem permissão' });
    }
    if (chat.status === 'closed') return res.json({ success: true });

    await supabase
      .from('chats')
      .update({ status: 'closed', closed_at: new Date().toISOString(), found: false })
      .eq('id', chatId);

    res.json({ success: true });
  })
);

// ============================================================================
// RESGATE — confirmar (tutor confirma, libera recompensa pro finder)
// ============================================================================
app.post(
  '/pets/:petId/confirm-rescue',
  requireUser,
  asyncHandler(async (req, res) => {
    const { petId } = req.params;
    const tutorId = authedId(req);
    const { finderEmail } = req.body ?? {};

    if (!finderEmail) return res.status(400).json({ message: 'finderEmail obrigatório' });

    const { data: pet, error: petErr } = await supabase
      .from('pets')
      .select('id, name, user_id, status')
      .eq('id', petId)
      .single();
    if (petErr || !pet) return res.status(404).json({ message: 'Pet não encontrado' });
    if (pet.user_id !== tutorId) return res.status(403).json({ message: 'Apenas o tutor pode confirmar' });
    if (pet.status !== 'ativo') return res.status(400).json({ message: `Pet com status ${pet.status} não pode ser confirmado` });

    // Acha o finder pelo email
    const { data: users, error: usersErr } = await supabase.auth.admin.listUsers();
    if (usersErr) throw usersErr;
    const finder = users.users.find((u) => u.email?.toLowerCase() === String(finderEmail).toLowerCase());
    if (!finder) return res.status(404).json({ message: 'Email do herói não encontrado' });

    // Atualiza pet
    await supabase.from('pets').update({ status: 'encontrado' }).eq('id', petId);

    // Encerra chat correspondente (se existir)
    await supabase
      .from('chats')
      .update({ status: 'closed', found: true, closed_at: new Date().toISOString() })
      .eq('pet_id', petId)
      .eq('finder_id', finder.id);

    // Libera recompensa
    const { data: reward } = await supabase
      .from('rewards')
      .select('id, amount, fee_amount, status, payer_user_id')
      .eq('pet_id', petId)
      .in('status', ['pending', 'locked'])
      .maybeSingle();

    let rewardAmount = 0;
    if (reward) {
      rewardAmount = Number(reward.amount);
      await supabase
        .from('rewards')
        .update({ status: 'paid', finder_user_id: finder.id, paid_at: new Date().toISOString() })
        .eq('id', reward.id);

      const { error: payoutErr } = await supabase
        .rpc('reward_payout', { p_user_id: finder.id, p_amount: rewardAmount });
      if (payoutErr) throw payoutErr;

      const petName2 = pet?.name ?? 'Pet';
      await supabase.from('transactions').insert([
        { user_id: finder.id, type: 'reward_received', amount: rewardAmount, reward_id: reward.id, pet_id: petId, description: `Recompensa recebida - Caso ${petName2}` },
        { user_id: reward.payer_user_id, type: 'escrow_release', amount: -rewardAmount, reward_id: reward.id, pet_id: petId, description: `Liberação de recompensa - Caso ${petName2}` },
      ]);
    } else {
      // Sem recompensa monetária, mas ainda incrementa contador de resgates
      await supabase.rpc('profile_increment_rescues', { p_user_id: finder.id });
    }

    await supabase.from('notifications').insert({
      user_id: finder.id,
      title: 'Resgate confirmado! 🎉',
      body: rewardAmount > 0 ? `Recompensa de R$ ${rewardAmount.toFixed(2)} adicionada à sua carteira.` : 'Obrigado pelo resgate!',
      type: 'rescue_confirmed',
      pet_id: petId,
    });

    res.json({ success: true, finderId: finder.id, reward: rewardAmount });
  })
);

// ============================================================================
// NOTIFICAÇÕES
// ============================================================================
app.get(
  '/pets/user/:userId/notifications',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { data, error } = await supabase
      .from('notifications')
      .select(
        `id, user_id, title, body, type, pet_id, chat_id, ticket_id, read, created_at,
         pets ( name, status ),
         chats (
           status, tutor_id, finder_id,
           tutor:profiles!chats_tutor_id_fkey ( full_name ),
           finder:profiles!chats_finder_id_fkey ( full_name )
         )`
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;

    const enriched = (data ?? []).map((n: any) => {
      let sender_name: string | null = null;
      let chat_status: string | null = null;
      let chat_tutor_id: string | null = null;
      let chat_finder_id: string | null = null;

      if (n.chats) {
        chat_status = n.chats.status;
        chat_tutor_id = n.chats.tutor_id;
        chat_finder_id = n.chats.finder_id;
        // Remetente = participante do chat que NÃO é quem recebeu a notificação
        sender_name =
          n.user_id === n.chats.tutor_id
            ? n.chats.finder?.full_name ?? null
            : n.chats.tutor?.full_name ?? null;
      }

      return {
        id: n.id,
        user_id: n.user_id,
        title: n.title,
        body: n.body,
        type: n.type,
        pet_id: n.pet_id,
        chat_id: n.chat_id,
        ticket_id: n.ticket_id,
        read: n.read,
        created_at: n.created_at,
        pet_name: n.pets?.name ?? null,
        pet_status: n.pets?.status ?? null,
        sender_name,
        chat_status,
        chat_tutor_id,
        chat_finder_id,
      };
    });
    res.json(enriched);
  })
);

app.post(
  '/pets/user/:userId/notifications/read',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false);
    if (error) throw error;
    res.json({ success: true });
  })
);

// ============================================================================
// CARTEIRA — extrato + saque
// ============================================================================
app.get(
  '/user/:userId/transactions',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);

    // Busca transações reais (com dados do pet para agrupamento no app)
    const { data: txs, error } = await supabase
      .from('transactions')
      .select('id, type, amount, fee_amount, status, description, reward_id, pet_id, external_id, created_at, pets(name, main_photo_url, status)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;

    // Busca rewards do usuário (alertas com recompensa ofertada)
    const { data: rewards } = await supabase
      .from('rewards')
      .select('id, amount, fee_amount, pet_id, status, created_at, pets(name, main_photo_url, status)')
      .eq('payer_user_id', userId)
      .order('created_at', { ascending: false });

    // Soma dos escrow_holds reais por reward_id
    const escrowSumByRewardId = new Map<string, number>();
    for (const t of txs ?? []) {
      if (t.type === 'escrow_hold' && t.reward_id) {
        escrowSumByRewardId.set(
          t.reward_id,
          (escrowSumByRewardId.get(t.reward_id) ?? 0) + Math.abs(Number(t.amount))
        );
      }
    }

    // Para cada reward, gera sintético apenas para o valor ainda não coberto por transações reais
    // (ex: alerta criado antes da correção e depois com aumento — o gap da oferta original é coberto aqui)
    const syntheticTxs = (rewards ?? []).flatMap((r) => {
      const totalExpected = Number(r.amount) + Number(r.fee_amount);
      const covered       = escrowSumByRewardId.get(r.id) ?? 0;
      const gap           = totalExpected - covered;
      if (gap < 0.01) return []; // já coberto

      const offerGap = gap / 1.10;
      const feeGap   = gap - offerGap;
      const petName  = (r as any).pets?.name ?? 'Pet';
      return [{
        id:          `synthetic_${r.id}`,
        type:        'escrow_hold' as const,
        amount:      -gap,
        fee_amount:  feeGap,
        status:      'pending' as const,
        description: `Recompensa ofertada para ${petName} (R$ ${offerGap.toFixed(2)} + taxa R$ ${feeGap.toFixed(2)})`,
        reward_id:   r.id,
        pet_id:      r.pet_id,
        external_id: null,
        created_at:  r.created_at,
        pets:        (r as any).pets,
      }];
    });

    // Combina e reordena por data
    const all = [...(txs ?? []), ...syntheticTxs].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    res.json(all);
  })
);

app.post(
  '/user/:userId/withdraw',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { amount } = req.body ?? {};
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      return res.status(400).json({ error: 'Valor inválido' });
    }

    const { data: prof } = await supabase
      .from('profiles')
      .select('pix_key')
      .eq('id', userId)
      .maybeSingle();

    if (!prof) return res.status(404).json({ error: 'Perfil não encontrado' });
    if (!prof.pix_key) return res.status(400).json({ error: 'Cadastre uma chave PIX no perfil antes de sacar' });

    // Débito atômico — retorna NULL se o saldo for insuficiente. Uma única
    // instrução UPDATE evita double-spend sob requisições concorrentes.
    const { data: newBalance, error: debitErr } = await supabase
      .rpc('wallet_try_debit', { p_user_id: userId, p_amount: value });
    if (debitErr) throw debitErr;
    if (newBalance === null || newBalance === undefined) {
      return res.status(400).json({ error: 'Saldo insuficiente' });
    }

    const { data: tx, error } = await supabase
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'withdraw',
        amount: -value,
        status: 'pending',
        description: `Saque PIX solicitado para ${prof.pix_key}`,
      })
      .select()
      .single();
    if (error) throw error;

    await supabase.from('notifications').insert({
      user_id: userId,
      title: 'Saque solicitado',
      body: `R$ ${value.toFixed(2)} — processamento em até 1 dia útil.`,
      type: 'withdraw',
    });

    res.status(201).json(tx);
  })
);

// ============================================================================
// IA — match de pet por foto (CLIP + pgvector)
// Recebe a foto do pet encontrado + localização do buscador.
// Gera embedding, busca os mais parecidos e calcula distância.
// ============================================================================
app.post(
  '/pets/match',
  aiLimiter,
  requireUser,
  asyncHandler(async (req, res) => {
    const { photo_url, latitude, longitude } = req.body ?? {};

    if (!photo_url) return res.status(400).json({ error: 'photo_url obrigatório' });
    if (!isEmbeddingEnabled()) {
      return res.status(503).json({ error: 'Reconhecimento por IA não configurado (REPLICATE_API_TOKEN ausente)' });
    }

    // Limiar + raio configurados no painel admin (global).
    const { threshold, radiusM } = await getMatchConfig();

    // 1. Embedding da foto enviada
    let embedding: number[];
    try {
      embedding = await generateImageEmbedding(photo_url);
    } catch (e: any) {
      return res.status(502).json({ error: `Falha ao analisar a foto: ${e.message}` });
    }

    // 2. Busca vetorial (pgvector) — só pets PERDIDOS ativos acima do limiar
    const { data, error } = await supabase.rpc('match_pets', {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: 30,
    });
    if (error) throw error;

    const hasLoc = Number.isFinite(latitude) && Number.isFinite(longitude);

    // 3. Perfis dos donos (nome + foto respeitando a privacidade)
    const ownerIds = Array.from(new Set((data ?? []).map((p: any) => p.user_id)));
    const ownerById = new Map<string, any>();
    if (ownerIds.length) {
      const { data: owners } = await supabase
        .from('profiles')
        .select('id, full_name, photo_url, show_profile_photo')
        .in('id', ownerIds);
      (owners ?? []).forEach((o: any) => { gateProfilePhoto(o); ownerById.set(o.id, o); });
    }

    // 4. Enriquece com distância + % de similaridade e filtra pelo raio do admin
    const results = (data ?? [])
      .map((p: any) => {
        const distance = hasLoc
          ? haversineMeters(latitude, longitude, p.latitude, p.longitude)
          : null;
        const owner = ownerById.get(p.user_id);
        return {
          id: p.id,
          name: p.name,
          breed: p.breed,
          color: p.color,
          size: p.size,
          sex: p.sex,
          age_group: p.age_group,
          species: p.species ?? null,
          type: p.type ?? 'lost',
          description: p.description,
          extra_info: p.extra_info,
          photo_url: p.main_photo_url,
          latitude: p.latitude,
          longitude: p.longitude,
          lost_date: p.lost_date,
          status: p.status,
          user: { id: p.user_id, name: owner?.full_name ?? 'Tutor', photo_url: owner?.photo_url ?? null },
          similarity: Math.round(Number(p.similarity) * 100), // 0-100
          distance, // metros ou null
        };
      })
      .filter((r: any) => !hasLoc || (r.distance != null && r.distance <= radiusM))
      .sort((a: any, b: any) => b.similarity - a.similarity);

    res.json(results);
  })
);

// Backfill: gera embeddings dos pets que ainda não têm (rodar 1x após configurar a key)
app.post(
  '/admin/backfill-embeddings',
  aiLimiter,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    if (!isEmbeddingEnabled()) {
      return res.status(503).json({ error: 'REPLICATE_API_TOKEN ausente' });
    }
    const { data: pets, error } = await supabase
      .from('pets')
      .select('id, main_photo_url')
      .is('embedding', null)
      .eq('status', 'ativo');
    if (error) throw error;

    res.json({ message: `Backfill iniciado para ${pets?.length ?? 0} pets`, count: pets?.length ?? 0 });

    // Processa em background, sequencial pra não estourar rate limit
    (async () => {
      for (const pet of pets ?? []) {
        try {
          const embedding = await generateImageEmbedding(pet.main_photo_url);
          await supabase.from('pets').update({ embedding }).eq('id', pet.id);
          console.log(`[backfill] pet ${pet.id} OK`);
        } catch (e: any) {
          console.error(`[backfill] pet ${pet.id} falhou:`, e.message);
        }
      }
      console.log('[backfill] concluído');
    })();
  })
);

// ============================================================================
// PREMIUM — status, assinar, controle de uso de busca por IA
// ============================================================================
const AI_SEARCH_MONTHLY_LIMIT = 5;

app.get(
  '/user/:userId/premium/status',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_premium, premium_expires_at')
      .eq('id', userId)
      .maybeSingle();

    const { data: settings } = await supabase
      .from('user_settings')
      .select('ai_searches_this_month, ai_searches_reset_month, premium_reward_min_amount, premium_reward_max_amount, premium_reward_alert_enabled, premium_highlight_on_map')
      .eq('user_id', userId)
      .maybeSingle();

    const now = new Date();
    const isPremium =
      profile?.is_premium === true &&
      (!profile.premium_expires_at || new Date(profile.premium_expires_at) > now);

    if (profile?.is_premium && profile.premium_expires_at && new Date(profile.premium_expires_at) <= now) {
      await supabase.from('profiles').update({ is_premium: false }).eq('id', userId);
    }

    const currentMonth = now.toISOString().slice(0, 7);
    let searchesThisMonth = settings?.ai_searches_this_month ?? 0;
    if (settings?.ai_searches_reset_month !== currentMonth) searchesThisMonth = 0;

    const { data: sub } = await supabase
      .from('premium_subscriptions')
      .select('plan_type, starts_at, expires_at, status')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .maybeSingle();

    res.json({
      isPremium,
      expiresAt: profile?.premium_expires_at ?? null,
      plan: sub?.plan_type ?? null,
      aiSearchesLeft: isPremium ? null : Math.max(0, AI_SEARCH_MONTHLY_LIMIT - searchesThisMonth),
      aiSearchesUsed: searchesThisMonth,
      aiSearchesLimit: AI_SEARCH_MONTHLY_LIMIT,
      premiumSettings: {
        rewardMinAmount: Number(settings?.premium_reward_min_amount ?? 0),
        rewardMaxAmount: settings?.premium_reward_max_amount != null ? Number(settings.premium_reward_max_amount) : null,
        alertEnabled: settings?.premium_reward_alert_enabled ?? true,
        highlightOnMap: settings?.premium_highlight_on_map ?? true,
      },
    });
  })
);

app.post(
  '/user/:userId/premium/subscribe',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { planType = 'monthly' } = req.body ?? {};

    if (!['monthly', 'lifetime'].includes(planType)) {
      return res.status(400).json({ error: 'planType deve ser monthly ou lifetime' });
    }

    const PRICE = 9.90;
    const expiresAt = planType === 'lifetime'
      ? null
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: sub, error: subErr } = await supabase
      .from('premium_subscriptions')
      .insert({
        user_id: userId,
        plan_type: planType,
        amount: PRICE,
        payment_method: 'simulated',
        payment_id: `sim_${Date.now()}`,
        status: 'active',
        starts_at: new Date().toISOString(),
        expires_at: expiresAt,
      })
      .select()
      .single();
    if (subErr) throw subErr;

    await supabase
      .from('profiles')
      .update({ is_premium: true, premium_expires_at: expiresAt })
      .eq('id', userId);

    await supabase.from('notifications').insert({
      user_id: userId,
      title: 'Bem-vindo ao Premium! ⭐',
      body: planType === 'lifetime'
        ? 'Seu plano vitalício está ativo. Aproveite buscas ilimitadas e alertas prioritários!'
        : 'Seu plano mensal está ativo por 30 dias. Aproveite todas as vantagens Premium!',
      type: 'premium_activated',
    });

    res.status(201).json({ success: true, subscription: sub, isPremium: true, expiresAt });
  })
);

app.post(
  '/user/:userId/ai-search/use',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_premium, premium_expires_at')
      .eq('id', userId)
      .maybeSingle();

    const isPremium =
      profile?.is_premium === true &&
      (!profile.premium_expires_at || new Date(profile.premium_expires_at) > new Date());

    if (isPremium) {
      return res.json({ allowed: true, isPremium: true, aiSearchesLeft: null });
    }

    const currentMonth = new Date().toISOString().slice(0, 7);

    const { data: settings } = await supabase
      .from('user_settings')
      .select('ai_searches_this_month, ai_searches_reset_month')
      .eq('user_id', userId)
      .maybeSingle();

    let searchesThisMonth = settings?.ai_searches_this_month ?? 0;
    if (settings?.ai_searches_reset_month !== currentMonth) searchesThisMonth = 0;

    if (searchesThisMonth >= AI_SEARCH_MONTHLY_LIMIT) {
      return res.status(402).json({
        allowed: false,
        error: 'Limite mensal de buscas atingido',
        aiSearchesLeft: 0,
        aiSearchesUsed: searchesThisMonth,
        aiSearchesLimit: AI_SEARCH_MONTHLY_LIMIT,
      });
    }

    await supabase.from('user_settings').upsert({
      user_id: userId,
      ai_searches_this_month: searchesThisMonth + 1,
      ai_searches_reset_month: currentMonth,
    });

    const newLeft = AI_SEARCH_MONTHLY_LIMIT - (searchesThisMonth + 1);
    res.json({ allowed: true, isPremium: false, aiSearchesLeft: newLeft, aiSearchesUsed: searchesThisMonth + 1 });
  })
);

app.post(
  '/user/:userId/premium/settings',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { rewardMinAmount, rewardMaxAmount, alertEnabled, highlightOnMap } = req.body ?? {};

    const patch: Record<string, unknown> = { user_id: userId };
    if (rewardMinAmount !== undefined) patch.premium_reward_min_amount = rewardMinAmount;
    if (rewardMaxAmount !== undefined) patch.premium_reward_max_amount = rewardMaxAmount;
    if (alertEnabled !== undefined) patch.premium_reward_alert_enabled = alertEnabled;
    if (highlightOnMap !== undefined) patch.premium_highlight_on_map = highlightOnMap;

    const { data, error } = await supabase
      .from('user_settings')
      .upsert(patch)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  })
);

// ============================================================================
// SIGHTINGS — avistamentos (base para IA futura)
// ============================================================================
app.post(
  '/sightings',
  requireUser,
  asyncHandler(async (req, res) => {
    const finderId = authedId(req);
    const { petId, latitude, longitude, photo_url, message, ai_match_score } = req.body ?? {};
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ error: 'latitude e longitude obrigatórios' });
    }

    const { data, error } = await supabase
      .from('sightings')
      .insert({ finder_id: finderId, pet_id: petId, latitude, longitude, photo_url, message, ai_match_score })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  })
);

// ============================================================================
// IA — contato com o dono a partir de um match (cria chat vinculado ao alerta)
// O finder publicou um visto/resgatado (sourcePetId) e quer falar com o tutor
// do pet perdido (petId), enviando seu alerta como referência.
// ============================================================================
app.post(
  '/pets/:petId/contact-owner',
  requireUser,
  asyncHandler(async (req, res) => {
    const finderId = authedId(req);
    const { petId } = req.params; // pet PERDIDO (possível dono)
    const { sourcePetId } = req.body ?? {};
    if (!sourcePetId) return res.status(400).json({ error: 'sourcePetId obrigatório' });

    const { data: lost } = await supabase
      .from('pets').select('id, user_id, name, status, type').eq('id', petId).single();
    if (!lost) return res.status(404).json({ error: 'Pet não encontrado' });
    if (lost.user_id === finderId) return res.status(400).json({ error: 'Você é o tutor deste alerta' });

    const { data: src } = await supabase
      .from('pets').select('id, user_id, type, name').eq('id', sourcePetId).single();
    if (!src || src.user_id !== finderId) return res.status(403).json({ error: 'Alerta de origem inválido' });
    if (!['sighted', 'rescued'].includes(src.type)) {
      return res.status(400).json({ error: 'A origem deve ser um alerta de visto ou resgatado' });
    }

    let chat: any;
    try {
      chat = await getOrCreateChat(petId, finderId, lost.user_id);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }

    // Vincula o alerta + mensagem inicial + notificação apenas na 1ª vez.
    if (!chat.source_pet_id) {
      const { error: linkErr } = await supabase
        .from('chats').update({ source_pet_id: sourcePetId }).eq('id', chat.id);
      if (linkErr) throw linkErr;
      const verb = src.type === 'rescued' ? 'resgatei' : 'vi';
      await supabase.from('messages').insert({
        chat_id: chat.id,
        sender_id: finderId,
        content: `Olá! Acho que ${verb} o seu pet 🐾. Veja meu alerta para conferir se é ele.`,
      });
      await supabase.from('notifications').insert({
        user_id: lost.user_id,
        title: 'Possível avistamento do seu pet 🐾',
        body: `Alguém ${src.type === 'rescued' ? 'resgatou' : 'viu'} um pet parecido com ${lost.name}. Veja no chat.`,
        type: 'sighting_match',
        pet_id: petId,
        chat_id: chat.id,
      });
    }

    res.status(201).json({ chatId: chat.id, petId, tutorId: lost.user_id, sourcePetId });
  })
);

// IA — "É o meu pet" (claim): o TUTOR de um pet perdido reivindica um pet
// visto/resgatado. A conversa acontece SEMPRE no chat do caso (pet perdido),
// reutilizando se já existir. petId = pet visto/resgatado; body.lostPetId = o
// pet perdido do tutor.
app.post(
  '/pets/:petId/claim',
  requireUser,
  asyncHandler(async (req, res) => {
    const tutorId = authedId(req);
    const { petId } = req.params; // pet VISTO/RESGATADO
    const { lostPetId } = req.body ?? {};
    if (!lostPetId) return res.status(400).json({ error: 'lostPetId obrigatório' });

    const { data: sighted } = await supabase
      .from('pets').select('id, user_id, type, status').eq('id', petId).single();
    if (!sighted) return res.status(404).json({ error: 'Pet não encontrado' });
    if (!['sighted', 'rescued'].includes(sighted.type)) {
      return res.status(400).json({ error: 'Este pet não é um avistamento' });
    }
    if (sighted.user_id === tutorId) return res.status(400).json({ error: 'Este alerta é seu' });

    const { data: lost } = await supabase
      .from('pets').select('id, user_id, name, type').eq('id', lostPetId).single();
    if (!lost || lost.user_id !== tutorId) return res.status(403).json({ error: 'Pet perdido inválido' });
    if (lost.type !== 'lost') return res.status(400).json({ error: 'Selecione um alerta de pet perdido seu' });

    const publisherId = sighted.user_id; // quem viu/resgatou
    let chat: any;
    try {
      // Chat do CASO (pet perdido): tutor = dono do perdido; finder = quem viu.
      chat = await getOrCreateChat(lostPetId, publisherId, tutorId);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }

    if (!chat.source_pet_id) {
      const { error: linkErr } = await supabase
        .from('chats').update({ source_pet_id: petId }).eq('id', chat.id);
      if (linkErr) throw linkErr;
      const verb = sighted.type === 'rescued' ? 'resgatou' : 'viu';
      await supabase.from('messages').insert({
        chat_id: chat.id,
        sender_id: tutorId,
        content: `Acho que o pet que você ${verb} é o meu 🐾 (${lost.name}). Pode conferir?`,
      });
      await supabase.from('notifications').insert({
        user_id: publisherId,
        title: 'Alguém reconheceu o pet 🐾',
        body: `Um tutor acha que o pet que você ${verb} é o dele.`,
        type: 'sighting_claim',
        pet_id: lostPetId,
        chat_id: chat.id,
      });
    }

    res.status(201).json({ chatId: chat.id, petId: lostPetId, tutorId, finderId: publisherId });
  })
);

// Avistamentos CONFIRMADOS de um pet (timeline/trilha no mapa), em ordem
// cronológica. Inclui o local do avistamento + data + foto.
app.get(
  '/pets/:petId/sightings',
  requireUser,
  asyncHandler(async (req, res) => {
    const { petId } = req.params;
    const { data, error } = await supabase
      .from('sightings')
      .select('id, latitude, longitude, photo_url, created_at, source_pet_id, finder_id')
      .eq('pet_id', petId)
      .eq('confirmed_by_tutor', true)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data ?? []);
  })
);

// Metadados do chat (para o app mostrar o card do alerta relacionado e o botão
// de confirmar do tutor). Retorna source_pet_id + papéis.
app.get(
  '/pets/:petId/chat-meta',
  requireUser,
  asyncHandler(async (req, res) => {
    const me = authedId(req);
    const { petId } = req.params;
    const otherId = String(req.query.otherId ?? '');
    if (!otherId) return res.status(400).json({ error: 'otherId obrigatório' });

    const { data: pet } = await supabase.from('pets').select('user_id').eq('id', petId).single();
    if (!pet) return res.status(404).json({ error: 'Pet não encontrado' });
    const finderId = me === pet.user_id ? otherId : me;

    const { data: chat } = await supabase
      .from('chats')
      .select('id, source_pet_id, tutor_id, finder_id')
      .eq('pet_id', petId)
      .eq('finder_id', finderId)
      .maybeSingle();
    res.json(chat ?? null);
  })
);

// ============================================================================
// IA — tutor confirma que o alerta de visto/resgatado é o seu pet.
// Cria o avistamento no caso (timeline) e tira o pin do mapa ativo.
// ============================================================================
app.post(
  '/sightings/confirm',
  requireUser,
  asyncHandler(async (req, res) => {
    const tutorId = authedId(req);
    const { chatId } = req.body ?? {};
    if (!chatId) return res.status(400).json({ error: 'chatId obrigatório' });

    const { data: chat } = await supabase
      .from('chats')
      .select('id, pet_id, tutor_id, finder_id, source_pet_id')
      .eq('id', chatId)
      .single();
    if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });
    if (chat.tutor_id !== tutorId) return res.status(403).json({ error: 'Apenas o tutor pode confirmar' });
    if (!chat.source_pet_id) return res.status(400).json({ error: 'Este chat não tem alerta relacionado' });

    const { data: src } = await supabase
      .from('pets')
      .select('id, type, latitude, longitude, main_photo_url, status')
      .eq('id', chat.source_pet_id)
      .single();
    if (!src) return res.status(404).json({ error: 'Alerta de origem não encontrado' });

    // Evita duplicar o mesmo avistamento no caso
    const { data: existing } = await supabase
      .from('sightings')
      .select('id')
      .eq('pet_id', chat.pet_id)
      .eq('source_pet_id', src.id)
      .maybeSingle();

    let sighting = existing;
    if (!existing) {
      const { data: created, error } = await supabase
        .from('sightings')
        .insert({
          pet_id: chat.pet_id,
          finder_id: chat.finder_id,
          latitude: src.latitude,
          longitude: src.longitude,
          photo_url: src.main_photo_url,
          source_pet_id: src.id,
          confirmed_by_tutor: true,
          message: 'Avistamento confirmado pelo tutor',
        })
        .select()
        .single();
      if (error) throw error;
      sighting = created;
    }

    // O pin do visto/resgatado sai do mapa público (vinculado ao caso)
    if (src.status === 'ativo') {
      await supabase.from('pets').update({ status: 'encontrado' }).eq('id', src.id);
    }

    // ---- RESGATE: a confirmação do tutor JÁ conclui o caso ----------------
    // Diferente do avistamento (que só entra na linha do tempo), o resgate
    // relaciona o resgate ao caso, ENCERRA o caso e LIBERA a recompensa numa
    // única confirmação.
    if (src.type === 'rescued') {
      const finderId = chat.finder_id;
      const { data: lostPet } = await supabase
        .from('pets').select('id, name, status').eq('id', chat.pet_id).single();
      let rewardAmount = 0;

      if (lostPet && lostPet.status === 'ativo') {
        // 1. Encerra o caso (pet perdido)
        await supabase.from('pets').update({ status: 'encontrado' }).eq('id', chat.pet_id);
        // 2. Encerra os chats do caso
        await supabase.from('chats')
          .update({ status: 'closed', found: true, closed_at: new Date().toISOString() })
          .eq('id', chat.id);
        await supabase.from('chats')
          .update({ status: 'closed', found: false, closed_at: new Date().toISOString() })
          .eq('pet_id', chat.pet_id).eq('status', 'open');
        // 3. Libera recompensa (se houver) para quem resgatou
        const { data: reward } = await supabase
          .from('rewards').select('id, amount, status, payer_user_id')
          .eq('pet_id', chat.pet_id).in('status', ['pending', 'locked']).maybeSingle();
        if (reward) {
          rewardAmount = Number(reward.amount);
          await supabase.from('rewards')
            .update({ status: 'paid', finder_user_id: finderId, paid_at: new Date().toISOString() })
            .eq('id', reward.id);
          const { error: payoutErr } = await supabase.rpc('reward_payout', { p_user_id: finderId, p_amount: rewardAmount });
          if (payoutErr) throw payoutErr;
          const petName1 = lostPet?.name ?? 'Pet';
          await supabase.from('transactions').insert([
            { user_id: finderId, type: 'reward_received', amount: rewardAmount, reward_id: reward.id, pet_id: chat.pet_id, description: `Recompensa recebida - Caso ${petName1}` },
            { user_id: reward.payer_user_id, type: 'escrow_release', amount: -rewardAmount, reward_id: reward.id, pet_id: chat.pet_id, description: `Liberação de recompensa - Caso ${petName1}` },
          ]);
        } else {
          await supabase.rpc('profile_increment_rescues', { p_user_id: finderId });
        }
      }

      // Mensagem de sistema + notificação de resgate
      await supabase.from('messages').insert({
        chat_id: chat.id, sender_id: tutorId,
        content: '🏆 Resgate confirmado pelo tutor! O caso foi encerrado.',
        system: true,
      });
      await supabase.from('notifications').insert({
        user_id: finderId,
        title: 'Resgate confirmado! 🎉',
        body: rewardAmount > 0
          ? `Recompensa de R$ ${rewardAmount.toFixed(2)} adicionada à sua carteira.`
          : 'Obrigado por resgatar e devolver o pet!',
        type: 'rescue_confirmed', pet_id: chat.pet_id, chat_id: chat.id,
      });

      return res.json({ success: true, sighting, sourceType: src.type, rescued: true, reward: rewardAmount });
    }

    // ---- AVISTAMENTO: apenas entra na linha do tempo do caso ---------------
    await supabase.from('messages').insert({
      chat_id: chat.id,
      sender_id: tutorId,
      content: '✅ O tutor confirmou que é o pet dele. Avistamento adicionado ao caso.',
      system: true,
    });
    await supabase.from('notifications').insert({
      user_id: chat.finder_id,
      title: 'O tutor confirmou! 🎉',
      body: 'O tutor confirmou que o pet que você reportou é o dele. Obrigado por ajudar!',
      type: 'sighting_confirmed',
      pet_id: chat.pet_id,
      chat_id: chat.id,
    });

    res.json({ success: true, sighting, sourceType: src.type, rescued: false });
  })
);

// ============================================================================
// REPORTS — denúncia de usuário dentro de um chat
// ============================================================================
app.post(
  '/reports',
  requireUser,
  asyncHandler(async (req, res) => {
    const reporterId = authedId(req);
    const { reportedId, chatId, petId, reason } = req.body ?? {};

    if (!reportedId || !String(reason ?? '').trim()) {
      return res.status(400).json({ error: 'reportedId e reason são obrigatórios' });
    }
    if (reporterId === reportedId) {
      return res.status(400).json({ error: 'Você não pode denunciar a si mesmo' });
    }

    // Impede denúncias duplicadas pendentes do mesmo par
    const { data: existing } = await supabase
      .from('reports')
      .select('id')
      .eq('reporter_id', reporterId)
      .eq('reported_id', reportedId)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Você já tem uma denúncia pendente para este usuário' });
    }

    const { data, error } = await supabase
      .from('reports')
      .insert({
        reporter_id: reporterId,
        reported_id: reportedId,
        chat_id:     chatId  ?? null,
        pet_id:      petId   ?? null,
        reason:      String(reason).trim(),
        status:      'pending',
      })
      .select('id')
      .single();

    if (error) throw error;

    res.json({ success: true, id: data.id });
  })
);

// ============================================================================
// REPORTS — denúncia de alerta de pet inapropriado
// Ao atingir REPORTS_TO_PAUSE denúncias, o alerta é pausado, enviado para
// análise do admin e o tutor é notificado.
// ============================================================================
app.post(
  '/pets/:petId/report',
  requireUser,
  asyncHandler(async (req, res) => {
    const { petId } = req.params;
    const userId = authedId(req);
    const { reason } = req.body ?? {};

    const trimmedReason = String(reason ?? '').trim();
    if (!trimmedReason) return res.status(400).json({ error: 'Motivo da denúncia obrigatório' });

    const { data: pet, error: petErr } = await supabase
      .from('pets')
      .select('id, user_id, name, status')
      .eq('id', petId)
      .single();
    if (petErr || !pet) return res.status(404).json({ error: 'Pet não encontrado' });
    if (pet.user_id === userId) return res.status(400).json({ error: 'Você não pode denunciar o seu próprio alerta' });
    if (pet.status !== 'ativo') return res.status(400).json({ error: 'Este alerta não está ativo' });

    // Uma denúncia por usuário por alerta (evita inflar a contagem)
    const { data: existing } = await supabase
      .from('reports')
      .select('id')
      .eq('pet_id', petId)
      .eq('reporter_id', userId)
      .maybeSingle();
    if (existing) return res.status(409).json({ error: 'Você já denunciou este alerta' });

    const { error: insErr } = await supabase.from('reports').insert({
      reporter_id: userId,
      reported_id: pet.user_id,
      pet_id: petId,
      reason: trimmedReason.slice(0, 500),
      status: 'pending',
    });
    if (insErr) throw insErr;

    const { count } = await supabase
      .from('reports')
      .select('id', { count: 'exact', head: true })
      .eq('pet_id', petId);
    const reportsCount = count ?? 0;

    let paused = false;
    if (reportsCount >= REPORTS_TO_PAUSE) {
      await supabase.from('pets').update({ status: 'pausado' }).eq('id', petId);

      // Marca as denúncias como em análise pelo admin
      await supabase
        .from('reports')
        .update({ status: 'reviewing' })
        .eq('pet_id', petId)
        .eq('status', 'pending');

      // Notifica o tutor
      await supabase.from('notifications').insert({
        user_id: pet.user_id,
        title: 'Alerta pausado para análise',
        body: `O alerta de ${pet.name} recebeu várias denúncias e foi pausado. Nossa equipe vai analisá-lo em breve.`,
        type: 'pet_paused',
        pet_id: petId,
      });
      paused = true;
    }

    res.status(201).json({ success: true, reportsCount, paused });
  })
);

// ============================================================================
// RATINGS — avaliação do buscador pelo tutor após resgate
// ============================================================================
app.post(
  '/ratings',
  requireUser,
  asyncHandler(async (req, res) => {
    const raterId = authedId(req);
    const { petId, ratedId, score, comment } = req.body ?? {};

    const s = Number(score);
    if (!petId || !ratedId || !Number.isFinite(s) || s < 1 || s > 5) {
      return res.status(400).json({ error: 'petId, ratedId e score (1–5) são obrigatórios' });
    }
    if (raterId === ratedId) {
      return res.status(400).json({ error: 'Você não pode avaliar a si mesmo' });
    }

    const { error: insertError } = await supabase.from('ratings').insert({
      pet_id:   petId,
      rater_id: raterId,
      rated_id: ratedId,
      score:    s,
      comment:  comment?.trim() || null,
    });
    if (insertError) {
      if (insertError.code === '23505') {
        return res.status(409).json({ error: 'Você já avaliou este buscador para este caso' });
      }
      throw insertError;
    }

    // Recalcula média de rating do buscador avaliado
    const { data: allRatings } = await supabase
      .from('ratings')
      .select('score')
      .eq('rated_id', ratedId);

    if (allRatings && allRatings.length > 0) {
      const avg = allRatings.reduce((sum, r) => sum + Number(r.score), 0) / allRatings.length;
      await supabase.from('profiles').update({ rating: Number(avg.toFixed(2)) }).eq('id', ratedId);
    }

    res.json({ success: true });
  })
);

// ============================================================================
// SUPPORT — chat de suporte com IA + tickets para o painel admin
// ============================================================================

// Cliente Anthropic criado sob demanda no handler para sempre ler o env atual
function makeAnthropic() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada no .env do backend');
  return new Anthropic({ apiKey });
}

const SUPPORT_SYSTEM_PROMPT = `Você é o assistente virtual do PetPerdidoSOS, um aplicativo mobile brasileiro para encontrar pets perdidos. Responda SEMPRE em português do Brasil, de forma amigável, empática e objetiva. Seja breve e direto.

## SOBRE O APP
PetPerdidoSOS conecta tutores de pets perdidos com buscadores voluntários da região. Disponível para Android.

## FUNCIONALIDADES

**Mapa principal:**
- Mostra pets perdidos próximos com marcadores de foto circular
- Filtro de raio: 1km, 5km, 10km, 25km, 50km, personalizado ou Brasil inteiro — toque na barra de busca no topo
- Toque 1× no marcador para ver o card resumido; toque 2× para abrir detalhes completos
- Botão "Rota" no card traça o caminho a pé até o pet diretamente no mapa
- Botão de seta (canto inferior direito) ativa modo seguir: mapa inclinado estilo Waze com bússola
- Alterne mapa normal / satélite / terreno pelo botão acima da seta
- Ícones de pegada = buscadores online na sua região

**Cadastrar pet perdido:**
- Perfil → seus alertas → botão "+" — ou pela aba Chats
- Preencha nome, espécie, raça, cor, porte, data, localização e fotos
- Opcional: adicione recompensa em dinheiro (fica em garantia até o resgate)

**Encontrei um pet (IA):**
- Botão vermelho "Encontrei um pet" no mapa
- Tire ou envie foto do pet encontrado
- A IA compara com os pets cadastrados e mostra os mais parecidos
- Inicie conversa com o tutor pelo chat

**Chat:**
- Converse com o tutor diretamente pelo app
- Tutor confirma o resgate pelo chat → recompensa liberada automaticamente
- Após resgate, tutor avalia o buscador com 1 a 5 estrelas
- É possível denunciar usuários pelo botão de flag no perfil do chat

**Recompensas e Carteira:**
- Recompensa fica em garantia (escrow) até o resgate ser confirmado
- Taxa de serviço: 10% sobre o valor da recompensa
- Buscador recebe o valor na carteira do app
- Acesse: Perfil → Carteira e Saques para ver saldo e solicitar saque

**Premium (R$ 9,90/mês):**
- Reconhecimentos de IA ilimitados (plano grátis tem limite)
- Destaque no mapa com emblema dourado
- Assine em Perfil → Premium

**Configurações:**
- Perfil → Configurações: visibilidade no mapa, cor do pin, notificações

## COMO RESPONDER
- Seja empático: pets perdidos são situações estressantes para o tutor
- Respostas curtas e práticas; use listas quando ajudar
- Se não souber algo, diga honestamente
- Para problemas graves (bug, cobrança errada, conta bloqueada, saque não chegou): recomende abrir um ticket de suporte tocando no botão "Abrir ticket" no topo desta tela
- Nunca invente funcionalidades que não estão documentadas acima`;

// Prompt para a IA sugerir ao operador humano uma resposta de chamado.
// Reaproveita o conhecimento do app acima e redefine o papel: redigir um
// rascunho de resposta que pareça escrito por um atendente humano de verdade.
const TICKET_SUGGESTION_SYSTEM_PROMPT = `${SUPPORT_SYSTEM_PROMPT}

---
## MODO ATENDENTE DE SUPORTE
Desconsidere a instrução acima sobre "abrir ticket": o usuário JÁ abriu um chamado e agora você ajuda a EQUIPE DE SUPORTE a respondê-lo.

Sua tarefa: ler o chamado e a conversa e escrever uma SUGESTÃO DE RESPOSTA que um atendente humano vai revisar e enviar ao usuário.

ESCREVA COMO UMA PESSOA DE VERDADE conversando pelo chat — nunca como um robô nem como uma carta formal:
- Tom caloroso, próximo e natural, em português do Brasil do dia a dia (educado, sem ser empolado). É um papo de chat num app de celular.
- Cumprimente pelo primeiro nome quando ele for informado (ex.: "Oi, Ana! Tudo bem?").
- Vá direto ao ponto, com frases curtas. Quase sempre 1 a 3 parágrafos curtos bastam.
- Mostre que você LEU a conversa: cite o problema específico da pessoa, nada de resposta genérica.
- Fale na 1ª pessoa ("eu vi aqui", "vou verificar isso pra você", "me conta uma coisa") — soa muito mais humano.
- No máximo um emoji, e só se encaixar com naturalidade.

EVITE tudo que soa robótico ou corporativo:
- Clichês: "Agradecemos imensamente o seu contato", "Prezado(a)", "Estamos à inteira disposição", "Conforme solicitado", "Informamos que".
- Linguagem empolada, jurídica ou cheia de jargão.
- Listas e tópicos quando um texto corrido resolve — só use lista se forem passos de verdade.
- Frases de empatia decoradas e repetidas; a empatia precisa soar genuína e específica.
- Dizer que você é uma IA ou assistente virtual.

Não invente políticas, prazos ou valores. Se faltar informação para resolver, peça o dado ou explique o próximo passo de forma simples.
Responda APENAS com o texto da mensagem ao usuário — sem preâmbulo ("aqui está...") e sem assinatura no final.`;

// Obtém ou cria a conversa de suporte ativa do usuário
app.post(
  '/support/conversation',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);

    // Reutiliza conversa aberta existente
    let { data: conv } = await supabase
      .from('support_conversations')
      .select('id, status')
      .eq('user_id', userId)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conv) {
      const { data: newConv, error } = await supabase
        .from('support_conversations')
        .insert({ user_id: userId })
        .select('id, status')
        .single();
      if (error) throw error;
      conv = newConv;

      // Mensagem de boas-vindas automática
      await supabase.from('support_messages').insert({
        conversation_id: conv.id,
        role: 'assistant',
        content:
          'Olá! 👋 Sou o assistente virtual do PetPerdidoSOS.\n\nPosso te ajudar com dúvidas sobre como usar o app: cadastrar pets, recompensas, carteira, reconhecimento por IA e muito mais.\n\nSe o problema não for resolvido aqui, use o botão **Abrir ticket** no topo para acionar nossa equipe. Como posso ajudar?',
      });
    }

    const { data: messages } = await supabase
      .from('support_messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true });

    res.json({ conversation: conv, messages: messages ?? [] });
  })
);

// Envia mensagem do usuário e retorna resposta da IA
app.post(
  '/support/message',
  aiLimiter,
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { conversationId, message } = req.body ?? {};
    if (!conversationId || !message?.trim()) {
      return res.status(400).json({ error: 'conversationId e message são obrigatórios' });
    }

    // Garante que a conversa pertence ao usuário
    const { data: conv } = await supabase
      .from('support_conversations')
      .select('id, status')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });

    // Salva mensagem do usuário
    await supabase.from('support_messages').insert({
      conversation_id: conversationId,
      role: 'user',
      content: message.trim(),
    });

    // Com um ticket aberto, a conversa é atendida pela equipe humana — a
    // mensagem fica salva para o admin responder e a IA não é acionada.
    if (conv.status === 'ticket_created') {
      return res.json({ message: null });
    }

    // Busca as ÚLTIMAS 30 mensagens para contexto. Ordena DESC + limit pega
    // as mais RECENTES (incl. a que o usuário acabou de enviar); depois
    // reverte para ordem cronológica. Com ascending+limit pegava as 30 mais
    // ANTIGAS e cortava a pergunta atual — o histórico terminava numa msg
    // 'assistant' e o Claude respondia vazio (tratava como prefill).
    const { data: historyDesc } = await supabase
      .from('support_messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(30);
    const history = (historyDesc ?? []).reverse();

    // Monta o histórico para a IA:
    // 1) remove mensagens de erro/fallback (começam com ⚠️) que poluíam o
    //    contexto e faziam a IA só "pedir desculpas" em vez de responder;
    // 2) descarta mensagens 'assistant' no início — a API exige começar com
    //    'user' (inclui a saudação automática da conversa);
    // 3) mescla turnos consecutivos do mesmo papel (API espera alternância).
    const cleaned = (history ?? [])
      .filter((m: any) => typeof m.content === 'string' && m.content.trim())
      .filter((m: any) => !(m.role === 'assistant' && m.content.startsWith('⚠️')));

    while (cleaned.length && cleaned[0].role === 'assistant') cleaned.shift();

    const aiMessages: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const m of cleaned) {
      const last = aiMessages[aiMessages.length - 1];
      if (last && last.role === m.role) {
        last.content += '\n\n' + m.content;
      } else {
        aiMessages.push({ role: m.role as 'user' | 'assistant', content: m.content as string });
      }
    }

    // Defesa: a conversa precisa terminar com 'user'. Se terminar em
    // 'assistant', o Claude trata como prefill e responde vazio.
    while (aiMessages.length > 1 && aiMessages[aiMessages.length - 1].role === 'assistant') {
      aiMessages.pop();
    }

    // Chama Claude
    let assistantText = '';
    console.log('[support/message] chamando Anthropic, key presente:', !!process.env.ANTHROPIC_API_KEY, 'msgs:', aiMessages.length);
    try {
      const aiResponse = await makeAnthropic().messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        system: SUPPORT_SYSTEM_PROMPT,
        messages: aiMessages,
      });
      console.log('[support/message] Anthropic ok, stop_reason:', aiResponse.stop_reason);
      assistantText =
        aiResponse.content[0]?.type === 'text' ? aiResponse.content[0].text : '';
    } catch (aiErr: any) {
      // NÃO salva o erro como mensagem da IA — isso poluía o histórico.
      // Retorna erro para o app, que mostra um alerta e mantém a conversa limpa.
      console.error('[support/message] Anthropic error:', aiErr?.message ?? aiErr);
      return res.status(502).json({ error: 'Assistente indisponível no momento. Tente novamente.' });
    }

    if (!assistantText.trim()) {
      return res.status(502).json({ error: 'Não foi possível gerar uma resposta. Tente novamente.' });
    }

    // Salva resposta da IA
    const { data: savedMsg } = await supabase
      .from('support_messages')
      .insert({ conversation_id: conversationId, role: 'assistant', content: assistantText })
      .select('id, role, content, created_at')
      .single();

    res.json({ message: savedMsg });
  })
);

// Cria ticket de suporte (escalada para equipe humana)
app.post(
  '/support/ticket',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { conversationId, subject, description } = req.body ?? {};
    if (!subject?.trim()) {
      return res.status(400).json({ error: 'subject é obrigatório' });
    }

    // Impede duplicata por conversa
    if (conversationId) {
      const { data: existing } = await supabase
        .from('support_tickets')
        .select('id')
        .eq('conversation_id', conversationId)
        .maybeSingle();
      if (existing) return res.status(409).json({ error: 'Já existe um ticket para esta conversa' });
    }

    const { data: ticket, error } = await supabase
      .from('support_tickets')
      .insert({
        conversation_id: conversationId ?? null,
        user_id: userId,
        subject: subject.trim(),
        description: description?.trim() || null,
      })
      .select('id, subject, status, created_at')
      .single();
    if (error) throw error;

    // Atualiza status da conversa e adiciona mensagem de confirmação
    if (conversationId) {
      await supabase
        .from('support_conversations')
        .update({ status: 'ticket_created' })
        .eq('id', conversationId);

      await supabase.from('support_messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: `✅ Ticket **#${ticket.id.slice(0, 8).toUpperCase()}** aberto com sucesso!\n\nNossa equipe vai analisar sua solicitação e retornar em breve. Você pode continuar usando o app normalmente enquanto isso.`,
      });
    }

    res.json({ ticket });
  })
);

// Sugestão de resposta gerada por IA para o operador revisar (painel admin)
app.post(
  '/admin/tickets/:id/suggest-reply',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { data: ticket } = await supabase
      .from('support_tickets')
      .select('id, subject, description, conversation_id, user_id')
      .eq('id', id)
      .maybeSingle();
    if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado' });

    // Primeiro nome do usuário, para a resposta poder cumprimentá-lo
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', ticket.user_id)
      .maybeSingle();
    const firstName = ((profile?.full_name as string) ?? '').trim().split(/\s+/)[0] || '';

    let transcript = '';
    if (ticket.conversation_id) {
      const { data: msgs } = await supabase
        .from('support_messages')
        .select('role, content')
        .eq('conversation_id', ticket.conversation_id)
        .order('created_at', { ascending: true });
      transcript = (msgs ?? [])
        .map((m: { role: string; content: string }) => {
          const who =
            m.role === 'user' ? 'Usuário' : m.role === 'support' ? 'Suporte' : 'Assistente IA';
          return `${who}: ${m.content}`;
        })
        .join('\n\n');
    }

    const userPrompt = `CHAMADO
Nome do usuário: ${firstName || '(não informado)'}
Assunto: ${ticket.subject}
Descrição: ${ticket.description ?? '(sem descrição)'}

CONVERSA ATÉ AGORA:
${transcript || '(sem mensagens)'}

Escreva a sugestão de resposta para o usuário, soando como um atendente humano.`;

    let suggestion = '';
    try {
      const aiResponse = await makeAnthropic().messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        system: TICKET_SUGGESTION_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });
      suggestion = aiResponse.content[0]?.type === 'text' ? aiResponse.content[0].text : '';
    } catch (aiErr: any) {
      console.error('[tickets/suggest-reply] Anthropic error:', aiErr?.message ?? aiErr);
      return res
        .status(502)
        .json({ error: 'Assistente indisponível no momento. Tente novamente.' });
    }

    if (!suggestion.trim()) {
      return res.status(502).json({ error: 'Não foi possível gerar uma sugestão.' });
    }
    res.json({ suggestion: suggestion.trim() });
  })
);

// Lista os tickets de suporte do próprio usuário
app.get(
  '/support/user/:userId/tickets',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { data, error } = await supabase
      .from('support_tickets')
      .select('id, subject, description, status, admin_notes, conversation_id, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data ?? []);
  })
);

// Detalhe de um ticket + thread completa da conversa (somente o dono)
app.get(
  '/support/tickets/:ticketId',
  requireUser,
  asyncHandler(async (req, res) => {
    const { ticketId } = req.params;
    const userId = authedId(req);

    const { data: ticket, error } = await supabase
      .from('support_tickets')
      .select('id, user_id, subject, description, status, admin_notes, conversation_id, created_at, updated_at')
      .eq('id', ticketId)
      .maybeSingle();
    if (error) throw error;
    if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado' });
    if (ticket.user_id !== userId) return res.status(403).json({ error: 'Acesso negado' });

    let messages: unknown[] = [];
    if (ticket.conversation_id) {
      const { data: msgs } = await supabase
        .from('support_messages')
        .select('id, role, content, created_at')
        .eq('conversation_id', ticket.conversation_id)
        .order('created_at', { ascending: true });
      messages = msgs ?? [];
    }
    res.json({ ticket, messages });
  })
);

// ============================================================================
// ERROR HANDLER
// ============================================================================
app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[error]', err);
  const status = Number.isInteger(err.status) ? (err.status as number) : 500;
  // Não vaza detalhes internos (mensagens do Postgres, stack) ao cliente.
  res.status(status).json({ error: status === 500 ? 'Erro interno do servidor' : err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ PetPerdidoSOS backend rodando em http://0.0.0.0:${PORT}`);
  console.log(`  Health: http://localhost:${PORT}/health`);
});
