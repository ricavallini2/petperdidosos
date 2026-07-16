import './instrument.js'; // Sentry — precisa ser o primeiro import
import './env.js';
import * as Sentry from '@sentry/node';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import QRCode from 'qrcode';
import Anthropic from '@anthropic-ai/sdk';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { supabase } from './supabase.js';
import { haversineMeters } from './distance.js';
import { buildPixPayload } from './pix.js';
import { generateImageEmbedding, isEmbeddingEnabled } from './embedding.js';
import {
  generatePetVisionTags, isVisionTagsEnabled, attributeAgreement, hybridScore,
} from './vision.js';

const app = express();
app.set('trust proxy', 1); // atrás de proxy/LB — necessário para rate limit por IP

// Cabeçalhos de segurança HTTP. CSP: mantém os defaults do helmet, mas libera
// imagens https (fotos dos pets no Supabase Storage aparecem na página /doar).
// Scripts continuam 'self' — a página de doação usa app.js externo, sem inline.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'img-src': ["'self'", 'data:', 'https:'],
      },
    },
  })
);

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

// ============================================================================
// FLAG GLOBAL — PREMIUM
// ============================================================================
// DESATIVADO: o app é 100% gratuito (buscas por IA ilimitadas, sem paywall).
// No lugar, o app oferece a área "Apoie o app" (doação voluntária).
//
// Para reativar, volte para true — mas ANTES plugue um gateway de pagamento
// real: /premium/subscribe ainda grava payment_method 'simulated' e liberaria
// assinatura sem cobrar nada.
//
// Declarada aqui no topo (e não na seção PREMIUM, mais abaixo) porque também
// gateia a concessão de premium pelo admin (/admin/subscriptions/grant).
const PREMIUM_ENABLED = false;

// ============================================================================
// DISTRIBUIÇÃO DO APP (teste interno, fora da Play Store)
// Serve o APK e o manifesto de versão de um diretório (APP_RELEASE_DIR). Para
// lançar: suba o novo .apk e edite o version.json nesse diretório no VPS — sem
// redeploy do backend.
//   GET /app/version            -> { version, versionName, apkUrl, notes, mandatory }
//   GET /app/petperdidosos.apk  -> o APK em si
// Recomenda-se APP_RELEASE_DIR FORA do repositório (ex.: /root/petperdidosos-releases)
// para os deploys (git reset) nunca apagarem os arquivos.
// ============================================================================
const APP_RELEASE_DIR = process.env.APP_RELEASE_DIR
  ? path.resolve(process.env.APP_RELEASE_DIR)
  : path.resolve(process.cwd(), 'release');

app.get('/app/version', (_req, res) => {
  try {
    const raw = fs.readFileSync(path.join(APP_RELEASE_DIR, 'version.json'), 'utf8');
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/json').send(raw);
  } catch {
    res.status(204).end(); // sem manifesto -> o app entende "sem atualização"
  }
});

app.use(
  '/app',
  express.static(APP_RELEASE_DIR, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.apk')) {
        res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      }
    },
  })
);

// Documentos legais (exigidos pela Play Store/App Store): páginas públicas HTTPS.
const LEGAL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../legal');
app.get('/privacidade', (_req, res) => res.sendFile(path.join(LEGAL_DIR, 'privacidade.html')));
app.get('/termos', (_req, res) => res.sendFile(path.join(LEGAL_DIR, 'termos.html')));

const PORT = Number(process.env.PORT ?? 3005);

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

// Config global do reconhecimento por foto (limiar de similaridade + raio de busca).
async function getMatchConfig(): Promise<{ threshold: number; radiusM: number; strongThreshold: number }> {
  const { data } = await supabase
    .from('app_settings')
    .select('match_threshold, match_radius_m, match_strong_threshold')
    .eq('id', 1)
    .maybeSingle();
  const t = Number(data?.match_threshold);
  const r = Number(data?.match_radius_m);
  const s = Number(data?.match_strong_threshold);
  return {
    threshold: Number.isFinite(t) && t >= 0 && t <= 1 ? t : 0.80,
    radiusM: Number.isFinite(r) && r >= 100 ? r : 10000,
    strongThreshold: Number.isFinite(s) && s >= 0 && s <= 1 ? s : 0.86,
  };
}

// ============================================================================
// HEALTH
// ============================================================================
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Config pública de doação voluntária (Pix/link externos, editáveis no admin).
// Sem escrow: o app apenas exibe; nunca processa o pagamento.
app.get(
  '/config/donation',
  asyncHandler(async (_req, res) => {
    const { data } = await supabase
      .from('app_settings')
      .select('donation_pix_key, donation_url')
      .eq('id', 1)
      .maybeSingle();
    res.json({ pixKey: data?.donation_pix_key ?? null, url: data?.donation_url ?? null });
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
// SITE DE DOAÇÃO (/doar) — página pública + APIs abertas que a alimentam.
// A página estática vive em backend/public/doar e é servida pelo próprio
// Express: o deploy continua sendo git pull + pm2 restart, sem passo extra.
// ============================================================================
const DOAR_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/doar');
app.use(
  '/doar',
  express.static(DOAR_DIR, {
    index: 'index.html',
    maxAge: '1d', // assets (logo, js) podem cachear…
    setHeaders(res, filePath) {
      // …mas o HTML sempre revalida (atualizações da página valem na hora)
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

// Pix da doação: monta o BR Code ("copia e cola") + QR em SVG com o valor
// escolhido pelo doador. Transferência direta pra chave configurada no admin —
// o backend nunca toca no dinheiro.
app.get(
  '/public/donation/pix',
  asyncHandler(async (req, res) => {
    const { data } = await supabase
      .from('app_settings')
      .select('donation_pix_key')
      .eq('id', 1)
      .maybeSingle();
    const pixKey = (data?.donation_pix_key ?? '').trim();
    if (!pixKey) return res.status(503).json({ error: 'Doação por Pix ainda não configurada.' });

    const raw = Number(String(req.query.amount ?? '').replace(',', '.'));
    const amount = Number.isFinite(raw) ? Math.round(raw * 100) / 100 : 0;
    if (amount < 1 || amount > 50000) {
      return res.status(400).json({ error: 'Valor deve ser entre R$ 1,00 e R$ 50.000,00' });
    }

    const payload = buildPixPayload({
      key: pixKey,
      merchantName: 'PETPERDIDOSOS',
      merchantCity: 'SAO PAULO',
      amount,
    });
    const qrSvg = await QRCode.toString(payload, { type: 'svg', margin: 1, width: 320 });
    res.json({ amount, payload, qrSvg });
  })
);

// Estatísticas públicas do projeto (contadores exibidos no site de doação).
app.get(
  '/public/stats',
  asyncHandler(async (_req, res) => {
    const [reunited, adopted, active, users] = await Promise.all([
      supabase.from('pets').select('id', { count: 'exact', head: true }).eq('status', 'encontrado'),
      supabase.from('pets').select('id', { count: 'exact', head: true }).eq('status', 'doado'),
      supabase.from('pets').select('id', { count: 'exact', head: true }).eq('status', 'ativo'),
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
    ]);
    res.json({
      reunited: reunited.count ?? 0,
      adopted: adopted.count ?? 0,
      happyEndings: (reunited.count ?? 0) + (adopted.count ?? 0),
      activeAlerts: active.count ?? 0,
      users: users.count ?? 0,
    });
  })
);

// Casos de sucesso AUTORIZADOS pelo tutor — versão pública para o site.
// Privacidade: primeiro nome do tutor apenas; nenhuma foto de pessoa.
app.get(
  '/public/success-cases',
  asyncHandler(async (req, res) => {
    const limit = Math.min(24, Math.max(1, Number(req.query.limit ?? 12) || 12));
    const { data: cases } = await supabase
      .from('success_cases')
      .select(
        `id, pet_id, photo_url, message, created_at,
         pets ( name, type, main_photo_url, lost_date ),
         tutor:profiles!success_cases_tutor_id_fkey ( full_name )`
      )
      .eq('authorized', true)
      .order('created_at', { ascending: false })
      .limit(limit);

    const petIds = (cases ?? []).map((c: any) => c.pet_id);
    const closedByPet = new Map<string, string>();
    if (petIds.length) {
      const { data: chats } = await supabase
        .from('chats')
        .select('pet_id, closed_at')
        .eq('found', true)
        .in('pet_id', petIds);
      (chats ?? []).forEach((c: any) => {
        if (c.closed_at) closedByPet.set(c.pet_id, c.closed_at);
      });
    }

    res.json(
      (cases ?? []).map((c: any) => {
        const lost = c.pets?.lost_date ? new Date(c.pets.lost_date) : null;
        const foundIso = closedByPet.get(c.pet_id) ?? c.created_at;
        const days = lost
          ? Math.max(0, Math.round((new Date(foundIso).getTime() - lost.getTime()) / 86400000))
          : null;
        return {
          id: c.id,
          pet_name: c.pets?.name ?? 'Pet',
          pet_type: c.pets?.type ?? 'lost',
          photo_url: c.photo_url || c.pets?.main_photo_url || null,
          message: c.message,
          tutor_first_name: String(c.tutor?.full_name ?? '').trim().split(/\s+/)[0] || null,
          days_lost: days,
          concluded_at: foundIso,
        };
      })
    );
  })
);

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

// Registra uma ação administrativa no log de auditoria. Best-effort: nunca
// derruba a requisição principal se a gravação do log falhar.
type AdminInfo = { id?: string; email?: string; full_name?: string };
async function logAudit(
  req: Request,
  action: string,
  targetType: string | null,
  targetId: string | null,
  detail?: Record<string, unknown>
) {
  try {
    const admin = (req as Request & { admin?: AdminInfo }).admin ?? {};
    await supabase.from('admin_audit_log').insert({
      admin_id: admin.id ?? null,
      admin_email: admin.email ?? null,
      action,
      target_type: targetType,
      target_id: targetId,
      detail: detail ?? null,
    });
  } catch (e) {
    console.error('[audit] falha ao registrar', action, e);
  }
}

// Consulta do log de auditoria com filtros
app.get(
  '/admin/audit',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const action = str(req.query.action);
    const q = str(req.query.q);
    const from = str(req.query.from);
    const toRaw = str(req.query.to);
    const to = toRaw ? (toRaw.length === 10 ? `${toRaw}T23:59:59.999Z` : toRaw) : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    let query = supabase
      .from('admin_audit_log')
      .select('id, admin_email, action, target_type, target_id, detail, created_at', {
        count: 'exact',
      })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (action) query = query.eq('action', action);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);
    if (q) query = query.ilike('admin_email', `%${q}%`);

    const { data, count, error } = await query;
    if (error) throw error;
    res.json({ rows: data ?? [], total: count ?? 0 });
  })
);

// Lista de ações distintas (para o filtro do log)
app.get(
  '/admin/audit/actions',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const { data } = await supabase
      .from('admin_audit_log')
      .select('action')
      .order('action');
    const actions = [...new Set((data ?? []).map((r) => r.action as string))];
    res.json({ actions });
  })
);

// ----------------------------------------------------------------------------
// Ações em massa — aplica uma mudança de status a vários itens de uma vez
// ----------------------------------------------------------------------------
const asIdList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x).slice(0, 500) : [];

app.post(
  '/admin/tickets/bulk',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const ids = asIdList(req.body?.ids);
    const status = req.body?.status;
    if (!ids.length) return res.status(400).json({ error: 'Nenhum item selecionado' });
    if (!TICKET_STATUS.includes(status)) return res.status(400).json({ error: 'status inválido' });
    const { error } = await supabase
      .from('support_tickets')
      .update({ status, updated_at: new Date().toISOString() })
      .in('id', ids);
    if (error) throw error;
    await logAudit(req, 'ticket.bulk', 'ticket', null, { status, count: ids.length });
    res.json({ success: true, count: ids.length });
  })
);

app.post(
  '/admin/reports/bulk',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const ids = asIdList(req.body?.ids);
    const status = req.body?.status;
    if (!ids.length) return res.status(400).json({ error: 'Nenhum item selecionado' });
    if (!REPORT_STATUS.includes(status)) return res.status(400).json({ error: 'status inválido' });
    const { error } = await supabase.from('reports').update({ status }).in('id', ids);
    if (error) throw error;
    await logAudit(req, 'report.bulk', 'report', null, { status, count: ids.length });
    res.json({ success: true, count: ids.length });
  })
);

app.post(
  '/admin/pets/bulk',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const ids = asIdList(req.body?.ids);
    const status = req.body?.status;
    if (!ids.length) return res.status(400).json({ error: 'Nenhum item selecionado' });
    if (!PET_STATUS.includes(status)) return res.status(400).json({ error: 'status inválido' });
    const { error } = await supabase
      .from('pets')
      .update({ status, updated_at: new Date().toISOString() })
      .in('id', ids);
    if (error) throw error;
    await logAudit(req, 'pet.bulk', 'pet', null, { status, count: ids.length });
    res.json({ success: true, count: ids.length });
  })
);

// ----------------------------------------------------------------------------
// Broadcast — envia uma notificação para um público de usuários
// ----------------------------------------------------------------------------
const BROADCAST_AUDIENCES = ['all', 'premium', 'free'];

// Resolve os ids de usuários do público escolhido
async function resolveAudience(audience: string): Promise<string[]> {
  let q = supabase.from('profiles').select('id');
  if (audience === 'premium') q = q.eq('is_premium', true);
  else if (audience === 'free') q = q.eq('is_premium', false);
  const { data } = await q;
  return (data ?? []).map((p) => p.id as string);
}

app.get(
  '/admin/broadcast/preview',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const audience = String(req.query.audience ?? 'all');
    if (!BROADCAST_AUDIENCES.includes(audience)) {
      return res.status(400).json({ error: 'Público inválido' });
    }
    const ids = await resolveAudience(audience);
    res.json({ count: ids.length });
  })
);

app.post(
  '/admin/broadcast',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const audience = String(req.body?.audience ?? 'all');
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!BROADCAST_AUDIENCES.includes(audience)) {
      return res.status(400).json({ error: 'Público inválido' });
    }
    if (!title) return res.status(400).json({ error: 'O título é obrigatório' });

    const ids = await resolveAudience(audience);
    if (!ids.length) return res.json({ success: true, count: 0 });

    // Insere em lotes para não estourar limites de payload
    const rows = ids.map((user_id) => ({ user_id, title, body: body || null, type: 'broadcast' }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from('notifications').insert(rows.slice(i, i + 500));
      if (error) throw error;
    }

    await logAudit(req, 'broadcast.send', 'notification', null, {
      audience,
      count: ids.length,
      title,
    });
    res.json({ success: true, count: ids.length });
  })
);

// ----------------------------------------------------------------------------
// Administradores — gestão de quem tem acesso ao painel (is_admin)
// ----------------------------------------------------------------------------
app.get(
  '/admin/admins',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const { data: admins } = await supabase
      .from('profiles')
      .select('id, full_name, photo_url, created_at')
      .eq('is_admin', true)
      .order('created_at');
    const list = (admins ?? []) as Record<string, unknown>[];
    const { data: authData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const emailMap = new Map((authData?.users ?? []).map((u) => [u.id, u.email ?? null]));
    res.json({
      rows: list.map((a) => ({
        id: a.id,
        full_name: a.full_name,
        photo_url: a.photo_url,
        created_at: a.created_at,
        email: emailMap.get(a.id as string) ?? null,
      })),
    });
  })
);

// Promove um usuário a administrador (por userId)
app.post(
  '/admin/admins',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
    if (!userId) return res.status(400).json({ error: 'userId obrigatório' });

    const { data: target } = await supabase
      .from('profiles')
      .select('id, is_admin, full_name')
      .eq('id', userId)
      .maybeSingle();
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (target.is_admin) return res.status(400).json({ error: 'Este usuário já é administrador' });

    const { error } = await supabase.from('profiles').update({ is_admin: true }).eq('id', userId);
    if (error) throw error;
    await logAudit(req, 'admin.grant', 'user', userId, { name: target.full_name });
    res.json({ success: true });
  })
);

