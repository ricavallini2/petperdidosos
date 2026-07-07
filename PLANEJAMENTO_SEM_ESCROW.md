# PLANEJAMENTO — Remoção do Escrow (recompensa sem custódia)

> Decisão de produto (jul/2026): o app **não segura mais o dinheiro da recompensa**. O valor
> vira **informativo no anúncio**, tratado **diretamente** entre tutor e quem ajuda. O app
> deixa de ser intermediador financeiro (menos risco jurídico/regulatório, lançamento mais leve).

## Decisões confirmadas
- ❌ **Sem taxa do app.** → ✅ **CTA de doação voluntária** na conclusão positiva (Pix/link **externo**, configurável no admin). O app **não processa** o dinheiro.
- 💰 **Recompensa = display-only**: mantém o campo de valor no anúncio + disclaimer *"combinada diretamente; o app não intermedia"*. Sem escrow, sem taxa, sem payout.
- 👛 **Carteira: esconder, manter a infra** (tabelas + RPCs atômicas + rotas admin ficam no lugar, desativadas) pra reativar escrow real (Pix/PSP) no futuro.
- 🤝 **Dupla confirmação + avaliação mútua** pra encerrar o caso, alimentando reputação (`rating`/`rescues_count`).

## 🔑 Regra de ouro: ESCONDER + DESATIVAR, nunca APAGAR
Só se deletam do app: a tela `app/profile/wallet.tsx` e os blocos de UI de taxa/escrow. **Tudo no banco fica** (tabelas `rewards`/`transactions`, RPCs `reward_payout`/`wallet_credit`/`wallet_try_debit`, rotas admin de finança). `profile_increment_rescues` **é mantido e continua sendo chamado** (rescues_count é reputação, não dinheiro).

## Banco (migration aditiva — sem drops; dados triviais: 4 rewards, 7 tx, 1 rating, R$25 em 1 user)
- `pets.finder_confirmed_at timestamptz null` + `pets.tutor_confirmed_at timestamptz null` → pet vira `'encontrado'` **só quando ambos** preenchidos.
- `app_settings.donation_pix_key text null` + `app_settings.donation_url text null`.
- **Backfill**: pets `'encontrado'` existentes recebem os dois timestamps = `updated_at` (pra não parecerem meio-confirmados).
- **Reuso sem mudança**: `ratings` (UNIQUE pet_id/rater_id/rated_id + CHECK rater≠rated já suporta 2 linhas, uma por direção → avaliação mútua nativa). `rewards.fee_amount` passa a ser gravado como **0**.

## Backend (`backend/src/index.ts`)
- **Remover taxa**: `APP_FEE_RATE`, `getFeeRate()`, `GET /config/fee-rate`, o write de `feeRate` no `POST /admin/settings`. (Grep por TODOS os callers antes.)
- **Recompensa display-only**: `POST /pets` e `/reward/increase` mantêm o `amount`, gravam `fee_amount=0`, **sem** transação `escrow_hold`. `/cancel` remove o bloco de refund (sem `wallet_credit`, sem transações) — só marca `refunded` como registro.
- **Dupla confirmação** (helper `applyRescueConfirmation`): marca a coluna do confirmante; quando **ambos** confirmam → `status='encontrado'`, fecha chats, `profile_increment_rescues(finder)` **uma vez só** (guardado pela transição `ativo→encontrado`), marca reward `paid` só p/ exibição (**sem** payout/transação/wallet), notifica os dois. Se só um confirmou → notifica o outro, retorna `{ pending }`. Converte os 3 entrypoints (chat, legado por e-mail, sightings/confirm).
- **Avaliação mútua**: `POST /ratings` já é genérico (só ajustar a mensagem 409 pra neutra). 
- **Desativar wallet** (código fica): `POST /user/:userId/withdraw` → curto-circuito `410`. Manter `settle` funcional p/ histórico. Remover as travas de `wallet_balance>0`/rewards ativas no `DELETE /user/account`.
- **Novo** `GET /config/donation` → `{ pixKey, url }` (ou dobrar num bootstrap de config).
- Reescrever textos de HELP/FAQ (tirar escrow/taxa/carteira/saque).

