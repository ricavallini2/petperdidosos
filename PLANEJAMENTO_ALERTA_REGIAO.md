# PLANEJAMENTO — Alerta de Região (destaque de pet perdido)

> O tutor de um pet perdido dispara um **alerta de destaque** para buscadores dentro de um raio.
> Entrega via **push + in-app**, só para quem **aceitou** e está **no raio**. 1x/dia por pet.
> Recebedores podem **curtir** ou **denunciar**; muitas denúncias **desativam** e vão ao admin.

## Achados que guiam o plano (verificados no código/banco)
- ✅ **Push já é enviado** pelo backend (`exp.host/--/api/v2/push/send` + `notifyUser`, que cria a notificação in-app E dispara o push, e limpa tokens mortos). **Reusar**, não recriar.
- ✅ **Denúncia + auto-pausa** já existe: tabela `reports` (polimórfica, com `pet_id`/`chat_id` nullable, status `pending|reviewing|dismissed|actioned`), padrão `REPORTS_TO_PAUSE=3` (conta denúncias → pausa → vira `reviewing` p/ o admin), e a fila **Denúncias** no painel (`Denuncias.tsx`/`DenunciaDetalhe.tsx`). **Reusar** pra moderar os alertas.
- ⚠️ **Localização do usuário NÃO é persistida** (push_tokens só tem token+platform; profiles/user_settings sem lat/lng). → Mirar por raio **exige persistir a localização** (com consentimento).
- ✅ **Precedente de opt-in**: `user_settings.premium_reward_alert_enabled` (boolean) → espelhar num `region_alerts_enabled`.
- ⚠️ **Sem PostGIS/earthdistance** → distância por **bounding-box (índice lat/lng) + haversine** em função SQL.
- Deep-link: `use-push-notifications.ts` roteia por `data.type` → adicionar `type:'region_alert'`.

## Banco (migration aditiva)
- **`region_alerts`**: id, pet_id→pets, tutor_id→profiles, latitude, longitude (snapshot do pet), radius_m, comment text null, status `active|deactivated|expired`, likes_count int, reports_count int, added_to_timeline bool, created_at.
- **`region_alert_likes`**: id, alert_id→region_alerts, user_id, created_at · UNIQUE(alert_id, user_id).
- **`reports` (estender)**: + `region_alert_id uuid null` → denúncias entram na **mesma fila de moderação**.
- **`user_settings` (estender)**: `region_alerts_enabled bool default false` (opt-in) · `last_lat`, `last_lng` double precision · `last_location_at timestamptz`.
- Índices: region_alerts(pet_id, status), region_alert_likes(alert_id), user_settings(last_lat, last_lng), region_alerts(tutor_id, created_at) p/ o rate-limit.

## Mira por raio — DUAS vias de entrega
**Via A — push / offline (localização persistida + opt-in):**
1. **Persistir a localização** só de quem consentiu: `POST /me/location {lat,lng}` no boot do app **quando `region_alerts_enabled=true`**, com throttle (~1x/h). Desligar o opt-in **apaga** last_lat/lng.
2. **Fan-out** ao criar o alerta: função SQL `users_near(lat,lng,radius)` = bounding-box (índice) + haversine, cruzando `region_alerts_enabled=true` AND `last_location_at` recente (frescor, ex. 7 dias) AND tem push_token AND != tutor → push em lote (Expo ≤100 tokens/req) + `notifications` (type='region_alert'). Roda **em background**.

**Via B — tempo real p/ quem está ATIVO no app e no raio (localização fresca):**
3. Com o app em foreground, um **poll leve** (~60s) `GET /region-alerts/nearby?lat=&lng=` manda a **localização ATUAL** (a mesma que já usa no mapa) → retorna alertas ativos no raio criados nas últimas horas que o usuário ainda não viu → **banner de destaque ao vivo**. Cobre quem chegou agora na região mesmo com a localização persistida velha/ausente.

**Opt-in por via:** a **Via A (push)** exige o opt-in (é interrupção + guarda localização). A **Via B (banner in-app)** aparece pra qualquer usuário **ativo no raio** — é conteúdo contextual do app (como os pets próximos já aparecem), usando o GPS que ele já compartilha na tela. **Dedup por `alert_id`** pra não avisar duas vezes (quem recebeu push não vê o banner de novo).