// Revoga o acesso de administrador
app.delete(
  '/admin/admins/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const me = (req as Request & { admin?: AdminInfo }).admin ?? {};
    if (id === me.id) {
      return res.status(400).json({ error: 'Você não pode revogar o seu próprio acesso' });
    }
    // Salvaguarda: nunca deixar o sistema sem nenhum admin
    const { count } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('is_admin', true);
    if ((count ?? 0) <= 1) {
      return res.status(400).json({ error: 'Não é possível revogar o último administrador' });
    }
    const { error } = await supabase.from('profiles').update({ is_admin: false }).eq('id', id);
    if (error) throw error;
    await logAudit(req, 'admin.revoke', 'user', id);
    res.json({ success: true });
  })
);

// ----------------------------------------------------------------------------
// Atualizações do app — publica um novo APK + version.json sem SSH manual
// ----------------------------------------------------------------------------
const APK_FILE = 'petperdidosos.apk';
const VERSION_FILE = 'version.json';
const PUBLIC_APK_URL = process.env.PUBLIC_APK_URL
  ? process.env.PUBLIC_APK_URL
  : 'https://api.imestredigital.cloud/app/petperdidosos.apk';

function readPublishedRelease(): {
  version: number;
  versionName: string;
  apkUrl: string;
  notes: string;
  mandatory: boolean;
} | null {
  try {
    const raw = fs.readFileSync(path.join(APP_RELEASE_DIR, VERSION_FILE), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Lê o config do Expo embutido no APK (assets/app.config, JSON puro) para
// extrair o número de build REAL que o app usa na checagem de atualização
// (extra.appBuild) e o nome legível da versão (version). É a fonte de verdade —
// mais confiável que o versionCode nativo, que pode divergir do appBuild.
function readApkExpoConfig(
  apkPath: string
): Promise<{ appBuild: number | null; versionName: string | null }> {
  return new Promise((resolve) => {
    yauzl.open(apkPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return resolve({ appBuild: null, versionName: null });
      let done = false;
      const finish = (r: { appBuild: number | null; versionName: string | null }) => {
        if (done) return;
        done = true;
        try {
          zip.close();
        } catch {
          /* ignore */
        }
        resolve(r);
      };
      zip.on('error', () => finish({ appBuild: null, versionName: null }));
      zip.on('end', () => finish({ appBuild: null, versionName: null }));
      zip.readEntry();
      zip.on('entry', (entry) => {
        if (entry.fileName !== 'assets/app.config') return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return finish({ appBuild: null, versionName: null });
          const chunks: Buffer[] = [];
          stream.on('data', (c) => chunks.push(c as Buffer));
          stream.on('error', () => finish({ appBuild: null, versionName: null }));
          stream.on('end', () => {
            try {
              const cfg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              const appBuild = Number(cfg?.extra?.appBuild);
              resolve({
                appBuild: Number.isInteger(appBuild) ? appBuild : null,
                versionName: typeof cfg?.version === 'string' ? cfg.version : null,
              });
              done = true;
              try {
                zip.close();
              } catch {
                /* ignore */
              }
            } catch {
              finish({ appBuild: null, versionName: null });
            }
          });
        });
      });
    });
  });
}

// Estado da versão publicada (manifesto + metadados do APK)
app.get(
  '/admin/app/release',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const manifest = readPublishedRelease();
    let apkSize: number | null = null;
    let apkUpdatedAt: string | null = null;
    try {
      const st = fs.statSync(path.join(APP_RELEASE_DIR, APK_FILE));
      apkSize = st.size;
      apkUpdatedAt = st.mtime.toISOString();
    } catch {
      /* sem APK ainda */
    }
    res.json({ manifest, apkSize, apkUpdatedAt, releaseDir: APP_RELEASE_DIR });
  })
);

// Publica uma nova versão: baixa o APK do EAS e reescreve o version.json
app.post(
  '/admin/app/release',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const apkUrl = typeof body.apkUrl === 'string' ? body.apkUrl.trim() : '';
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
    const mandatory = body.mandatory === true;
    // version/versionName são opcionais — preferimos detectar do próprio APK
    const formVersion = Number(body.version);
    const formVersionName =
      typeof body.versionName === 'string' ? body.versionName.trim() : '';

    if (!/^https:\/\/expo\.dev\/artifacts\//.test(apkUrl)) {
      return res
        .status(400)
        .json({ error: 'O link do APK deve ser um artefato do EAS (https://expo.dev/artifacts/...)' });
    }

    fs.mkdirSync(APP_RELEASE_DIR, { recursive: true });
    const tmpPath = path.join(APP_RELEASE_DIR, `.upload_${Date.now()}.tmp`);

    try {
      // 1. Download em streaming para arquivo temporário
      const resp = await fetch(apkUrl);
      if (!resp.ok || !resp.body) {
        return res.status(502).json({ error: `Falha ao baixar o APK (HTTP ${resp.status})` });
      }
      await pipeline(Readable.fromWeb(resp.body as Parameters<typeof Readable.fromWeb>[0]), fs.createWriteStream(tmpPath));

      // 2. Valida assinatura ZIP/APK (começa com "PK")
      const fd = fs.openSync(tmpPath, 'r');
      const head = Buffer.alloc(2);
      fs.readSync(fd, head, 0, 2, 0);
      fs.closeSync(fd);
      if (head[0] !== 0x50 || head[1] !== 0x4b) {
        fs.unlinkSync(tmpPath);
        return res.status(400).json({ error: 'O arquivo baixado não é um APK válido.' });
      }

      // 3. Detecta a versão real lendo o app.config embutido no APK
      const detected = await readApkExpoConfig(tmpPath);
      const version = detected.appBuild ?? (Number.isInteger(formVersion) ? formVersion : NaN);
      const autoDetected = detected.appBuild != null;
      if (!Number.isInteger(version) || version <= 0) {
        fs.unlinkSync(tmpPath);
        return res.status(400).json({
          error:
            'Este APK foi gerado sem o extra.appBuild — ele é um build antigo, anterior à configuração de versão. Gere um APK novo (eas build) com o extra.appBuild definido no app.json e use esse link.',
        });
      }
      const versionName = formVersionName || detected.versionName || `build ${version}`;

      // 4. Bloqueia downgrade (usa a versão real detectada)
      const current = readPublishedRelease();
      if (current && version <= current.version) {
        fs.unlinkSync(tmpPath);
        return res.status(400).json({
          error: `Este APK é o build ${version}, e a versão publicada já é ${current.version}. O build do novo APK precisa ser maior — incremente extra.appBuild no app.json e gere o APK de novo.`,
        });
      }

      const size = fs.statSync(tmpPath).size;

      // 5. Rename atômico para o APK servido publicamente
      fs.renameSync(tmpPath, path.join(APP_RELEASE_DIR, APK_FILE));

      // 6. Reescreve o manifesto de versão
      const manifest = { version, versionName, apkUrl: PUBLIC_APK_URL, mandatory, notes };
      fs.writeFileSync(
        path.join(APP_RELEASE_DIR, VERSION_FILE),
        JSON.stringify(manifest, null, 2),
        'utf8'
      );

      await logAudit(req, 'app.release', 'app', String(version), {
        versionName,
        mandatory,
        autoDetected,
      });
      res.json({ success: true, manifest, apkSize: size, autoDetected });
    } catch (e) {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
      throw e;
    }
  })
);

// Notifica todos os usuários sobre a nova versão (notificação in-app)
app.post(
  '/admin/app/release/notify',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const manifest = readPublishedRelease();
    if (!manifest) return res.status(400).json({ error: 'Nenhuma versão publicada ainda.' });

    const { data: profiles } = await supabase.from('profiles').select('id');
    const ids = (profiles ?? []).map((p) => p.id as string);
    if (!ids.length) return res.json({ success: true, count: 0 });

    const rows = ids.map((user_id) => ({
      user_id,
      title: 'Nova atualização disponível 🚀',
      body: `A versão ${manifest.versionName} já está disponível. Abra o app para atualizar.`,
      type: 'app_update',
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from('notifications').insert(rows.slice(i, i + 500));
      if (error) throw error;
    }

    await logAudit(req, 'app.release.notify', 'app', String(manifest.version), {
      count: ids.length,
    });
    res.json({ success: true, count: ids.length });
  })
);

// Mapa operacional — pontos geográficos de casos e avistamentos
app.get(
  '/admin/map',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const [petsRes, sightingsRes] = await Promise.all([
      supabase
        .from('pets')
        .select('id, name, type, status, latitude, longitude, species, main_photo_url')
        .neq('type', 'donation')
        .in('status', ['ativo', 'pausado'])
        .limit(2000),
      supabase
        .from('sightings')
        .select('id, pet_id, latitude, longitude, confirmed_by_tutor, created_at')
        .order('created_at', { ascending: false })
        .limit(1000),
    ]);
    if (petsRes.error) throw petsRes.error;
    if (sightingsRes.error) throw sightingsRes.error;

    const valid = (lat: unknown, lng: unknown) =>
      Number.isFinite(Number(lat)) &&
      Number.isFinite(Number(lng)) &&
      !(Number(lat) === 0 && Number(lng) === 0);

    const pets = ((petsRes.data ?? []) as Record<string, unknown>[])
      .filter((p) => valid(p.latitude, p.longitude))
      .map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        status: p.status,
        species: p.species,
        photo_url: p.main_photo_url,
        lat: Number(p.latitude),
        lng: Number(p.longitude),
      }));

    const sightings = ((sightingsRes.data ?? []) as Record<string, unknown>[])
      .filter((s) => valid(s.latitude, s.longitude))
      .map((s) => ({
        id: s.id,
        pet_id: s.pet_id,
        confirmed: s.confirmed_by_tutor,
        created_at: s.created_at,
        lat: Number(s.latitude),
        lng: Number(s.longitude),
      }));

    res.json({ pets, sightings });
  })
);

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

    // Saques pendentes de processamento (valor + contagem)
    const { data: pendingWithdrawals } = await supabase
      .from('transactions')
      .select('amount')
      .eq('type', 'withdraw')
      .eq('status', 'pending');
    const withdrawPendingCount = pendingWithdrawals?.length ?? 0;
    const withdrawPendingTotal = (pendingWithdrawals ?? []).reduce(
      (s, t) => s + Math.abs(Number(t.amount)),
      0
    );

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

    // KPIs operacionais (casos, doações, avistamentos, denúncias)
    const [
      { count: activeCases },
      { count: resolvedThisMonth },
      { count: activeDonations },
      { count: adoptionsThisMonth },
      { count: sightingsPending },
      { count: openReports },
    ] = await Promise.all([
      supabase
        .from('pets')
        .select('id', { count: 'exact', head: true })
        .neq('type', 'donation')
        .eq('status', 'ativo'),
      supabase
        .from('pets')
        .select('id', { count: 'exact', head: true })
        .neq('type', 'donation')
        .eq('status', 'encontrado')
        .gte('updated_at', monthStart),
      supabase
        .from('pets')
        .select('id', { count: 'exact', head: true })
        .eq('type', 'donation')
        .eq('status', 'ativo'),
      supabase
        .from('pets')
        .select('id', { count: 'exact', head: true })
        .eq('type', 'donation')
        .eq('status', 'encontrado')
        .gte('updated_at', monthStart),
      supabase
        .from('sightings')
        .select('id', { count: 'exact', head: true })
        .is('confirmed_by_tutor', null),
      supabase
        .from('reports')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'reviewing']),
    ]);

    res.json({
      users: users ?? 0,
      activeUsers24h,
      premiumActive,
      premiumLifetime,
      activeCases: activeCases ?? 0,
      resolvedThisMonth: resolvedThisMonth ?? 0,
      activeDonations: activeDonations ?? 0,
      adoptionsThisMonth: adoptionsThisMonth ?? 0,
      sightingsPending: sightingsPending ?? 0,
      openReports: openReports ?? 0,
      activeRewardsTotal: Number(activeRewardsTotal.toFixed(2)),
      openTickets: openTickets ?? 0,
      withdrawPendingCount,
      withdrawPendingTotal: Number(withdrawPendingTotal.toFixed(2)),
      revenueMonth: Number((feeRevenue + subRevenue).toFixed(2)),
    });
  })
);

// Análises (BI) — séries temporais e distribuições para a página Análises.
app.get(
  '/admin/analytics',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const DAY = 24 * 60 * 60 * 1000;
    const signupDays = 30;
    const caseDays = 14;
    const months = 6;

    const signupsSince = new Date(now.getTime() - (signupDays - 1) * DAY);
    signupsSince.setUTCHours(0, 0, 0, 0);
    const casesSince = new Date(now.getTime() - (caseDays - 1) * DAY);
    casesSince.setUTCHours(0, 0, 0, 0);
    const firstMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));

    const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);
    const monthKey = (iso: string) => new Date(iso).toISOString().slice(0, 7);

    const [
      profilesRes,
      petsWindowRes,
      petsAllRes,
      rewardsRes,
      subsRes,
      profilesStatsRes,
    ] = await Promise.all([
      supabase.from('profiles').select('created_at').gte('created_at', signupsSince.toISOString()),
      supabase
        .from('pets')
        .select('created_at, type')
        .neq('type', 'donation')
        .gte('created_at', casesSince.toISOString()),
      supabase.from('pets').select('type, status, species'),
      supabase
        .from('rewards')
        .select('fee_amount, status, paid_at, refunded_at')
        .in('status', ['paid', 'refunded'])
        .gte('paid_at', firstMonth.toISOString()),
      supabase
        .from('premium_subscriptions')
        .select('amount, starts_at, status')
        .gte('starts_at', firstMonth.toISOString()),
      supabase.from('profiles').select('full_name, rescues_count, is_premium'),
    ]);

    // 1. Novos usuários por dia (30d)
    const signupBuckets = new Map<string, number>();
    for (let i = 0; i < signupDays; i++) {
      const d = new Date(signupsSince.getTime() + i * DAY).toISOString().slice(0, 10);
      signupBuckets.set(d, 0);
    }
    (profilesRes.data ?? []).forEach((p) => {
      const k = dayKey(p.created_at as string);
      if (signupBuckets.has(k)) signupBuckets.set(k, (signupBuckets.get(k) ?? 0) + 1);
    });
    const signups = [...signupBuckets.entries()].map(([day, count]) => ({ day, count }));

    // 2. Novos casos por dia (14d), separados por tipo
    const caseBuckets = new Map<string, { lost: number; sighted: number; rescued: number }>();
    for (let i = 0; i < caseDays; i++) {
      const d = new Date(casesSince.getTime() + i * DAY).toISOString().slice(0, 10);
      caseBuckets.set(d, { lost: 0, sighted: 0, rescued: 0 });
    }
    (petsWindowRes.data ?? []).forEach((p) => {
      const k = dayKey(p.created_at as string);
      const b = caseBuckets.get(k);
      if (!b) return;
      const t = p.type as string;
      if (t === 'lost') b.lost++;
      else if (t === 'sighted') b.sighted++;
      else if (t === 'rescued') b.rescued++;
    });
    const cases = [...caseBuckets.entries()].map(([day, v]) => ({ day, ...v }));

    // 3. Receita por mês (6 meses): taxa de recompensas + assinaturas premium
    const revBuckets = new Map<string, { fee: number; premium: number }>();
    for (let i = 0; i < months; i++) {
      const d = new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + i, 1));
      revBuckets.set(d.toISOString().slice(0, 7), { fee: 0, premium: 0 });
    }
    (rewardsRes.data ?? []).forEach((r) => {
      const when = (r.paid_at ?? r.refunded_at) as string | null;
      if (!when) return;
      const b = revBuckets.get(monthKey(when));
      if (b) b.fee += Number(r.fee_amount);
    });
    (subsRes.data ?? []).forEach((s) => {
      const b = revBuckets.get(monthKey(s.starts_at as string));
      if (b) b.premium += Number(s.amount);
    });
    const revenue = [...revBuckets.entries()].map(([month, v]) => ({
      month,
      fee: round2(v.fee),
      premium: round2(v.premium),
      total: round2(v.fee + v.premium),
    }));

    // 4. Distribuições atuais (casos por tipo / status / espécie)
    const petsAll = (petsAllRes.data ?? []) as Record<string, unknown>[];
    const tally = (rows: Record<string, unknown>[], key: string) => {
      const m: Record<string, number> = {};
      rows.forEach((r) => {
        const v = (r[key] as string) ?? 'indefinido';
        m[v] = (m[v] ?? 0) + 1;
      });
      return m;
    };
    const nonDonation = petsAll.filter((p) => p.type !== 'donation');

    // 5. Top resgatadores + funil premium
    const profilesStats = (profilesStatsRes.data ?? []) as Record<string, unknown>[];
    const topFinders = profilesStats
      .filter((p) => Number(p.rescues_count) > 0)
      .sort((a, b) => Number(b.rescues_count) - Number(a.rescues_count))
      .slice(0, 8)
      .map((p) => ({ name: (p.full_name as string) ?? 'Sem nome', rescues: Number(p.rescues_count) }));
    const totalUsers = profilesStats.length;
    const premiumUsers = profilesStats.filter((p) => p.is_premium === true).length;

    res.json({
      signups,
      cases,
      revenue,
      casesByType: tally(nonDonation, 'type'),
      casesByStatus: tally(nonDonation, 'status'),
      casesBySpecies: tally(petsAll, 'species'),
      topFinders,
      premiumFunnel: {
        total: totalUsers,
        premium: premiumUsers,
        conversion: totalUsers ? Number(((premiumUsers / totalUsers) * 100).toFixed(1)) : 0,
      },
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

    await logAudit(req, `withdraw.${action}`, 'transaction', txId, { amount: value });
    res.json({ success: true });
  })
);

