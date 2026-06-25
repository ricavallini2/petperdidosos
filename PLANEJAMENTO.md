# PLANEJAMENTO — Meus Pets + Navegação + Monetização

> Documento de referência do planejamento (jun/2026). O **core** (achar pet perdido)
> é o herói; tudo aqui reforça retenção e receita **sem diluir** isso.

## 1. Navegação (barra inferior: de 6 → 5)

**Nova barra:** `SOS` · `Chats` · **`[Alertar]`** (botão central destacado) · `Meus Pets` · `Perfil`

- **SOS** (era "Mapa SOS", tela `index`): nome curto + neutro de modo. Toggle **Mapa ↔ Lista**
  (segmented no topo; lembra a última escolha). Ícone vira pin/radar SOS.
  - A aba **"Alertas"** deixa de existir → vira o **modo Lista** do SOS.
- **Alertar** (era "Novo alerta", tela `report`): **botão central destacado** (FAB).
  Abre o seletor Perdi / Vi / Resgatei / Doar.
- **Doação** deixa de ser aba, mas com **destaque sem poluir**:
  - **Mapa:** chip "Adoção · X perto" (1 elemento, com contador) → abre a tela de Doação.
  - **Lista:** seção "Para adoção" no topo do feed.
  - Entrada também no hub Perfil.
- **Perfil = hub** (botões → telas, cada um com micro-status quando fizer sentido):
  - **Meus Alertas** (botão → tela dedicada; ex.: "2 ativos") — NÃO listar inline.
  - **Meu Premium**, **Doação**, **Carteira/Financeiro**, **Configurações**, **Sair**.

## 2. Meus Pets (feature nova — começar COMPLETO)

- **Ficha do meu pet:** nome, fotos, espécie, raça, cor, porte, sexo, nascimento, microchip,
  castrado, obs. de saúde. (Reaproveita ~80% do cadastro atual + `prepareForUpload`.)
- **Carteirinha de saúde** = **um motor genérico** (`health_records` com campo `tipo`):
  vacina · vermífugo · antipulgas · medicação · peso/exame. Cada registro: tipo, nome,
  data aplicada, **próxima data**, vet/clínica, lote, obs.
- **Lembretes:** notificação X dias antes da próxima data (infra de push já existe).
- **🔑 Atalho "Perdi este pet":** abre o "Alertar" **pré-preenchido** → alerta em 1 toque
  (reaproveita os `initParams` do `report`).
- **Carteirinha em PDF/link** compartilhável → **fast-follow** (não trava o v1).

## 3. Monetização / planos — **tudo configurável no painel admin**

- **3 níveis** (valores INICIAIS, editáveis no admin): Mensal **R$ 9,90** · Anual **R$ 69,90**
  · Vitalício **R$ 149,90** · early-bird de lançamento **~R$ 89,90** (limitado).
- **Corte grátis/premium** (também via admin; inicial = sugerido):
  - **Grátis:** 1 pet + carteirinha de vacina + lembretes (motor de retenção).
  - **Premium:** pets ilimitados · PDF · saúde completa (vermífugo/medicação/peso) · lembretes avançados.
- Preços/limites moram em `app_settings`; o app lê via config; admin edita em **"Planos & Limites"**.
- ⚠️ **IAP:** preço via admin funciona p/ exibição e Pix; se for pagamento de **loja**
  (Apple/Google), o preço do produto é definido na loja (revisar quando integrar pagamento real).
  O **corte/limites** é sempre 100% nosso (lógica do app).

## 4. Técnico (schema/infra)

- **DB novo:** `meus_pets` (pet do dono, separado do `pets` de alertas) + `health_records`
  (genérico, com `tipo`) — RLS por dono.
- **Backend:** endpoints CRUD (pets + registros de saúde) sob `/me/pets/*`.
- **Reuso:** upload (`prepareForUpload`), fluxo do "Alertar" (`initParams`), notificações.

## 5. Execução (fases)

| Fase | Entregável | Esforço | Depende |
|---|---|---|---|
| 0. Decisões | preços/corte via admin · "Perfil" · Meus Alertas como botão | ✓ feito | — |
| 1. Navegação | barra 5-slots · SOS (Mapa/Lista) · Alertar central · Doação (chip+seção) · Perfil-hub · Meus Pets (placeholder) | M | — |
| 2. Meus Pets | DB + backend CRUD · lista · ficha · carteirinha · lembretes locais · atalho "perdi" | G | Fase 1 |
| 3. Monetização | reprecificar via admin · gating grátis/premium · telas de planos · IAP | M | Fase 2 |
| 4. Polish | carteirinha PDF · lembretes via push no servidor · refinos de Doação | M | 2–3 |

**Padrão de qualidade por fase:** implementar → `typecheck` → revisão adversarial → build EAS → testar no device.

## 6. Notas operacionais

- **Builds:** cota grátis Android da EAS esgotada (reseta **01/07**); iOS builda normal.
- **Sequência ideal:** estabilizar/lançar o core antes (crash de cadastro e freeze já corrigidos).
- **Onde editar:** sempre a pasta principal (worktrees partem de commit antigo). Painel admin
  em `petperdidosos.imestredigital.cloud/admin`.

## 7. Log de decisões

- Navegação: 5 abas, Alertar central, SOS com toggle Mapa/Lista (jun/2026).
- Doação: destaque por modo — chip no mapa + seção na lista + hub (não vira aba).
- Preço/corte: configuráveis no admin, valores iniciais sugeridos.
- "Meus Pets": escopo COMPLETO no v1 (PDF é fast-follow).