## Backend (endpoints)
- `POST /pets/:petId/region-alert` (tutor, dono): **rate-limit 1x/24h por pet** (último alerta do pet <24h → 429 com "disponível em Xh"). Cria o alerta (snapshot lat/lng), comment; se `add_to_timeline`, insere na linha do tempo do caso; dispara o fan-out. → `{alertId, recipients}`.
- `GET /region-alerts/:id`: dados da tela (pet foto/nome/espécie/raça/lost_date, tutor foto/nome, recompensa, comentário, coords p/ mapa + case id, likes_count, my_liked, status).
- `GET /region-alerts/nearby?lat=&lng=` (Via B): alertas **ativos** no raio (usando a localização ATUAL passada) criados nas últimas Nh, que o usuário ainda não marcou como visto → alimenta o **banner ao vivo** de quem está ativo no app. Marca como visto quando exibido/tocado.
- `POST /region-alerts/:id/like` (toggle).
- `POST /region-alerts/:id/report {reason}`: insere em `reports` (region_alert_id) + conta; se ≥ threshold → `status='deactivated'` + reports→'reviewing' + notifica o tutor (espelha REPORTS_TO_PAUSE).

## App
- **Tutor dispara**: botão **"Alertar buscadores da região"** na ficha do caso (`pet/case/[id].tsx`) e/ou em "Meus Alertas" → *sheet* com **raio** (chips), **comentário** (opcional) e **toggle "adicionar à linha do tempo"** → confirma → mostra "enviado a X pessoas" e bloqueia 24h.
- **Recebedor**: push (type='region_alert') → abre **tela dedicada** `app/region-alert/[id].tsx` com: foto+nome do pet · espécie·raça · "perdido em <data>" · avatar+nome do tutor · chip de recompensa (se houver) · comentário (se houver) · botões **"Ver no mapa"** e **"Ver detalhes do caso"** · ações **Curtir**/**Denunciar**. Também listado na aba **Notificações**.
- **Opt-in**: Configurações → toggle "Receber alertas de pets perdidos na minha região" + explicação de uso de localização; ativar dispara a persistência.

## Admin
- **Reusar a fila de Denúncias**: reports com `region_alert_id` aparecem lá; no detalhe, resolver o conteúdo do alerta; ação → manter desativado (`actioned`) ou **reativar** (`dismissed` → volta `active`). Contexto/filtro "Alerta de região".

## Decisões confirmadas (jul/2026)
1. **Raio FIXO pelo app**, definido no admin → `app_settings.region_alert_radius_m` (default ex. 10 km). O tutor não escolhe; vê "avisando buscadores num raio de X km".
2. **Persistir a localização com consentimento**: `last_lat/lng/last_location_at` só de quem ativa o opt-in; desligar o opt-in **apaga** o dado.
3. **Recebimento = push + tela dedicada + lista de Notificações + BANNER de destaque** no topo do Mapa e da lista de Alertas (fase própria).
4. **Configurável no admin** (em `app_settings`, editável em Configurações do painel):
   - `region_alert_radius_m` (raio) · `region_alert_cooldown_h` (=24, o "1x/dia") · `region_alert_reports_to_deactivate` (=5).
5. **Timeline**: o toggle "adicionar à linha do tempo" vem **desligado** por padrão (o tutor liga se quiser publicar a novidade no caso).

## Riscos
- **LGPD/privacidade**: persistir localização exige consentimento claro + opção de desligar (apaga o dado).
- **Spam/custo de push**: rate-limit + threshold de denúncia + teto de destinatários; fan-out em background.
- **Localização desatualizada** → mira imprecisa; mitigar com frescor + rótulo "sua última região".

## Fases
- **F0** DB (tabelas + colunas + índices + função `users_near`).
- **F1** Backend (create+fan-out, like, report+threshold, GET, /me/location).
- **F2** App recebedor (tela do alerta + rota + deep-link + notificações + like/report).
- **F3** App tutor (botão + sheet raio/comentário/timeline + rate-limit UI).
- **F4** Opt-in + persistência de localização.
- **F5** Admin (contexto region-alert na fila + reativar).
- **F6** Verificação + revisão adversarial.