// Configurações do app — doação voluntária + reconhecimento por foto
// (a taxa/escrow foi removida: o app não intermedia mais o pagamento)
const readDonationConfig = async () => {
  const { data } = await supabase
    .from('app_settings')
    .select('donation_pix_key, donation_url, region_alert_radius_m, region_alert_cooldown_h, region_alert_reports_to_deactivate')
    .eq('id', 1)
    .maybeSingle();
  return {
    donationPixKey: data?.donation_pix_key ?? null,
    donationUrl: data?.donation_url ?? null,
    regionAlertRadiusM: data?.region_alert_radius_m ?? 10000,
    regionAlertCooldownH: data?.region_alert_cooldown_h ?? 24,
    regionAlertReportsToDeactivate: data?.region_alert_reports_to_deactivate ?? 5,
  };
};

app.get(
  '/admin/settings',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const { threshold, radiusM } = await getMatchConfig();
    res.json({ matchThreshold: threshold, matchRadiusM: radiusM, ...(await readDonationConfig()) });
  })
);

app.post(
  '/admin/settings',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

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
    if (req.body?.donationPixKey !== undefined) {
      patch.donation_pix_key = String(req.body.donationPixKey ?? '').trim() || null;
    }
    if (req.body?.donationUrl !== undefined) {
      const v = String(req.body.donationUrl ?? '').trim();
      if (v && !/^https?:\/\//i.test(v)) {
        return res.status(400).json({ error: 'donationUrl deve começar com http(s):// ou ficar vazio' });
      }
      patch.donation_url = v || null;
    }
    if (req.body?.regionAlertRadiusM !== undefined) {
      const r = Number(req.body.regionAlertRadiusM);
      if (!Number.isInteger(r) || r < 500 || r > 200000) {
        return res.status(400).json({ error: 'regionAlertRadiusM deve ser um inteiro entre 500 e 200000 (metros)' });
      }
      patch.region_alert_radius_m = r;
    }
    if (req.body?.regionAlertCooldownH !== undefined) {
      const h = Number(req.body.regionAlertCooldownH);
      if (!Number.isInteger(h) || h < 1 || h > 168) {
        return res.status(400).json({ error: 'regionAlertCooldownH deve ser um inteiro entre 1 e 168 (horas)' });
      }
      patch.region_alert_cooldown_h = h;
    }
    if (req.body?.regionAlertReportsToDeactivate !== undefined) {
      const n = Number(req.body.regionAlertReportsToDeactivate);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        return res.status(400).json({ error: 'regionAlertReportsToDeactivate deve ser um inteiro entre 1 e 100' });
      }
      patch.region_alert_reports_to_deactivate = n;
    }

    const { error } = await supabase.from('app_settings').update(patch).eq('id', 1);
    if (error) throw error;

    const { threshold, radiusM } = await getMatchConfig();
    res.json({ matchThreshold: threshold, matchRadiusM: radiusM, ...(await readDonationConfig()) });
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

    await logAudit(req, `user.${status}`, 'user', id, { reason: reason ?? null });
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
    await logAudit(req, 'ticket.update', 'ticket', id, update);
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

    await logAudit(req, 'ticket.reply', 'ticket', id, { length: message.length });
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

    await logAudit(req, 'subscription.cancel', 'subscription', id, { user_id: sub.user_id });
    res.json({ success: true });
  })
);

// Concede premium a um usuário como cortesia (sem cobrança)
app.post(
  '/admin/subscriptions/grant',
  requireAdmin,
  asyncHandler(async (req, res) => {
    // Com o premium desativado, conceder seria uma promessa vazia: o app ignora
    // is_premium e já libera tudo para todos. Antes disto, o grant ainda gravava
    // a assinatura e notificava "Premium ativado! ⭐ buscas ilimitadas" — um
    // benefício que o backend não entrega. (Cancelar segue liberado, para o
    // admin conseguir limpar registros antigos.)
    if (!PREMIUM_ENABLED) {
      return res.status(403).json({
        error:
          'Premium está desativado — o app é 100% gratuito e todos já têm os recursos liberados. Conceder uma assinatura não daria nenhum benefício ao usuário.',
      });
    }

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

    await logAudit(req, 'subscription.grant', 'user', userId, { planType });
    res.json({ success: true, subscription: sub });
  })
);

// ----------------------------------------------------------------------------
// Casos — gestão dos pets pelo painel admin (perdidos, vistos, resgatados)
// Doações (type='donation') ficam no módulo próprio.
// ----------------------------------------------------------------------------
const PET_STATUS = ['ativo', 'pausado', 'encontrado', 'cancelado'];

app.get(
  '/admin/pets',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const type = str(req.query.type);
    const species = str(req.query.species);
    const status = str(req.query.status);
    const q = str(req.query.q);
    const from = str(req.query.from);
    const toRaw = str(req.query.to);
    const to = toRaw ? (toRaw.length === 10 ? `${toRaw}T23:59:59.999Z` : toRaw) : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    let query = supabase
      .from('pets')
      .select(
        'id, name, breed, color, size, species, type, sex, age_group, status, main_photo_url, lost_date, created_at, user_id'
      )
      .neq('type', 'donation')
      .order('created_at', { ascending: false });
    if (type) query = query.eq('type', type);
    if (species) query = query.eq('species', species);
    if (status) query = query.eq('status', status);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data, error } = await query;
    if (error) throw error;

    const pets = (data ?? []) as Record<string, unknown>[];
    const userIds = [...new Set(pets.map((p) => p.user_id as string))];
    const { data: profs } = userIds.length
      ? await supabase.from('profiles').select('id, full_name').in('id', userIds)
      : { data: [] as Record<string, unknown>[] };
    const nameMap = new Map((profs ?? []).map((p) => [p.id as string, p.full_name]));

    let rows = pets.map((p) => ({
      id: p.id,
      name: p.name,
      breed: p.breed,
      color: p.color,
      size: p.size,
      species: p.species,
      type: p.type,
      sex: p.sex,
      age_group: p.age_group,
      status: p.status,
      main_photo_url: p.main_photo_url,
      lost_date: p.lost_date,
      created_at: p.created_at,
      tutor: { id: p.user_id, full_name: nameMap.get(p.user_id as string) ?? null },
    }));

    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter((r) =>
        [r.name, r.breed, r.tutor.full_name].some(
          (f) => typeof f === 'string' && f.toLowerCase().includes(needle)
        )
      );
    }

    res.json({ rows: rows.slice(offset, offset + limit), total: rows.length });
  })
);

// Detalhe de um caso: pet + tutor + fotos + recompensas + chats + avistamentos
app.get(
  '/admin/pets/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { data: pet } = await supabase
      .from('pets')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!pet) return res.status(404).json({ error: 'Caso não encontrado' });

    const [tutorRes, photosRes, rewardsRes, chatsRes, sightingsRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, photo_url, phone, status')
        .eq('id', pet.user_id)
        .maybeSingle(),
      supabase
        .from('pet_photos')
        .select('id, photo_url, position')
        .eq('pet_id', id)
        .order('position'),
      supabase
        .from('rewards')
        .select('id, amount, fee_amount, status, finder_user_id, paid_at, refunded_at, created_at')
        .eq('pet_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('chats')
        .select('id, status, found, finder_id, created_at, closed_at')
        .eq('pet_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('sightings')
        .select(
          'id, finder_id, latitude, longitude, photo_url, message, ai_match_score, confirmed_by_tutor, created_at'
        )
        .eq('pet_id', id)
        .order('created_at', { ascending: false }),
    ]);

    const tutor = tutorRes.data ?? null;
    const { data: tutorAuth } = pet.user_id
      ? await supabase.auth.admin.getUserById(pet.user_id)
      : { data: null };

    // Resolve nomes dos finders (chats + sightings)
    const finderIds = [
      ...((chatsRes.data ?? []) as Record<string, unknown>[]).map((c) => c.finder_id as string),
      ...((sightingsRes.data ?? []) as Record<string, unknown>[]).map((s) => s.finder_id as string),
    ].filter(Boolean);
    const uniqFinders = [...new Set(finderIds)];
    const { data: finderProfs } = uniqFinders.length
      ? await supabase.from('profiles').select('id, full_name').in('id', uniqFinders)
      : { data: [] as Record<string, unknown>[] };
    const finderMap = new Map((finderProfs ?? []).map((p) => [p.id as string, p.full_name]));

    // Adotante (relevante para pets do tipo donation)
    let adopter: Record<string, unknown> | null = null;
    if (pet.adopter_user_id) {
      const { data: adopterProf } = await supabase
        .from('profiles')
        .select('id, full_name, photo_url, phone, status, is_admin')
        .eq('id', pet.adopter_user_id)
        .maybeSingle();
      if (adopterProf) {
        const { data: adopterAuth } = await supabase.auth.admin.getUserById(
          pet.adopter_user_id
        );
        adopter = { ...adopterProf, email: adopterAuth?.user?.email ?? null };
      }
    }

    res.json({
      pet,
      tutor: tutor ? { ...tutor, email: tutorAuth?.user?.email ?? null } : null,
      adopter,
      photos: photosRes.data ?? [],
      rewards: rewardsRes.data ?? [],
      chats: ((chatsRes.data ?? []) as Record<string, unknown>[]).map((c) => ({
        ...c,
        finderName: finderMap.get(c.finder_id as string) ?? null,
      })),
      sightings: ((sightingsRes.data ?? []) as Record<string, unknown>[]).map((s) => ({
        ...s,
        finderName: finderMap.get(s.finder_id as string) ?? null,
      })),
    });
  })
);

// Altera o status de um caso (pausar / reativar / marcar encontrado / cancelar)
app.patch(
  '/admin/pets/:id/status',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body ?? {};
    if (!PET_STATUS.includes(status)) {
      return res.status(400).json({ error: "status deve ser 'ativo', 'pausado', 'encontrado' ou 'cancelado'" });
    }
    const { data, error } = await supabase
      .from('pets')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Caso não encontrado' });
    await logAudit(req, 'pet.status', 'pet', id, { status });
    res.json(data);
  })
);

// ----------------------------------------------------------------------------
// Denúncias — moderação de relatos de abuso/fraude
// ----------------------------------------------------------------------------
const REPORT_STATUS = ['pending', 'reviewing', 'dismissed', 'actioned'];

app.get(
  '/admin/reports',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const status = str(req.query.status);
    const q = str(req.query.q);
    const from = str(req.query.from);
    const toRaw = str(req.query.to);
    const to = toRaw ? (toRaw.length === 10 ? `${toRaw}T23:59:59.999Z` : toRaw) : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    let query = supabase
      .from('reports')
      .select('id, reporter_id, reported_id, chat_id, pet_id, region_alert_id, reason, status, created_at')
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data, error } = await query;
    if (error) throw error;

    const reports = (data ?? []) as Record<string, unknown>[];
    const userIds = [
      ...new Set(
        [
          ...reports.map((r) => r.reporter_id as string),
          ...reports.map((r) => r.reported_id as string),
        ].filter(Boolean)
      ),
    ];
    const petIds = [
      ...new Set(reports.map((r) => r.pet_id as string).filter(Boolean)),
    ];

    const { data: profs } = userIds.length
      ? await supabase.from('profiles').select('id, full_name').in('id', userIds)
      : { data: [] as Record<string, unknown>[] };
    const { data: pets } = petIds.length
      ? await supabase.from('pets').select('id, name').in('id', petIds)
      : { data: [] as Record<string, unknown>[] };
    const nameMap = new Map((profs ?? []).map((p) => [p.id as string, p.full_name]));
    const petMap = new Map((pets ?? []).map((p) => [p.id as string, p.name]));

    let rows = reports.map((r) => ({
      id: r.id,
      reason: r.reason,
      status: r.status,
      created_at: r.created_at,
      chat_id: r.chat_id,
      reporter: {
        id: r.reporter_id,
        full_name: nameMap.get(r.reporter_id as string) ?? null,
      },
      reported: {
        id: r.reported_id,
        full_name: nameMap.get(r.reported_id as string) ?? null,
      },
      pet: r.pet_id
        ? { id: r.pet_id, name: petMap.get(r.pet_id as string) ?? null }
        : null,
      region_alert_id: r.region_alert_id ?? null,
    }));

    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter((r) =>
        [r.reporter.full_name, r.reported.full_name, r.reason].some(
          (f) => typeof f === 'string' && f.toLowerCase().includes(needle)
        )
      );
    }

    res.json({ rows: rows.slice(offset, offset + limit), total: rows.length });
  })
);