## App (editar na **pasta principal**; Android é a base; regra de Modal do iOS vale p/ o CTA de doação)
- **Deletar**: `app/profile/wallet.tsx` + referência de rota. Remover o card "Carteira" e o item de menu "Carteira e Saques" em `profile.tsx`.
- **Taxa → display-only**: `report.tsx §5` (remove breakdown de taxa/total/retido; mantém toggle+valor; disclaimer novo). `pet/edit/[id].tsx` (remove pill "Em escrow"/breakdown). `pet/case/[id].tsx`, `index.tsx`, `alertas.tsx`, `rescues.tsx` (copy display-only; tira "ganho em resgates R$").
- **Dupla confirmação** (`chat/[id].tsx`): botão de confirmar aparece p/ **ambos**; `{ pending }` → "aguardando a outra pessoa"; `{ closed }` → modal de avaliação + CTA de doação.
- **Avaliação mútua** (`chat/[id].tsx`): `rateUser` já manda `otherId`; só ajustar copy p/ neutra e mostrar aos dois no fecho.
- **CTA de doação (novo)**: card inline opcional no `closedBanner` (chat) quando `found===true` + ambos confirmaram, e no sucesso da avaliação. Copiar Pix (Clipboard) + abrir URL (Linking). Se os 2 campos vazios → não renderiza nada. **iOS: card inline + toast** (evitar Modal; se Modal, ação no `onDismiss` + próximo tick).
- `services/api.ts`: `getFeeRate`/`requestWithdraw`/`getTransactions` viram keep-hidden (deletar `getFeeRate` se ninguém mais usa); atualizar tipos de retorno de `confirmRescueByChat`/`confirmSighting`/`confirmRescue` p/ `{ pending } | { closed }`; **add** `getDonationConfig()`.

## Admin (`admin/src`, Vite/React)
- `Configuracoes.tsx`: remover input de `feeRate`; **adicionar** "Chave Pix p/ doações" + "Link de doação" (POST `/admin/settings`). Match config fica.
- `Financeiro.tsx`/`CasoDetalhe.tsx`: manter como **histórico** (display-only). Sem deleção.

## Migração de dados
Volume trivial. Aplicar migration aditiva → backfill dos `'encontrado'` → semear `donation_pix_key`/`donation_url` → deixar rewards/transações/`R$25` **intactos** (carteira escondida, não zerada). **Pendência de política**: 3 rewards `pending` + R$25 de 1 user não pagam no modelo novo — decidir se honra manualmente (settle) ou comunica. Não sumir com valor real em silêncio.

## Riscos (mitigação no plano)
1. **Duplicar `rescues_count`** (3 entrypoints) → guardar increment na transição `ativo→encontrado`.
2. **Caso meio-confirmado preso** → UI "aguardando" + escape hatch: `/chats/:chatId/close` (tutor) permanece.
3. **Travas de exclusão de conta** → remover guards de wallet/rewards senão user não deleta.
4. **Valor legado** (R$25 + rewards pending) → definir política (item acima).
5. **Line drift** no index.ts (6054 linhas) → Grep do anchor antes de cada edit.
6. **Remover taxa** → grep de TODOS os callers de getFeeRate.
7. **iOS Modal-freeze** no CTA de doação → card inline + toast.
8. **Config de doação vazia** → CTA não renderiza / valida URL antes do Linking.

## Fases de execução
- **F0** — Migration DB + backfill + semear doação. (checkpoint: colunas criadas, backfill ok)
- **F1** — Backend: remove taxa, recompensa→display, `GET /config/donation`. (checkpoint: `tsc` backend + grep zero getFeeRate)
- **F2** — Backend: dupla confirmação + avaliação mútua + desativar wallet/withdraw + FAQ. (checkpoint: tsc + curl confirma `{pending}`→`{closed}`, rescues +1)
- **F3** — App: remover UI de taxa + esconder Carteira. (checkpoint: tsc raiz + sem rota /profile/wallet)
- **F4** — App: dupla confirmação + avaliação mútua + CTA de doação. (checkpoint: fluxo completo no Android)
- **F5** — Admin: tira feeRate, add doação. (checkpoint: build admin + round-trip)
- **F6** — Verificação + revisão adversarial (double-increment, meio-confirmado, doação vazia, valor legado). (checkpoint: 3 typechecks verdes)