// Detalhe: denúncia + denunciante + denunciado + caso ligado + mensagens do chat
app.get(
  '/admin/reports/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { data: report } = await supabase
      .from('reports')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!report) return res.status(404).json({ error: 'Denúncia não encontrada' });

    const [reporterRes, reportedRes, petRes, msgsRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, photo_url, phone, status, is_admin')
        .eq('id', report.reporter_id)
        .maybeSingle(),
      supabase
        .from('profiles')
        .select('id, full_name, photo_url, phone, status, is_admin')
        .eq('id', report.reported_id)
        .maybeSingle(),
      report.pet_id
        ? supabase
            .from('pets')
            .select('id, name, type, status, main_photo_url, user_id')
            .eq('id', report.pet_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      report.chat_id
        ? supabase
            .from('messages')
            .select('id, sender_id, content, photo_url, created_at')
            .eq('chat_id', report.chat_id)
            .order('created_at', { ascending: true })
            .limit(200)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ]);

    const [reporterAuth, reportedAuth] = await Promise.all([
      supabase.auth.admin.getUserById(report.reporter_id),
      supabase.auth.admin.getUserById(report.reported_id),
    ]);

    const reporter = reporterRes.data
      ? { ...reporterRes.data, email: reporterAuth.data?.user?.email ?? null }
      : null;
    const reported = reportedRes.data
      ? { ...reportedRes.data, email: reportedAuth.data?.user?.email ?? null }
      : null;

    // Contexto do alerta de região, quando a denúncia for de um alerta.
    let regionAlert: Record<string, unknown> | null = null;
    if (report.region_alert_id) {
      const { data: ra } = await supabase
        .from('region_alerts')
        .select('id, pet_id, tutor_id, comment, status, reports_count, likes_count, radius_m, created_at')
        .eq('id', report.region_alert_id)
        .maybeSingle();
      if (ra) {
        const { data: raPet } = ra.pet_id
          ? await supabase.from('pets').select('id, name, type, status, main_photo_url').eq('id', ra.pet_id).maybeSingle()
          : { data: null };
        regionAlert = { ...ra, pet: raPet ?? null };
      }
    }

    res.json({
      report,
      reporter,
      reported,
      pet: petRes.data,
      messages: msgsRes.data ?? [],
      regionAlert,
    });
  })
);

// Atualiza status e/ou notas internas da denúncia
app.patch(
  '/admin/reports/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = req.body ?? {};
    const update: Record<string, unknown> = {};
    if (body.status !== undefined) {
      if (!REPORT_STATUS.includes(body.status)) {
        return res.status(400).json({ error: 'status inválido' });
      }
      update.status = body.status;
    }
    if (body.admin_notes !== undefined) {
      update.admin_notes =
        typeof body.admin_notes === 'string' && body.admin_notes.trim()
          ? body.admin_notes.trim()
          : null;
    }
    const { data, error } = await supabase
      .from('reports')
      .update(update)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Denúncia não encontrada' });
    await logAudit(req, 'report.update', 'report', id, update);
    res.json(data);
  })
);

// Reativa um alerta de região desativado por denúncias, após revisão da moderação.
// Marca as denúncias do alerta como descartadas e avisa o tutor.
app.post(
  '/admin/region-alerts/:id/reactivate',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const alertId = req.params.id;
    const { data: alert } = await supabase
      .from('region_alerts')
      .select('id, tutor_id, status')
      .eq('id', alertId)
      .maybeSingle();
    if (!alert) return res.status(404).json({ error: 'Alerta não encontrado' });
    // Guard de estado: só reativa o que está desativado (evita descartar denúncias
    // legítimas novas e notificação confusa em chamada repetida/stale/concorrente).
    if (alert.status !== 'deactivated') return res.status(409).json({ error: 'Alerta não está desativado' });

    // Zera o placar: a reativação recomeça a contagem de denúncias do zero.
    await supabase.from('region_alerts').update({ status: 'active', reports_count: 0 }).eq('id', alertId);
    await supabase
      .from('reports')
      .update({ status: 'dismissed' })
      .eq('region_alert_id', alertId)
      .in('status', ['pending', 'reviewing']);
    await notifyUser(alert.tutor_id, {
      title: 'Alerta de região reativado',
      body: 'Após revisão da moderação, seu alerta voltou a ficar ativo.',
      type: 'region_alert',
      region_alert_id: alertId,
      pet_id: null,
    });
    await logAudit(req, 'region_alert.reactivate', 'region_alert', alertId, {});
    res.json({ success: true });
  })
);

// ----------------------------------------------------------------------------
// Doações — gestão dos pets em adoção (type='donation')
// Compartilha o /admin/pets/:id (detalhe) e /admin/pets/:id/status (ações).
// ----------------------------------------------------------------------------
app.get(
  '/admin/donations',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const status = str(req.query.status);
    const species = str(req.query.species);
    const q = str(req.query.q);
    const from = str(req.query.from);
    const toRaw = str(req.query.to);
    const to = toRaw ? (toRaw.length === 10 ? `${toRaw}T23:59:59.999Z` : toRaw) : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    let query = supabase
      .from('pets')
      .select(
        'id, name, breed, color, size, species, sex, age_group, status, main_photo_url, created_at, user_id, adopter_user_id'
      )
      .eq('type', 'donation')
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    if (species) query = query.eq('species', species);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data, error } = await query;
    if (error) throw error;

    const pets = (data ?? []) as Record<string, unknown>[];
    const userIds = [
      ...new Set(
        [
          ...pets.map((p) => p.user_id as string),
          ...pets.map((p) => p.adopter_user_id as string),
        ].filter(Boolean)
      ),
    ];
    const { data: profs } = userIds.length
      ? await supabase.from('profiles').select('id, full_name').in('id', userIds)
      : { data: [] as Record<string, unknown>[] };
    const nameMap = new Map((profs ?? []).map((p) => [p.id as string, p.full_name]));

    let rows = pets.map((p) => ({
      id: p.id,
      name: p.name,
      breed: p.breed,
      color: p.color,
      size: p.size,
      species: p.species,
      sex: p.sex,
      age_group: p.age_group,
      status: p.status,
      main_photo_url: p.main_photo_url,
      created_at: p.created_at,
      tutor: {
        id: p.user_id,
        full_name: nameMap.get(p.user_id as string) ?? null,
      },
      adopter: p.adopter_user_id
        ? {
            id: p.adopter_user_id,
            full_name: nameMap.get(p.adopter_user_id as string) ?? null,
          }
        : null,
    }));

    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter((r) =>
        [r.name, r.breed, r.tutor.full_name, r.adopter?.full_name].some(
          (f) => typeof f === 'string' && f.toLowerCase().includes(needle)
        )
      );
    }

    res.json({ rows: rows.slice(offset, offset + limit), total: rows.length });
  })
);

// ----------------------------------------------------------------------------
// Avistamentos — visão e moderação dos sightings
// ----------------------------------------------------------------------------
app.get(
  '/admin/sightings',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const q = str(req.query.q);
    const confirmed = str(req.query.confirmed); // 'yes' | 'no' | 'pending'
    const from = str(req.query.from);
    const toRaw = str(req.query.to);
    const to = toRaw ? (toRaw.length === 10 ? `${toRaw}T23:59:59.999Z` : toRaw) : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    let query = supabase
      .from('sightings')
      .select(
        'id, pet_id, finder_id, latitude, longitude, photo_url, message, ai_match_score, confirmed_by_tutor, created_at'
      )
      .order('created_at', { ascending: false });
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);
    if (confirmed === 'yes') query = query.eq('confirmed_by_tutor', true);
    else if (confirmed === 'no') query = query.eq('confirmed_by_tutor', false);
    else if (confirmed === 'pending') query = query.is('confirmed_by_tutor', null);

    const { data, error } = await query;
    if (error) throw error;
    const sightings = (data ?? []) as Record<string, unknown>[];

    const petIds = [...new Set(sightings.map((s) => s.pet_id as string).filter(Boolean))];
    const userIds = [...new Set(sightings.map((s) => s.finder_id as string).filter(Boolean))];
    const [petsRes, profsRes] = await Promise.all([
      petIds.length
        ? supabase.from('pets').select('id, name, main_photo_url').in('id', petIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      userIds.length
        ? supabase.from('profiles').select('id, full_name').in('id', userIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ]);
    const petMap = new Map(
      (petsRes.data ?? []).map((p) => [p.id as string, p])
    );
    const nameMap = new Map(
      (profsRes.data ?? []).map((p) => [p.id as string, p.full_name])
    );

    let rows = sightings.map((s) => {
      const pet = s.pet_id
        ? (petMap.get(s.pet_id as string) as Record<string, unknown> | undefined)
        : null;
      return {
        id: s.id,
        latitude: Number(s.latitude),
        longitude: Number(s.longitude),
        photo_url: s.photo_url,
        message: s.message,
        ai_match_score: s.ai_match_score != null ? Number(s.ai_match_score) : null,
        confirmed_by_tutor: s.confirmed_by_tutor,
        created_at: s.created_at,
        pet: s.pet_id
          ? {
              id: s.pet_id,
              name: pet?.name ?? null,
              main_photo_url: pet?.main_photo_url ?? null,
            }
          : null,
        finder: {
          id: s.finder_id,
          full_name: nameMap.get(s.finder_id as string) ?? null,
        },
      };
    });

    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter((r) =>
        [r.pet?.name, r.finder.full_name, r.message].some(
          (f) => typeof f === 'string' && f.toLowerCase().includes(needle)
        )
      );
    }

    res.json({ rows: rows.slice(offset, offset + limit), total: rows.length });
  })
);

// Excluir um avistamento (spam, abuso, duplicidade)
app.delete(
  '/admin/sightings/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { error } = await supabase.from('sightings').delete().eq('id', id);
    if (error) throw error;
    await logAudit(req, 'sighting.delete', 'sighting', id);
    res.json({ success: true });
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
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
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

    // 4. Mensagens do chat do resgate — SÓ para os participantes (tutor /
    // encontrador). Conversa privada nunca é exposta a terceiros.
    let messages: any[] = [];
    if (foundChat) {
      const isParty =
        userId === (pet as any).user_id ||
        userId === (foundChat as any).finder_id ||
        userId === (foundChat as any).tutor_id;
      if (isParty) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('id, sender_id, content, photo_url, created_at')
          .eq('chat_id', foundChat.id)
          .order('created_at', { ascending: true });
        messages = msgs ?? [];
      }
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
// CASOS DE SUCESSO — registro do final feliz + vitrine dentro do app
// ============================================================================
// Tutor registra (ou atualiza) o final feliz de um caso concluído.
// "authorized" = consentimento para publicar no app e no site de doação.
app.post(
  '/pets/:petId/success-case',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { petId } = req.params;
    const { photo_url, message, authorized } = req.body ?? {};

    const { data: pet, error: petErr } = await supabase
      .from('pets')
      .select('id, user_id, status')
      .eq('id', petId)
      .single();
    if (petErr || !pet) return res.status(404).json({ error: 'Pet não encontrado' });
    if (pet.user_id !== userId) {
      return res.status(403).json({ error: 'Apenas o tutor pode registrar o final feliz' });
    }
    if (!['encontrado', 'doado'].includes(pet.status)) {
      return res.status(400).json({ error: 'O caso precisa estar concluído para registrar o final feliz' });
    }

    const msg = String(message ?? '').trim().slice(0, 600);
    const { data: sc, error } = await supabase
      .from('success_cases')
      .upsert(
        {
          pet_id: petId,
          tutor_id: userId,
          photo_url: photo_url ? String(photo_url) : null,
          message: msg,
          authorized: authorized === true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'pet_id' }
      )
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ success: true, successCase: sc });
  })
);

// Registro de final feliz de um pet — visível se autorizado OU se for o tutor.
app.get(
  '/pets/:petId/success-case',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { petId } = req.params;
    const { data: sc } = await supabase
      .from('success_cases')
      .select(
        `id, pet_id, tutor_id, photo_url, message, authorized, created_at,
         tutor:profiles!success_cases_tutor_id_fkey ( id, full_name, photo_url, show_profile_photo )`
      )
      .eq('pet_id', petId)
      .maybeSingle();
    if (!sc) return res.json({ successCase: null });
    if (!sc.authorized && sc.tutor_id !== userId) return res.json({ successCase: null });
    gateProfilePhoto((sc as any).tutor);
    res.json({ successCase: sc });
  })
);

// Vitrine de casos de sucesso dentro do app (somente autorizados).
app.get(
  '/success-cases',
  requireUser,
  asyncHandler(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50) || 50));
    const { data: cases } = await supabase
      .from('success_cases')
      .select(
        `id, pet_id, photo_url, message, created_at,
         pets ( id, name, type, breed, main_photo_url, lost_date, status ),
         tutor:profiles!success_cases_tutor_id_fkey ( id, full_name, photo_url, show_profile_photo )`
      )
      .eq('authorized', true)
      .order('created_at', { ascending: false })
      .limit(limit);

    const petIds = (cases ?? []).map((c: any) => c.pet_id);
    const foundByPet = new Map<string, { closed_at: string | null; finder_name: string | null }>();
    if (petIds.length) {
      const { data: chats } = await supabase
        .from('chats')
        .select('pet_id, closed_at, finder:profiles!chats_finder_id_fkey ( full_name )')
        .eq('found', true)
        .in('pet_id', petIds);
      (chats ?? []).forEach((c: any) => {
        foundByPet.set(c.pet_id, {
          closed_at: c.closed_at ?? null,
          finder_name: c.finder?.full_name ?? null,
        });
      });
    }

    res.json(
      (cases ?? []).map((c: any) => {
        gateProfilePhoto(c.tutor);
        const found = foundByPet.get(c.pet_id);
        const lost = c.pets?.lost_date ? new Date(c.pets.lost_date) : null;
        const foundIso = found?.closed_at ?? c.created_at;
        const days = lost
          ? Math.max(0, Math.round((new Date(foundIso).getTime() - lost.getTime()) / 86400000))
          : null;
        return { ...c, finder_name: found?.finder_name ?? null, days_lost: days, concluded_at: foundIso };
      })
    );
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

    // Recompensa: só para pet perdido (lost). Valor é APENAS informativo no anúncio —
    // combinado diretamente entre as pessoas; o app não intermedia (sem escrow/taxa).
    if (petType === 'lost' && reward_amount && Number(reward_amount) > 0) {
      await supabase.from('rewards').insert({
        pet_id: pet.id,
        amount: Number(reward_amount),
        fee_amount: 0,
        status: 'pending',
        payer_user_id: userId,
      });
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

    // Vision-tags (manchas/padrões/cor) — independente do embedding, best-effort.
    if (isVisionTagsEnabled()) {
      generatePetVisionTags(mainPhoto)
        .then(async (tags) => {
          if (tags) {
            const patch: any = { vision_tags: tags };
            // Espécie detectada quando o cadastro não a informou — habilita o
            // filtro duro gato×cachorro no /pets/match já no primeiro cadastro.
            if (tags.species && !pet.species) patch.species = tags.species;
            await supabase.from('pets').update(patch).eq('id', pet.id);
            console.log(`[vision] pet ${pet.id} tagueado`);
          }
        })
        .catch((e) => console.error(`[vision] falha no pet ${pet.id}:`, e.message));
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
// MEUS PETS — ficha do dono + carteirinha de saúde (privado, RLS por dono)
// ============================================================================
// Identidade SEMPRE via authedId(req); o client service-role bypassa RLS, então
// cada handler valida user_id em código. Fotos são URLs já hospedadas pelo app.
// Fase 2 ships UNGATED — nenhum limite de pets aqui ainda.

const MP_SPECIES = ['cachorro', 'gato', 'passaro', 'outro'];
const MP_SIZES = ['pequeno', 'medio', 'grande'];
const MP_SEXES = ['macho', 'femea', 'desconhecido'];
const HEALTH_TYPES = ['vacina', 'vermifugo', 'antipulgas', 'medicacao', 'peso'];

// Converte peso: null quando ausente; número válido (0 < w <= 200) ou INVALID_WEIGHT.
const INVALID_WEIGHT = Symbol('invalid_weight');
const parseWeight = (raw: any): number | null | typeof INVALID_WEIGHT => {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'number' && typeof raw !== 'string') return INVALID_WEIGHT;
  const w = Number(raw);
  if (!Number.isFinite(w) || w <= 0 || w > 200) return INVALID_WEIGHT;
  return w;
};

// Whitelist + coerção da ficha; só inclui chaves presentes no corpo (patch esparso).
const buildMeuPetPatch = (body: Record<string, any>): Record<string, unknown> => {
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.species !== undefined) patch.species = MP_SPECIES.includes(body.species) ? body.species : null;
  if (body.breed !== undefined) patch.breed = body.breed ?? null;
  if (body.color !== undefined) patch.color = body.color ?? null;
  if (body.size !== undefined) patch.size = MP_SIZES.includes(body.size) ? body.size : null;
  if (body.sex !== undefined) patch.sex = MP_SEXES.includes(body.sex) ? body.sex : 'desconhecido';
  if (body.birth_date !== undefined) patch.birth_date = body.birth_date || null;
  if (body.microchip !== undefined) patch.microchip = body.microchip ?? null;
  if (body.neutered !== undefined) patch.neutered = Boolean(body.neutered);
  if (body.health_notes !== undefined) patch.health_notes = body.health_notes ?? null;
  if (body.main_photo_url !== undefined) patch.main_photo_url = body.main_photo_url ?? null;
  if (body.extra_photos !== undefined)
    patch.extra_photos = Array.isArray(body.extra_photos)
      ? body.extra_photos.filter((u: any) => typeof u === 'string').slice(0, 3)
      : [];
  return patch;
};

// GET /me/pets — lista os pets do dono autenticado
app.get(
  '/me/pets',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { data, error } = await supabase
      .from('meus_pets')
      .select(
        'id, name, species, breed, color, size, sex, birth_date, microchip, neutered, health_notes, main_photo_url, extra_photos, created_at, updated_at'
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data ?? []);
  })
);

// GET /me/pets/:petId — ficha + carteirinha (health_records)
app.get(
  '/me/pets/:petId',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { petId } = req.params;
    const { data: pet, error } = await supabase
      .from('meus_pets')
      .select('*')
      .eq('id', petId)
      .eq('user_id', userId) // filtro por dono = checagem de posse
      .maybeSingle();
    if (error) throw error;
    if (!pet) return res.status(404).json({ error: 'Pet não encontrado' });

    const { data: records, error: recErr } = await supabase
      .from('health_records')
      .select('*')
      .eq('pet_id', petId)
      .order('date_aplicada', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (recErr) throw recErr;

    // numeric do Postgres volta como string — normaliza weight_kg para número.
    const normalized = (records ?? []).map((r: any) => ({
      ...r,
      weight_kg: r.weight_kg == null ? null : Number(r.weight_kg),
    }));
    res.json({ ...pet, health_records: normalized });
  })
);

// POST /me/pets — cria uma ficha
app.post(
  '/me/pets',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const body = req.body ?? {};
    if (!body.name || !String(body.name).trim()) {
      return res.status(400).json({ error: 'Informe o nome do pet' });
    }
    // TODO Fase 3 gating: getPetsConfig() + count(meus_pets) + 402 quando !isPremium && count >= maxFreePets
    const patch = buildMeuPetPatch(body);
    const { data: pet, error } = await supabase
      .from('meus_pets')
      .insert({ user_id: userId, ...patch })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(pet);
  })
);

// PATCH /me/pets/:petId — edita a ficha (posse + patch esparso)
app.patch(
  '/me/pets/:petId',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { petId } = req.params;
    const { data: pet, error: petErr } = await supabase
      .from('meus_pets')
      .select('id, user_id')
      .eq('id', petId)
      .maybeSingle();
    if (petErr) throw petErr;
    if (!pet) return res.status(404).json({ error: 'Pet não encontrado' });
    if (pet.user_id !== userId) return res.status(403).json({ error: 'Apenas o tutor pode editar' });

    if (req.body?.name !== undefined && !String(req.body.name).trim()) {
      return res.status(400).json({ error: 'Informe o nome do pet' });
    }
    const patch = buildMeuPetPatch(req.body ?? {});
    patch.updated_at = new Date().toISOString();
    const { error } = await supabase.from('meus_pets').update(patch).eq('id', petId);
    if (error) throw error;
    res.json({ success: true });
  })
);

// DELETE /me/pets/:petId — exclui (cascade remove health_records)
app.delete(
  '/me/pets/:petId',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { petId } = req.params;
    const { data: pet, error: petErr } = await supabase
      .from('meus_pets')
      .select('id, user_id')
      .eq('id', petId)
      .maybeSingle();
    if (petErr) throw petErr;
    if (!pet) return res.status(404).json({ error: 'Pet não encontrado' });
    if (pet.user_id !== userId) return res.status(403).json({ error: 'Apenas o tutor pode excluir' });
    const { error } = await supabase.from('meus_pets').delete().eq('id', petId);
    if (error) throw error;
    res.json({ success: true });
  })
);

// POST /me/pets/:petId/health — adiciona registro de saúde
app.post(
  '/me/pets/:petId/health',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { petId } = req.params;
    const { data: pet, error: petErr } = await supabase
      .from('meus_pets')
      .select('id, user_id')
      .eq('id', petId)
      .maybeSingle();
    if (petErr) throw petErr;
    if (!pet) return res.status(404).json({ error: 'Pet não encontrado' });
    if (pet.user_id !== userId) return res.status(403).json({ error: 'Apenas o tutor pode adicionar registros' });

    const b = req.body ?? {};
    if (!HEALTH_TYPES.includes(b.type)) return res.status(400).json({ error: 'Tipo de registro inválido' });
    const weight = parseWeight(b.weight_kg);
    if (weight === INVALID_WEIGHT) return res.status(400).json({ error: 'Peso inválido' });

    const { data: record, error } = await supabase
      .from('health_records')
      .insert({
        pet_id: petId,
        user_id: userId,
        type: b.type,
        name: b.name ?? null,
        date_aplicada: b.date_aplicada || null,
        proxima_data: b.proxima_data || null,
        vet: b.vet ?? null,
        lote: b.lote ?? null,
        weight_kg: weight,
        obs: b.obs ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(record);
  })
);

// PATCH /me/pets/:petId/health/:recordId — edita um registro
app.patch(
  '/me/pets/:petId/health/:recordId',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { petId, recordId } = req.params;
    const { data: rec, error: recErr } = await supabase
      .from('health_records')
      .select('id, user_id, pet_id')
      .eq('id', recordId)
      .maybeSingle();
    if (recErr) throw recErr;
    if (!rec) return res.status(404).json({ error: 'Registro não encontrado' });
    if (rec.user_id !== userId) return res.status(403).json({ error: 'Apenas o tutor pode editar' });
    if (rec.pet_id !== petId) return res.status(404).json({ error: 'Registro não encontrado' });

    const b = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (b.type !== undefined) {
      if (!HEALTH_TYPES.includes(b.type)) return res.status(400).json({ error: 'Tipo de registro inválido' });
      patch.type = b.type;
    }
    if (b.name !== undefined) patch.name = b.name ?? null;
    if (b.date_aplicada !== undefined) patch.date_aplicada = b.date_aplicada || null;
    if (b.proxima_data !== undefined) patch.proxima_data = b.proxima_data || null;
    if (b.vet !== undefined) patch.vet = b.vet ?? null;
    if (b.lote !== undefined) patch.lote = b.lote ?? null;
    if (b.obs !== undefined) patch.obs = b.obs ?? null;
    if (b.weight_kg !== undefined) {
      const w = parseWeight(b.weight_kg);
      if (w === INVALID_WEIGHT) return res.status(400).json({ error: 'Peso inválido' });
      patch.weight_kg = w;
    }
    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from('health_records').update(patch).eq('id', recordId);
      if (error) throw error;
    }
    res.json({ success: true });
  })
);

// DELETE /me/pets/:petId/health/:recordId — exclui um registro
app.delete(
  '/me/pets/:petId/health/:recordId',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { petId, recordId } = req.params;
    const { data: rec, error: recErr } = await supabase
      .from('health_records')
      .select('id, user_id, pet_id')
      .eq('id', recordId)
      .maybeSingle();
    if (recErr) throw recErr;
    if (!rec) return res.status(404).json({ error: 'Registro não encontrado' });
    if (rec.user_id !== userId) return res.status(403).json({ error: 'Apenas o tutor pode excluir' });
    if (rec.pet_id !== petId) return res.status(404).json({ error: 'Registro não encontrado' });
    const { error } = await supabase.from('health_records').delete().eq('id', recordId);
    if (error) throw error;
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

    // Sem taxa/escrow: apenas atualiza o valor informativo exibido no anúncio.
    const { data: existing } = await supabase
      .from('rewards')
      .select('id, amount, status')
      .eq('pet_id', petId)
      .in('status', ['pending', 'locked'])
      .maybeSingle();

    let rewardId: string;
    if (existing) {
      const newAmount = Number(existing.amount) + value;
      const { error } = await supabase
        .from('rewards')
        .update({ amount: newAmount })
        .eq('id', existing.id);
      if (error) throw error;
      rewardId = existing.id;
    } else {
      const { data: created, error } = await supabase
        .from('rewards')
        .insert({
          pet_id: petId,
          amount: value,
          fee_amount: 0,
          status: 'pending',
          payer_user_id: userId,
        })
        .select('id')
        .single();
      if (error) throw error;
      rewardId = created.id;
    }

    res.json({ success: true, rewardId, deltaAmount: value });
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

    // Sem escrow: apenas marca a recompensa como encerrada (registro), sem
    // movimentar dinheiro — o valor era só informativo no anúncio.
    await supabase
      .from('rewards')
      .update({ status: 'refunded', refunded_at: new Date().toISOString() })
      .eq('pet_id', petId)
      .in('status', ['pending', 'locked']);

    res.json({ success: true });
  })
);

// ============================================================================
// ENCERRAR SEM INDICAR USUÁRIO — o tutor encerra direto pelo alerta (perfil).
// Não credita ninguém como quem ajudou (indicar alguém = dupla confirmação
// pelo chat). found=true → 'encontrado' (habilita registrar o final feliz);
// found=false → 'cancelado'. Chats abertos são fechados sem indicação.
// ============================================================================
app.post(
  '/pets/:petId/close-without-finder',
  requireUser,
  asyncHandler(async (req, res) => {
    const { petId } = req.params;
    const userId = authedId(req);
    const found = req.body?.found === true;

    const { data: pet, error: petErr } = await supabase
      .from('pets')
      .select('id, user_id, status, name')
      .eq('id', petId)
      .single();
    if (petErr || !pet) return res.status(404).json({ error: 'Pet não encontrado' });
    if (pet.user_id !== userId) return res.status(403).json({ error: 'Apenas o tutor pode encerrar' });

    // Transição atômica: se uma dupla confirmação fechar o caso ao mesmo tempo,
    // só um dos caminhos vence.
    const { data: transitioned } = await supabase
      .from('pets')
      .update({ status: found ? 'encontrado' : 'cancelado' })
      .eq('id', petId)
      .eq('status', 'ativo')
      .select('id');
    if (!transitioned || transitioned.length === 0) {
      return res.status(400).json({ error: `Pet com status ${pet.status} não pode ser encerrado` });
    }

    const nowIso = new Date().toISOString();
    await supabase
      .from('chats')
      .update({ status: 'closed', found: false, closed_at: nowIso })
      .eq('pet_id', petId)
      .eq('status', 'open');

    // Recompensa é só informativa — marca como encerrada, sem movimentar dinheiro.
    await supabase
      .from('rewards')
      .update({ status: 'refunded', refunded_at: nowIso })
      .eq('pet_id', petId)
      .in('status', ['pending', 'locked']);

    if (found) {
      await notifyUser(userId, {
        title: 'Registre o final feliz! 🏆',
        body: `${pet.name ?? 'Seu pet'} está de volta! Registre o final feliz para inspirar outros tutores.`,
        type: 'success_case',
        pet_id: petId,
      });
    }

    res.json({ success: true, status: found ? 'encontrado' : 'cancelado' });
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

    // Demais interessados (fila) — capturados antes de fechar para notificar.
    const { data: others } = await supabase
      .from('chats').select('id, finder_id')
      .eq('pet_id', chat.pet_id).eq('status', 'open').neq('id', chat.id);

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
    await notifyUser(adopterId, {
      title: 'Doação confirmada! 🏡',
      body: `O doador confirmou que você adotou ${pet.name}. Cuide bem dele!`,
      type: 'donation_confirmed', pet_id: chat.pet_id, chat_id: chat.id,
    });

    // Avisa os demais interessados (fila) que o pet já foi adotado.
    if (others && others.length > 0) {
      for (const o of others as any[]) {
        await notifyUser(o.finder_id, {
          title: 'Pet adotado',
          body: `${pet.name} já foi adotado por outra pessoa. Obrigado pelo interesse! 🐾`,
          type: 'donation_closed', pet_id: chat.pet_id, chat_id: o.id,
        });
      }
    }

    res.json({ success: true });
  })
);

// ============================================================================
// FILA DE ADOÇÃO — chats abertos de um pet em doação, em ordem de chegada.
// A posição é derivada (sem schema): 1 = primeiro a chamar (atual da vez).
// ============================================================================
async function donationQueue(petId: string) {
  const { data } = await supabase
    .from('chats')
    .select('id, finder_id, created_at')
    .eq('pet_id', petId)
    .eq('status', 'open')
    .order('created_at', { ascending: true });
  return data ?? [];
}

app.get(
  '/chats/:chatId/queue',
  requireUser,
  asyncHandler(async (req, res) => {
    const me = authedId(req);
    const { chatId } = req.params;

    const { data: chat } = await supabase
      .from('chats').select('id, pet_id, tutor_id, finder_id, status').eq('id', chatId).single();
    if (!chat) return res.status(404).json({ error: 'Chat não encontrado' });
    if (chat.tutor_id !== me && chat.finder_id !== me) return res.status(403).json({ error: 'Sem permissão' });

    const { data: pet } = await supabase.from('pets').select('type').eq('id', chat.pet_id).single();
    if (!pet || pet.type !== 'donation') return res.json({ isDonation: false, position: 0, total: 0 });

    const queue = await donationQueue(chat.pet_id);
    const idx = queue.findIndex((c: any) => c.id === chat.id);
    res.json({ isDonation: true, total: queue.length, position: idx >= 0 ? idx + 1 : 0 });
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
    const { show_on_map, notification_channel, default_search_radius_m, travel_mode, pin_color, show_profile_photo, region_alerts_enabled } = req.body ?? {};

    const payload: Record<string, unknown> = {
      user_id: userId,
      show_on_map,
      notification_channel,
      default_search_radius_m,
      travel_mode,
      pin_color,
    };
    if (region_alerts_enabled !== undefined) {
      payload.region_alerts_enabled = !!region_alerts_enabled;
      // Privacidade: ao DESLIGAR o opt-in, apaga a localização persistida.
      if (!region_alerts_enabled) {
        payload.last_lat = null;
        payload.last_lng = null;
        payload.last_location_at = null;
      }
    }

    const { data, error } = await supabase.from('user_settings').upsert(payload).select().single();
    if (error) throw error;

    // Privacidade da foto fica em profiles.
    if (show_profile_photo !== undefined) {
      await supabase.from('profiles').update({ show_profile_photo: !!show_profile_photo }).eq('id', userId);
    }
    res.json({ ...data, ...(show_profile_photo !== undefined ? { show_profile_photo: !!show_profile_photo } : {}) });
  })
);

// ============================================================================
// CONTA — exclusão (LGPD). Remove o usuário e seus dados (cascata no banco).
// Sem escrow: a exclusão não é mais bloqueada por saldo/recompensas (carteira
// desativada). Limpa referências que não são cascata (adopter_user_id).
// ============================================================================
app.delete(
  '/user/account',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);

    // 1. Limpa referências NO ACTION (adoção) que bloqueariam a exclusão
    await supabase.from('pets').update({ adopter_user_id: null }).eq('adopter_user_id', userId);

    // 3. Remove o usuário do Auth — cascata apaga profiles + dados relacionados.
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) {
      // Provável bloqueio por histórico financeiro (rewards.payer RESTRICT).
      return res.status(409).json({
        error: 'Não foi possível excluir automaticamente devido ao histórico da conta. Fale com o suporte para concluir a exclusão.',
      });
    }

    res.json({ success: true });
  })
);

// ============================================================================
// PUSH TOKENS — registrar/remover o token de notificação do aparelho.
// ============================================================================
app.post(
  '/user/push-token',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { token, platform } = req.body ?? {};
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'token obrigatório' });
    }
    const plat = ['ios', 'android', 'web'].includes(platform) ? platform : null;
    // Upsert por token: se o aparelho trocou de conta, o token passa pro novo user.
    const { error } = await supabase
      .from('push_tokens')
      .upsert({ user_id: userId, token, platform: plat, updated_at: new Date().toISOString() }, { onConflict: 'token' });
    if (error) throw error;
    res.json({ success: true });
  })
);

app.delete(
  '/user/push-token',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { token } = req.body ?? {};
    if (token) {
      await supabase.from('push_tokens').delete().eq('token', token).eq('user_id', userId);
    }
    res.json({ success: true });
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
         pets!chats_pet_id_fkey ( id, name, type, main_photo_url, status, tutor_confirmed_at, finder_confirmed_at ),
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
// ============================================================================
// PUSH — envia notificação nativa (Expo Push) para todos os aparelhos do user.
// Não bloqueia o fluxo: erros são engolidos (a notificação no app já foi salva).
// ============================================================================
async function sendExpoPush(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
) {
  try {
    const { data: tokens } = await supabase
      .from('push_tokens').select('token').eq('user_id', userId);
    const list = (tokens ?? []).map((t: any) => t.token).filter(Boolean);
    if (list.length === 0) return;

    const messages = list.map((to: string) => ({
      to, title, body, sound: 'default',
      data: data ?? {},
      channelId: 'default',
      priority: 'high',
    }));

    const resp = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    // Remove tokens inválidos (DeviceNotRegistered) para não acumular lixo.
    const out: any = await resp.json().catch(() => null);
    const tickets = out?.data ?? [];
    const dead: string[] = [];
    tickets.forEach((t: any, i: number) => {
      if (t?.status === 'error' && t?.details?.error === 'DeviceNotRegistered') dead.push(list[i]);
    });
    if (dead.length) await supabase.from('push_tokens').delete().in('token', dead);
  } catch (e: any) {
    console.warn('[push] falha ao enviar:', e?.message);
  }
}

// Cria a notificação no app E dispara o push nativo, numa só chamada.
async function notifyUser(
  userId: string,
  n: { title: string; body: string; type?: string; pet_id?: string | null; chat_id?: string | null; ticket_id?: string | null; region_alert_id?: string | null },
) {
  await supabase.from('notifications').insert({
    user_id: userId,
    title: n.title,
    body: n.body,
    type: n.type ?? null,
    pet_id: n.pet_id ?? null,
    chat_id: n.chat_id ?? null,
    ticket_id: n.ticket_id ?? null,
    region_alert_id: n.region_alert_id ?? null,
  });
  // Enriquecimento: se a notificação é de um chat, incluímos os participantes
  // para o toque no push abrir a CONVERSA certa (o chat precisa de tutor+finder).
  let chatExtra: Record<string, unknown> = {};
  if (n.chat_id) {
    const { data: c } = await supabase
      .from('chats').select('tutor_id, finder_id, status').eq('id', n.chat_id).maybeSingle();
    if (c) chatExtra = { chat_tutor_id: c.tutor_id, chat_finder_id: c.finder_id, chat_status: c.status };
  }
  await sendExpoPush(userId, n.title, n.body, {
    type: n.type, pet_id: n.pet_id, chat_id: n.chat_id, ticket_id: n.ticket_id, region_alert_id: n.region_alert_id, ...chatExtra,
  });
}

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

    // Conversa encerrada não aceita novas mensagens (resposta limpa em vez do
    // erro do trigger do banco, que viraria 500).
    if (chat.status === 'closed') {
      return res.status(400).json({ error: 'Esta conversa foi encerrada.' });
    }

    const { data: msg, error } = await supabase
      .from('messages')
      .insert({ chat_id: chat.id, sender_id: senderId, content, photo_url })
      .select()
      .single();
    if (error) throw error;

    await notifyUser(receiverId, {
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
// Registra a confirmação de reencontro de UMA das partes (tutor ou buscador).
// O caso só encerra (pet 'encontrado') quando AMBOS confirmam. Sem dinheiro:
// marca a recompensa como 'paid' apenas para exibição e incrementa rescues_count
// exatamente uma vez (guardado pela transição atômica 'ativo'→'encontrado').
type RescueConfirmResult =
  | { ok: false; status: number; error: string }
  | { ok: true; closed: false; waitingOn: 'tutor' | 'finder' }
  | { ok: true; closed: true; finderId: string };

async function applyRescueConfirmation(params: {
  petId: string;
  chatId: string | null;
  confirmingUserId: string;
  tutorId: string;
  finderId: string;
}): Promise<RescueConfirmResult> {
  const { petId, chatId, confirmingUserId, tutorId, finderId } = params;
  const isTutor = confirmingUserId === tutorId;
  const isFinder = confirmingUserId === finderId;
  if (!isTutor && !isFinder) {
    return { ok: false, status: 403, error: 'Apenas o tutor ou quem encontrou pode confirmar' };
  }

  const nowIso = new Date().toISOString();
  // Marca a coluna da parte que confirma (só se ainda não marcada — idempotente).
  // O select devolve linha apenas quando o update de fato aconteceu: assim uma
  // reconfirmação repetida não duplica system message nem notificação.
  const { data: marked } = await supabase
    .from('pets')
    .update(isTutor ? { tutor_confirmed_at: nowIso } : { finder_confirmed_at: nowIso })
    .eq('id', petId)
    .is(isTutor ? 'tutor_confirmed_at' : 'finder_confirmed_at', null)
    .select('id');
  const justMarked = !!marked && marked.length > 0;

  const { data: pet } = await supabase
    .from('pets')
    .select('id, name, status, finder_confirmed_at, tutor_confirmed_at')
    .eq('id', petId)
    .single();
  if (!pet) return { ok: false, status: 404, error: 'Pet não encontrado' };

  const bothConfirmed = !!pet.finder_confirmed_at && !!pet.tutor_confirmed_at;

  if (!bothConfirmed) {
    if (justMarked) {
      // Registra no chat (a outra parte vê o card de confirmação inline) e avisa.
      if (chatId) {
        await supabase.from('messages').insert({
          chat_id: chatId,
          sender_id: confirmingUserId,
          content: `✅ ${isTutor ? 'O tutor' : 'Quem ajudou'} confirmou o reencontro. Falta a outra parte confirmar para encerrar o caso.`,
          system: true,
        });
      }
      const otherId = isTutor ? finderId : tutorId;
      await notifyUser(otherId, {
        title: 'Confirme o reencontro 🐾',
        body: `${isTutor ? 'O tutor' : 'Quem encontrou'} confirmou o reencontro. Confirme você também para encerrar o caso.`,
        type: 'rescue_pending',
        pet_id: petId,
        ...(chatId ? { chat_id: chatId } : {}),
      });
    }
    return { ok: true, closed: false, waitingOn: isTutor ? 'finder' : 'tutor' };
  }

  // Ambos confirmaram: só quem efetua a transição 'ativo'→'encontrado' faz o fecho
  // (garante fechamento/incremento uma única vez, mesmo com entrypoints concorrentes).
  const { data: transitioned } = await supabase
    .from('pets')
    .update({ status: 'encontrado' })
    .eq('id', petId)
    .eq('status', 'ativo')
    .select('id');

  if (transitioned && transitioned.length > 0) {
    if (chatId) {
      await supabase
        .from('chats')
        .update({ status: 'closed', found: true, closed_at: nowIso })
        .eq('id', chatId);
    }
    await supabase
      .from('chats')
      .update({ status: 'closed', found: false, closed_at: nowIso })
      .eq('pet_id', petId)
      .eq('status', 'open');

    // Reputação (não é dinheiro): incrementa rescues do buscador uma única vez.
    await supabase.rpc('profile_increment_rescues', { p_user_id: finderId });

    // Recompensa vira 'paid' só para EXIBIÇÃO — sem payout/transação/wallet.
    await supabase
      .from('rewards')
      .update({ status: 'paid', finder_user_id: finderId, paid_at: nowIso })
      .eq('pet_id', petId)
      .in('status', ['pending', 'locked']);

    // Fecho registrado na conversa (fica no histórico do chat encerrado).
    if (chatId) {
      await supabase.from('messages').insert({
        chat_id: chatId,
        sender_id: confirmingUserId,
        content: '🏆 Reencontro confirmado pelos dois! O caso foi encerrado.',
        system: true,
      });
    }

    await notifyUser(finderId, {
      title: 'Reencontro confirmado! 🎉',
      body: 'Obrigado por ajudar! Que tal avaliar essa experiência?',
      type: 'rescue_confirmed', pet_id: petId, ...(chatId ? { chat_id: chatId } : {}),
    });
    await notifyUser(tutorId, {
      title: 'Reencontro confirmado! 🎉',
      body: 'Caso encerrado. Que tal avaliar essa experiência?',
      type: 'rescue_confirmed', pet_id: petId, ...(chatId ? { chat_id: chatId } : {}),
    });
    // Convite para o tutor eternizar o caso (a notificação abre a tela de registro).
    await notifyUser(tutorId, {
      title: 'Registre o final feliz! 🏆',
      body: `${pet.name ?? 'Seu pet'} está de volta! Registre o final feliz para inspirar outros tutores.`,
      type: 'success_case',
      pet_id: petId,
    });
  }

  return { ok: true, closed: true, finderId };
}

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

    const { data: pet, error: petErr } = await supabase
      .from('pets')
      .select('id, status')
      .eq('id', chat.pet_id)
      .single();
    if (petErr || !pet) return res.status(404).json({ error: 'Pet não encontrado' });
    if (pet.status !== 'ativo') return res.status(400).json({ error: `Pet com status ${pet.status} não pode ser confirmado` });

    const result = await applyRescueConfirmation({
      petId: chat.pet_id,
      chatId: chat.id,
      confirmingUserId: userId,
      tutorId: chat.tutor_id,
      finderId: chat.finder_id,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    if (result.closed) return res.json({ success: true, closed: true, finderId: result.finderId });
    return res.json({ success: true, pending: true, waitingOn: result.waitingOn });
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
      .from('chats').select('id, pet_id, tutor_id, finder_id, status').eq('id', chatId).single();
    if (chatErr || !chat) return res.status(404).json({ error: 'Chat não encontrado' });
    if (chat.tutor_id !== userId && chat.finder_id !== userId) {
      return res.status(403).json({ error: 'Sem permissão' });
    }
    if (chat.status === 'closed') return res.json({ success: true });

    // Fila de adoção: se este chat de doação estava na frente, o próximo assume.
    let advance: { chatId: string; finderId: string; petName: string } | null = null;
    const { data: pet } = await supabase
      .from('pets').select('name, type').eq('id', chat.pet_id).single();
    if (pet?.type === 'donation') {
      const queue = await donationQueue(chat.pet_id);
      if (queue[0]?.id === chatId && queue[1]) {
        advance = { chatId: queue[1].id, finderId: queue[1].finder_id, petName: pet.name };
      }
    }

    await supabase
      .from('chats')
      .update({ status: 'closed', closed_at: new Date().toISOString(), found: false })
      .eq('id', chatId);

    // Avisa o novo 1º da fila que chegou a vez dele.
    if (advance) {
      await notifyUser(advance.finderId, {
        title: 'É a sua vez! 🐾',
        body: `Chegou sua vez de conversar sobre a adoção de ${advance.petName}.`,
        type: 'donation_turn', pet_id: chat.pet_id, chat_id: advance.chatId,
      });
      await supabase.from('messages').insert({
        chat_id: advance.chatId, sender_id: chat.tutor_id,
        content: '🐾 É a sua vez na fila de adoção! O doador está disponível para conversar.',
        system: true,
      });
    }

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

    // Segurança: o e-mail precisa ser de quem REALMENTE tem conversa neste caso —
    // evita creditar resgate/reputação a uma conta arbitrária escolhida pelo tutor.
    const { count: finderChats } = await supabase
      .from('chats')
      .select('id', { count: 'exact', head: true })
      .eq('pet_id', petId)
      .eq('finder_id', finder.id);
    if (!finderChats) return res.status(400).json({ message: 'Esse usuário não tem conversa neste caso.' });

    // Registra a confirmação do TUTOR (dupla confirmação — o buscador confirma no chat).
    const result = await applyRescueConfirmation({
      petId,
      chatId: null,
      confirmingUserId: tutorId,
      tutorId,
      finderId: finder.id,
    });
    if (!result.ok) return res.status(result.status).json({ message: result.error });
    if (result.closed) return res.json({ success: true, closed: true, finderId: finder.id });
    return res.json({ success: true, pending: true, waitingOn: result.waitingOn });
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
        `id, user_id, title, body, type, pet_id, chat_id, ticket_id, region_alert_id, read, created_at,
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
        region_alert_id: n.region_alert_id ?? null,
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
  asyncHandler(async (_req, res) => {
    // Escrow desativado: saques indisponíveis (carteira escondida no app). A
    // infra (RPC wallet_try_debit, transações) permanece no banco para
    // reativação futura; a rota fica registrada mas bloqueada.
    res.status(410).json({ error: 'Saques temporariamente indisponíveis.' });
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
    const userId = authedId(req);
    const { photo_url, latitude, longitude, seen_at } = req.body ?? {};

    if (!photo_url) return res.status(400).json({ error: 'photo_url obrigatório' });
    if (!isEmbeddingEnabled()) {
      return res.status(503).json({ error: 'Reconhecimento por IA não configurado (REPLICATE_API_TOKEN ausente)' });
    }

    const { threshold, radiusM, strongThreshold } = await getMatchConfig();
    const hasLoc = Number.isFinite(latitude) && Number.isFinite(longitude);
    const seenAtMs = seen_at && Number.isFinite(new Date(seen_at).getTime()) ? new Date(seen_at).getTime() : Date.now();
    const FUTURE_GRACE_MS = 24 * 60 * 60 * 1000; // pet não pode ter sido perdido DEPOIS do avistamento

    // 1. Em paralelo (escondem a latência): embedding (CLIP, sinal visual) +
    //    características/manchas/padrões da foto (vision-tags, best-effort).
    const [embRes, tagRes] = await Promise.allSettled([
      generateImageEmbedding(photo_url, { maxRetries: 1 }), // busca: falha rápido (a fila já evita 429)
      generatePetVisionTags(photo_url),
    ]);
    if (embRes.status === 'rejected') {
      return res.status(502).json({ error: `Falha ao analisar a foto: ${embRes.reason?.message ?? 'erro'}` });
    }
    const embedding: number[] = embRes.value;
    let searchTags = null;
    if (tagRes.status === 'fulfilled') searchTags = tagRes.value;
    else console.warn('[match] vision-tags da busca falharam:', tagRes.reason?.message);

    // 2. Candidatos — pool maior (60) p/ o filtro de raio não cortar recall
    const { data, error } = await supabase.rpc('match_pets', {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: 60,
    });
    if (error) throw error;
    const candidates: any[] = data ?? [];

    // 2b. vision_tags dos candidatos (a RPC não retorna esse campo)
    const candIds = candidates.map((p) => p.id);
    const tagsById = new Map<string, any>();
    if (candIds.length) {
      const { data: tagRows } = await supabase.from('pets').select('id, vision_tags').in('id', candIds);
      (tagRows ?? []).forEach((r: any) => tagsById.set(r.id, r.vision_tags));
    }

    // 3. Perfis dos donos (nome + foto respeitando a privacidade)
    const ownerIds = Array.from(new Set(candidates.map((p) => p.user_id)));
    const ownerById = new Map<string, any>();
    if (ownerIds.length) {
      const { data: owners } = await supabase
        .from('profiles')
        .select('id, full_name, photo_url, show_profile_photo')
        .in('id', ownerIds);
      (owners ?? []).forEach((o: any) => { gateProfilePhoto(o); ownerById.set(o.id, o); });
    }

    // 4. Filtros duros (espécie + temporal) + score híbrido (visual + atributos + geo)
    // Espécie efetiva do candidato = coluna do cadastro OU espécie das vision-tags
    // (pets antigos têm species=null no cadastro; as tags do backfill cobrem isso).
    const candSpeciesOf = (p: any): string | null =>
      p.species ?? tagsById.get(p.id)?.species ?? null;
    const scored = candidates
      .filter((p) => {
        const cs = candSpeciesOf(p);
        return !(searchTags?.species && cs && searchTags.species !== cs);
      })
      .filter((p) => {
        const ld = p.lost_date ? new Date(p.lost_date).getTime() : null;
        return ld == null || ld <= seenAtMs + FUTURE_GRACE_MS;
      })
      .map((p) => {
        const distance = hasLoc ? haversineMeters(latitude, longitude, p.latitude, p.longitude) : null;
        const visualSim = Number(p.similarity); // 0..1
        const { score: attrScore, reasons, comparable, disagree, gate } = attributeAgreement(searchTags, {
          vision_tags: tagsById.get(p.id), color: p.color, size: p.size,
        });
        let score = hybridScore(visualSim, attrScore, comparable > 0, distance, radiusM);
        // Penaliza discordâncias claras (cor/porte muito diferentes) — empurra pra
        // baixo candidatos visualmente "parecidos" que claramente NÃO são o pet.
        if (disagree > 0) score *= Math.max(0.4, 1 - 0.25 * disagree);
        const candSpecies = candSpeciesOf(p);
        const speciesOk = !searchTags?.species || !candSpecies || searchTags.species === candSpecies;
        const strength: 'forte' | 'possivel' =
          disagree === 0 &&
          (visualSim >= strongThreshold || (score >= strongThreshold && attrScore >= 0.5 && reasons.length >= 1)) &&
          speciesOk
            ? 'forte' : 'possivel';
        const owner = ownerById.get(p.user_id);
        return {
          id: p.id, name: p.name, breed: p.breed, color: p.color, size: p.size, sex: p.sex, age_group: p.age_group,
          species: p.species ?? null, type: p.type ?? 'lost', description: p.description, extra_info: p.extra_info,
          photo_url: p.main_photo_url, latitude: p.latitude, longitude: p.longitude, lost_date: p.lost_date, status: p.status,
          user: { id: p.user_id, name: owner?.full_name ?? 'Tutor', photo_url: owner?.photo_url ?? null },
          similarity: Math.round(visualSim * 100), // 0-100 (sinal visual puro)
          match_score: Math.round(score * 100),    // 0-100 (sinal combinado — usado p/ ordenar)
          strength,
          reasons,
          gate, // gate de cor disparou (instrumentação p/ calibrar)
          distance,
        };
      })
      .filter((r) => !hasLoc || (r.distance != null && r.distance <= radiusM))
      .sort((a, b) => b.match_score - a.match_score);

    // Cor claramente incompatível (gate de alta precisão) ⇒ quase certamente NÃO é
    // o mesmo pet: oculta da lista exibida. O gate só dispara com inversão de cor
    // dominante + confiança alta dos dois lados + salto de luminância — nunca no
    // mesmo pet sob luz diferente (verificado). Os gated ficam no log p/ calibrar.
    const results = scored.filter((r) => !r.gate);

    // 5. Instrumentação (best-effort) — registra a busca p/ avaliar/calibrar depois
    let searchId: string | null = null;
    try {
      const { data: srow } = await supabase
        .from('match_searches')
        .insert({
          searcher_id: userId,
          photo_url,
          latitude: hasLoc ? latitude : null,
          longitude: hasLoc ? longitude : null,
          species: searchTags?.species ?? null,
          search_tags: searchTags,
          seen_at: new Date(seenAtMs).toISOString(),
          candidate_count: candidates.length,
          results: scored.slice(0, 10).map((r) => ({
            pet_id: r.id, similarity: r.similarity, match_score: r.match_score, strength: r.strength, gate: r.gate,
          })),
        })
        .select('id')
        .single();
      searchId = srow?.id ?? null;
    } catch (e: any) {
      console.warn('[match] log da busca falhou:', e.message);
    }

    // Retrocompatível: o corpo continua sendo o array de resultados (como antes,
    // para não quebrar apps antigos no deploy); o id da busca vai no header.
    res.setHeader('X-Match-Search-Id', searchId ?? '');
    res.json(results);
  })
);

// Feedback do match: registra o desfecho da busca (instrumentação p/ avaliação).
app.post(
  '/pets/match/feedback',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { search_id, outcome, chosen_pet_id } = req.body ?? {};
    if (!search_id) return res.status(400).json({ error: 'search_id obrigatório' });
    if (outcome && !['contacted', 'none_matched'].includes(outcome)) {
      return res.status(400).json({ error: 'outcome inválido' });
    }
    const { error } = await supabase
      .from('match_searches')
      .update({ outcome: outcome ?? null, chosen_pet_id: chosen_pet_id ?? null })
      .eq('id', search_id)
      .eq('searcher_id', userId);
    if (error) throw error;
    res.json({ success: true });
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

// Backfill: gera as vision-tags (características) dos pets que ainda não têm.
app.post(
  '/admin/backfill-vision-tags',
  aiLimiter,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    if (!isVisionTagsEnabled()) {
      return res.status(503).json({ error: 'ANTHROPIC_API_KEY ausente' });
    }
    const { data: allActive, error } = await supabase
      .from('pets')
      .select('id, main_photo_url, species, vision_tags')
      .eq('status', 'ativo');
    if (error) throw error;
    // Re-tagueia quem não tem tags OU tem tags antigas sem coat_colors (idempotente).
    const pets = (allActive ?? []).filter(
      (p: any) => !p.vision_tags || !Array.isArray(p.vision_tags.coat_colors) || p.vision_tags.coat_colors.length === 0,
    );

    res.json({ message: `Backfill de características iniciado para ${pets.length} pets`, count: pets.length });

    (async () => {
      for (const pet of pets) {
        try {
          const tags = await generatePetVisionTags(pet.main_photo_url);
          if (tags) {
            const patch: any = { vision_tags: tags };
            if (tags.species && !pet.species) patch.species = tags.species;
            await supabase.from('pets').update(patch).eq('id', pet.id);
          }
          console.log(`[backfill-vision] pet ${pet.id} OK`);
        } catch (e: any) {
          console.error(`[backfill-vision] pet ${pet.id} falhou:`, e.message);
        }
      }
      console.log('[backfill-vision] concluído');
    })();
  })
);

// ============================================================================
// PREMIUM — status, assinar, controle de uso de busca por IA
// ============================================================================
// Gateado por PREMIUM_ENABLED (declarada no topo do arquivo). Hoje = false:
// tudo liberado para todos (buscas por IA ilimitadas, sem paywall). No lugar,
// o app oferece a área "Apoie o app" (doação voluntária).
const AI_SEARCH_MONTHLY_LIMIT = 5;

app.get(
  '/user/:userId/premium/status',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);

    if (!PREMIUM_ENABLED) {
      return res.json({
        premiumEnabled: false,
        isPremium: false,
        expiresAt: null,
        plan: null,
        aiSearchesLeft: null, // null = ilimitado
        aiSearchesUsed: 0,
        aiSearchesLimit: null,
        premiumSettings: {
          rewardMinAmount: 0,
          rewardMaxAmount: null,
          alertEnabled: true,
          highlightOnMap: true,
        },
      });
    }

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

    if (!PREMIUM_ENABLED) {
      return res.status(403).json({
        error: 'Assinaturas estão desativadas — o app está 100% gratuito. Se quiser ajudar, use a área "Apoie o app".',
      });
    }

    if (!['monthly', 'lifetime'].includes(planType)) {
      return res.status(400).json({ error: 'planType deve ser monthly ou lifetime' });
    }

    // Mensal R$ 9,90 · Vitalício R$ 79,90 (pagamento simulado nesta fase)
    const PRICE = planType === 'lifetime' ? 79.90 : 9.90;
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
    // check_only = só verifica se pode buscar, SEM debitar a cota. O app debita
    // de verdade apenas após a busca por IA dar certo (não queima cota em falha).
    const checkOnly = req.body?.check_only === true;

    // Premium desativado → buscas ilimitadas para todos, nunca bloqueia (402).
    if (!PREMIUM_ENABLED) {
      return res.json({ allowed: true, isPremium: false, aiSearchesLeft: null, unlimited: true });
    }

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

    if (checkOnly) {
      return res.json({
        allowed: true,
        isPremium: false,
        aiSearchesLeft: AI_SEARCH_MONTHLY_LIMIT - searchesThisMonth,
        aiSearchesUsed: searchesThisMonth,
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
      await notifyUser(lost.user_id, {
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
      await notifyUser(publisherId, {
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
      // Dupla confirmação: registra o lado do tutor; quem resgatou confirma no chat.
      const result = await applyRescueConfirmation({
        petId: chat.pet_id,
        chatId: chat.id,
        confirmingUserId: tutorId,
        tutorId,
        finderId: chat.finder_id,
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });

      const sysMsg = result.closed
        ? '🏆 Reencontro confirmado pelos dois! O caso foi encerrado.'
        : '✅ O tutor confirmou o reencontro. Aguardando quem resgatou confirmar para encerrar.';
      await supabase.from('messages').insert({
        chat_id: chat.id, sender_id: tutorId, content: sysMsg, system: true,
      });

      return res.json({
        success: true, sighting, sourceType: src.type, rescued: true,
        ...(result.closed ? { closed: true } : { pending: true, waitingOn: result.waitingOn }),
      });
    }

    // ---- AVISTAMENTO: apenas entra na linha do tempo do caso ---------------
    await supabase.from('messages').insert({
      chat_id: chat.id,
      sender_id: tutorId,
      content: '✅ O tutor confirmou que é o pet dele. Avistamento adicionado ao caso.',
      system: true,
    });
    await notifyUser(chat.finder_id, {
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
        return res.status(409).json({ error: 'Você já avaliou esta pessoa neste caso' });
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
PetPerdidoSOS conecta tutores de pets perdidos com buscadores voluntários da região, e também conecta pets para adoção a novos lares. Disponível para Android.

## NAVEGAÇÃO (abas na parte de baixo)
- **Mapa SOS** — mapa com os pets próximos (perdidos, vistos, resgatados)
- **Alertas** — lista dos pets da região com filtros e busca
- **Novo alerta** (ícone de megafone) — cadastrar um pet
- **Doação** (ícone de coração) — área de adoção: pets disponíveis para um novo lar
- **Chats** — suas conversas
- **Perfil** — sua conta, carteira, configurações

## TIPOS DE ALERTA
- **Pet perdido** (vermelho) — tutor que perdeu o pet
- **Pet visto** (laranja) — alguém viu um pet na rua
- **Pet resgatado** (verde) — alguém resgatou e procura o dono
- **Pet em doação** (azul) — pet disponível para adoção (fica na aba Doação, não no Mapa SOS)

## FUNCIONALIDADES

**Mapa SOS:**
- Mostra pets perdidos, vistos e resgatados próximos, com marcador de foto circular
- A doação NÃO aparece no Mapa SOS — tem a aba "Doação" própria
- Toque na barra do topo para abrir os Filtros: raio (atalhos 1, 5, 10, 30, 50 km, ajuste fino com − / + ou "Brasil todo"), espécie, cor e busca por CEP ou endereço. O painel mostra em tempo real quantos pets há por status (perdido/visto/resgatado)
- Legenda no topo funciona como filtro: toque para mostrar/ocultar cada tipo
- Toque 1× no marcador para ver a caixinha; toque de novo / "ver detalhes" abre o card completo (com recompensa, tutor, distância, endereço aproximado)
- Botão "Rota" traça o caminho a pé até o pet
- Botão de seta (canto inferior direito) ativa o modo seguir (mapa inclinado, estilo Waze); seu pino acompanha o GPS mesmo fora do modo seguir
- Ícones de pessoa = buscadores online na região

**Aba Alertas:**
- Lista os pets da região com filtros (espécie, raça, cor, raio) e busca por CEP/endereço
- Cada card mostra tipo, distância e endereço aproximado
- "Ver no mapa" centraliza o pet no mapa; "Ver detalhes" abre a ficha

**Cadastrar (aba Novo alerta):**
- Escolha o tipo: "Perdi meu pet", "Vi um pet", "Resgatei um pet" ou "Doar um pet"
- Preencha espécie, raça, cor, porte, sexo, idade, fotos e localização (GPS ou marcar no mapa, com busca por CEP/endereço)
- Pet perdido: pode informar um valor de recompensa — combinado diretamente com quem ajudar (o app não intermedia o pagamento)
- Doação: descreva as regras de adoção e marque os 2 consentimentos (responsabilidades de doar; já procurou o dono antes)
- Após cadastrar um pet visto/resgatado, o app oferece o reconhecimento facial para achar um pet perdido parecido

**Encontrei um pet (IA):**
- Botão "Encontrei um pet" no mapa → tire ou envie a foto
- A IA compara com os pets cadastrados e mostra os mais parecidos
- Se nada combinar, dá para cadastrar um pet visto ou resgatado já com a foto da busca
- Inicie a conversa com o tutor pelo chat

**Doação / Adoção (aba Doação):**
- Lista os pets disponíveis para adoção, com filtros: espécie, idade, raça, cor e CEP/endereço
- Toque no pet para ver a ficha (fotos, características, descrição, regras de adoção e o doador)
- "Tenho interesse — falar com o tutor" abre o chat com o doador
- Para doar: botão "Doar" na aba Doação, ou transforme um pet resgatado em doação
- **Fila de adoção:** os interessados entram numa fila por ordem de chegada (quem chamou primeiro fica na frente). Você vê sua posição no chat ("você é o 2º de 4"). Quando alguém à frente sai sem adotar, a fila avança e o próximo é avisado "é a sua vez"
- O doador confirma a adoção pelo chat (relaciona o adotante) ou conclui como "doado em outro local"

**Chat:**
- Converse diretamente pelo app
- Reencontro: as DUAS partes confirmam pelo chat (tutor e quem ajudou); quando ambos confirmam, o caso encerra e cada um avalia o outro (1 a 5 estrelas)
- Doação: o doador toca em "Confirmar doação" para registrar quem adotou
- Conversa encerrada não aceita novas mensagens
- Dá para denunciar usuários pelo botão de flag

**Recompensa:**
- O valor é apenas informativo no anúncio — combinado e pago DIRETAMENTE entre o tutor e quem ajudar
- O app NÃO intermedia nem retém o pagamento e não cobra taxa
- Ao encerrar um reencontro, o app pode sugerir uma doação voluntária para ajudar a manter o projeto (opcional)

**App 100% gratuito (NÃO existe plano pago):**
- Todos os recursos são gratuitos, inclusive os reconhecimentos por IA, que são ilimitados
- NÃO há assinatura, plano premium, mensalidade nem cobrança de nenhum tipo. Nunca ofereça um plano pago ao usuário
- Quem quiser ajudar a manter o projeto no ar pode fazer uma doação voluntária em Perfil → "Apoie o app" (sempre opcional, nunca obrigatória)

**Privacidade e Segurança (Perfil → Privacidade e Segurança):**
- Aparecer ou não como buscador no mapa; mostrar ou ocultar a foto de perfil
- Alterar a senha (pede a senha atual)
- Sair de todos os dispositivos
- Excluir a conta (apaga os dados permanentemente)

**Configurações (Perfil → Configurações):**
- Notificações de novos alertas, raio de busca padrão, modo de locomoção (para rotas) e cor do seu pino no mapa

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
// Sentry captura os erros que chegam até aqui (antes de responder ao cliente).
// ============================================================================
// ALERTA DE REGIÃO — tutor destaca o pet perdido para buscadores no raio.
// Entrega: Via A (push, localização persistida + opt-in) + Via B (banner ao vivo
// para quem está ativo no raio). Curtir/denunciar; muitas denúncias desativam.
// ============================================================================

async function getRegionAlertConfig() {
  const { data } = await supabase
    .from('app_settings')
    .select('region_alert_radius_m, region_alert_cooldown_h, region_alert_reports_to_deactivate')
    .eq('id', 1)
    .maybeSingle();
  return {
    radiusM: Number(data?.region_alert_radius_m) || 10000,
    cooldownH: Number(data?.region_alert_cooldown_h) || 24,
    reportsToDeactivate: Number(data?.region_alert_reports_to_deactivate) || 5,
  };
}

// Push em lote (chunks de 100 — limite do Expo). Best-effort; poda tokens mortos.
async function sendExpoPushBatch(tokens: string[], title: string, body: string, data?: Record<string, unknown>) {
  const uniq = Array.from(new Set(tokens.filter(Boolean)));
  const dead: string[] = [];
  for (let i = 0; i < uniq.length; i += 100) {
    const chunk = uniq.slice(i, i + 100);
    const messages = chunk.map((to) => ({ to, title, body, sound: 'default', data: data ?? {}, channelId: 'default', priority: 'high' }));
    try {
      const resp = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      });
      const out: any = await resp.json().catch(() => null);
      (out?.data ?? []).forEach((t: any, idx: number) => {
        if (t?.status === 'error' && t?.details?.error === 'DeviceNotRegistered') dead.push(chunk[idx]);
      });
    } catch (e: any) {
      console.warn('[push-batch] falha:', e?.message);
    }
  }
  if (dead.length) await supabase.from('push_tokens').delete().in('token', dead);
}

// Monta o payload da tela do alerta (pet + tutor + recompensa + comentário).
async function buildRegionAlertView(alertId: string, viewerId: string) {
  const { data: alert } = await supabase.from('region_alerts').select('*').eq('id', alertId).maybeSingle();
  if (!alert) return null;
  const [{ data: pet }, { data: tutor }, { data: reward }, { data: liked }] = await Promise.all([
    supabase.from('pets').select('id, name, species, breed, main_photo_url, lost_date, latitude, longitude, status').eq('id', alert.pet_id).maybeSingle(),
    supabase.from('profiles').select('id, full_name, photo_url, show_profile_photo').eq('id', alert.tutor_id).maybeSingle(),
    supabase.from('rewards').select('amount').eq('pet_id', alert.pet_id).in('status', ['pending', 'locked', 'paid']).order('amount', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('region_alert_likes').select('alert_id').eq('alert_id', alertId).eq('user_id', viewerId).maybeSingle(),
  ]);
  if (tutor) gateProfilePhoto(tutor);
  return {
    id: alert.id,
    status: alert.status,
    comment: alert.comment,
    radius_m: alert.radius_m,
    likes_count: alert.likes_count,
    my_liked: !!liked,
    latitude: alert.latitude,
    longitude: alert.longitude,
    created_at: alert.created_at,
    pet: pet ?? null,
    tutor: tutor ? { id: tutor.id, full_name: tutor.full_name, photo_url: tutor.photo_url } : null,
    reward_amount: reward?.amount != null ? Number(reward.amount) : null,
  };
}

// Fan-out (Via A): busca destinatários no raio (opt-in + localização fresca + token),
// insere notificações e dispara push em lote. Roda em background (fire-and-forget).
async function fanOutRegionAlert(
  alertId: string, petId: string, tutorId: string, petName: string,
  lat: number, lng: number, cfg: { radiusM: number }, comment: string | null,
) {
  try {
    const freshSince = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(); // localização dos últimos 7 dias
    const { data: recips } = await supabase.rpc('region_alert_recipients', {
      p_lat: lat, p_lng: lng, p_radius_m: cfg.radiusM, p_exclude: tutorId, p_fresh_since: freshSince,
    });
    const rows = (recips ?? []) as { user_id: string; token: string }[];
    if (rows.length === 0) return;
    const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
    const tokens = rows.map((r) => r.token).filter(Boolean) as string[]; // LEFT JOIN pode trazer token null
    const title = '🔎 Pet perdido perto de você';
    const body = comment ? `${petName}: ${comment}` : `Ajude a encontrar ${petName} na sua região.`;
    await supabase.from('notifications').insert(
      userIds.map((uid) => ({ user_id: uid, title, body, type: 'region_alert', pet_id: petId, region_alert_id: alertId })),
    );
    await sendExpoPushBatch(tokens, title, body, { type: 'region_alert', alert_id: alertId, pet_id: petId });
  } catch (e: any) {
    console.warn('[region-alert fanout]', e?.message);
  }
}

// POST /pets/:petId/region-alert — tutor dispara o alerta (rate-limit por cooldown).
app.post(
  '/pets/:petId/region-alert',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const { petId } = req.params;
    const { comment, add_to_timeline } = req.body ?? {};

    const { data: pet } = await supabase
      .from('pets').select('id, user_id, status, latitude, longitude, type, name').eq('id', petId).maybeSingle();
    if (!pet) return res.status(404).json({ error: 'Pet não encontrado' });
    if (pet.user_id !== userId) return res.status(403).json({ error: 'Apenas o tutor pode alertar a região' });
    if (pet.type !== 'lost') return res.status(400).json({ error: 'Só pets perdidos podem alertar a região' });
    if (pet.status !== 'ativo') return res.status(400).json({ error: 'O caso não está ativo' });
    if (!Number.isFinite(Number(pet.latitude)) || !Number.isFinite(Number(pet.longitude))) {
      return res.status(400).json({ error: 'Pet sem localização definida' });
    }

    const cfg = await getRegionAlertConfig();
    const cleanComment = comment ? String(comment).trim().slice(0, 500) || null : null;

    // Criação atômica: a função serializa cooldown-check + insert por pet (advisory
    // lock), eliminando a corrida que gerava 2 alertas + push duplicado.
    const { data: created, error } = await supabase.rpc('create_region_alert', {
      p_pet: petId, p_tutor: userId,
      p_lat: Number(pet.latitude), p_lng: Number(pet.longitude),
      p_radius: cfg.radiusM, p_comment: cleanComment, p_timeline: !!add_to_timeline, p_cooldown_h: cfg.cooldownH,
    });
    if (error) throw error;
    const row = (Array.isArray(created) ? created[0] : created) as
      | { alert_id: string | null; blocked: boolean; next_at: string | null }
      | undefined;
    if (!row) throw new Error('create_region_alert não retornou resultado');
    if (row.blocked) {
      return res.status(429).json({ error: 'Você já alertou a região recentemente.', nextAvailableAt: row.next_at });
    }

    // Responde já; o fan-out (push + notificações) roda em background.
    res.status(201).json({ alertId: row.alert_id, radius_m: cfg.radiusM });
    void fanOutRegionAlert(row.alert_id!, petId, userId, pet.name ?? 'um pet', Number(pet.latitude), Number(pet.longitude), cfg, cleanComment);
  })
);

// GET /region-alerts/:id — dados da tela do alerta.
app.get(
  '/region-alerts/:id',
  requireUser,
  asyncHandler(async (req, res) => {
    const viewerId = authedId(req);
    const view = await buildRegionAlertView(req.params.id, viewerId);
    if (!view) return res.status(404).json({ error: 'Alerta não encontrado' });
    // Alertas desativados (por moderação) não são servidos a estranhos — só ao tutor.
    if (view.status !== 'active' && view.tutor?.id !== viewerId) {
      return res.status(404).json({ error: 'Alerta não encontrado' });
    }
    res.json(view);
  })
);

// POST /region-alerts/nearby — Via B (banner ao vivo p/ quem está ativo no raio).
// Coordenadas vão no CORPO (nunca na query string) p/ não vazarem em logs/Sentry.
app.post(
  '/region-alerts/nearby',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat e lng obrigatórios' });
    const since = new Date(Date.now() - 12 * 3600 * 1000).toISOString(); // alertas das últimas 12h
    const { data: alerts } = await supabase.rpc('region_alerts_near_user', { p_lat: lat, p_lng: lng, p_user: userId, p_since: since });
    const list = (alerts ?? []) as any[];
    if (list.length === 0) return res.json({ alerts: [] });
    const views = await Promise.all(list.slice(0, 5).map((a) => buildRegionAlertView(a.id, userId)));
    res.json({ alerts: views.filter(Boolean) });
  })
);

// POST /region-alerts/:id/seen — marca como visto (não reabrir o banner).
app.post(
  '/region-alerts/:id/seen',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    await supabase.from('region_alert_views').upsert({ alert_id: req.params.id, user_id: userId }, { onConflict: 'alert_id,user_id' });
    res.json({ success: true });
  })
);

// POST /region-alerts/:id/like — alterna curtida.
app.post(
  '/region-alerts/:id/like',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const alertId = req.params.id;
    const { data: existing } = await supabase.from('region_alert_likes').select('id').eq('alert_id', alertId).eq('user_id', userId).maybeSingle();
    let liked: boolean;
    if (existing) {
      await supabase.from('region_alert_likes').delete().eq('id', existing.id);
      liked = false;
    } else {
      const { error } = await supabase.from('region_alert_likes').insert({ alert_id: alertId, user_id: userId });
      if (error && (error as any).code !== '23505') throw error;
      liked = true;
    }
    const { count } = await supabase.from('region_alert_likes').select('id', { count: 'exact', head: true }).eq('alert_id', alertId);
    await supabase.from('region_alerts').update({ likes_count: count ?? 0 }).eq('id', alertId);
    res.json({ liked, likes_count: count ?? 0 });
  })
);

// POST /region-alerts/:id/report — denuncia; muitas denúncias desativam e vão ao admin.
app.post(
  '/region-alerts/:id/report',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const alertId = req.params.id;
    const { reason } = req.body ?? {};
    const { data: alert } = await supabase.from('region_alerts').select('id, tutor_id, status').eq('id', alertId).maybeSingle();
    if (!alert) return res.status(404).json({ error: 'Alerta não encontrado' });
    if (alert.tutor_id === userId) return res.status(400).json({ error: 'Você não pode denunciar seu próprio alerta' });

    const { data: dup } = await supabase.from('reports').select('id').eq('region_alert_id', alertId).eq('reporter_id', userId).maybeSingle();
    if (dup) return res.status(409).json({ error: 'Você já denunciou este alerta' });

    const { error: insErr } = await supabase.from('reports').insert({
      reporter_id: userId, reported_id: alert.tutor_id, region_alert_id: alertId,
      reason: reason ? String(reason).slice(0, 500) : 'Denúncia de alerta de região', status: 'pending',
    });
    if (insErr) {
      // 23505 = índice único (region_alert_id, reporter_id): denúncia duplicada em corrida.
      if ((insErr as { code?: string }).code === '23505') return res.status(409).json({ error: 'Você já denunciou este alerta' });
      throw insErr;
    }

    // Conta só denúncias ABERTAS (pending/reviewing): as já descartadas pela moderação
    // não recontam, senão a reativação do admin seria anulada por 1 nova denúncia.
    const { count } = await supabase.from('reports').select('id', { count: 'exact', head: true })
      .eq('region_alert_id', alertId).in('status', ['pending', 'reviewing']);
    const reportsCount = count ?? 0;
    await supabase.from('region_alerts').update({ reports_count: reportsCount }).eq('id', alertId);

    const cfg = await getRegionAlertConfig();
    let deactivated = false;
    if (reportsCount >= cfg.reportsToDeactivate && alert.status === 'active') {
      await supabase.from('region_alerts').update({ status: 'deactivated' }).eq('id', alertId);
      await supabase.from('reports').update({ status: 'reviewing' }).eq('region_alert_id', alertId).eq('status', 'pending');
      await notifyUser(alert.tutor_id, {
        title: 'Alerta de região desativado',
        body: 'Seu alerta recebeu denúncias e está em análise pela moderação.',
        type: 'region_alert_paused', pet_id: null, region_alert_id: alertId,
      });
      deactivated = true;
    }
    res.json({ success: true, reportsCount, deactivated });
  })
);

// POST /me/location — persiste a última localização (SÓ com opt-in de alertas de região).
app.post(
  '/me/location',
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = authedId(req);
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'lat e lng obrigatórios' });
    const { data: us } = await supabase.from('user_settings').select('region_alerts_enabled').eq('user_id', userId).maybeSingle();
    if (!us?.region_alerts_enabled) return res.json({ stored: false });
    await supabase.from('user_settings').update({ last_lat: lat, last_lng: lng, last_location_at: new Date().toISOString() }).eq('user_id', userId);
    res.json({ stored: true });
  })
);

Sentry.setupExpressErrorHandler(app);

app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[error]', err);
  const status = Number.isInteger(err.status) ? (err.status as number) : 500;
  // Não vaza detalhes internos (mensagens do Postgres, stack) ao cliente.
  res.status(status).json({ error: status === 500 ? 'Erro interno do servidor' : err.message });
});

// Backfill automático na subida: gera embedding + vision-tags dos pets ativos
// que ainda não têm (idempotente; serializado pela fila do embedding). Assim os
// pets já cadastrados ganham as características sem nenhuma ação manual.
async function autoBackfillMatchData() {
  try {
    if (isEmbeddingEnabled()) {
      const { data } = await supabase.from('pets').select('id, main_photo_url').eq('status', 'ativo').is('embedding', null);
      for (const pet of data ?? []) {
        try {
          const emb = await generateImageEmbedding(pet.main_photo_url);
          await supabase.from('pets').update({ embedding: emb }).eq('id', pet.id);
          console.log(`[auto-backfill] embedding ${pet.id}`);
        } catch (e: any) { console.error(`[auto-backfill] embedding ${pet.id} falhou:`, e.message); }
      }
    }
    if (isVisionTagsEnabled()) {
      const { data } = await supabase.from('pets').select('id, main_photo_url, species, vision_tags').eq('status', 'ativo');
      // Re-tagueia quem não tem tags OU tem tags antigas sem coat_colors (idempotente).
      const pending = (data ?? []).filter(
        (p: any) => !p.vision_tags || !Array.isArray(p.vision_tags.coat_colors) || p.vision_tags.coat_colors.length === 0,
      );
      console.log(`[auto-backfill] ${pending.length} pet(s) p/ (re)tag de características`);
      for (const pet of pending) {
        try {
          const tags = await generatePetVisionTags(pet.main_photo_url);
          if (tags) {
            const patch: any = { vision_tags: tags };
            // Preenche a espécie no cadastro quando ainda não há (habilita o filtro
            // duro gato×cachorro pelo caminho direto e corrige estatísticas).
            if (tags.species && !pet.species) patch.species = tags.species;
            await supabase.from('pets').update(patch).eq('id', pet.id);
          }
          console.log(`[auto-backfill] vision-tags ${pet.id}`);
        } catch (e: any) { console.error(`[auto-backfill] vision-tags ${pet.id} falhou:`, e.message); }
      }
    }
  } catch (e: any) {
    console.error('[auto-backfill] erro:', e.message);
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ PetPerdidoSOS backend rodando em http://0.0.0.0:${PORT}`);
  console.log(`  Health: http://localhost:${PORT}/health`);
  // Processa pets sem embedding/características alguns segundos após subir
  // (não bloqueia o boot; a fila serializa as chamadas ao Replicate).
  setTimeout(() => { void autoBackfillMatchData(); }, 8000);
});
