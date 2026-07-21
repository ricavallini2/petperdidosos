#!/usr/bin/env bash
# ============================================================================
# Deploy do PAINEL ADMIN na VPS.
#
# POR QUE ISTO EXISTE: o backend roda via `tsx` (sem build), então `git pull` +
# `pm2 restart` basta. O admin NÃO — é um build estático do Vite servido pelo
# Caddy. Sem rodar este script, o painel em produção fica congelado no último
# build (já aconteceu de ficar ~1 mês defasado, escondendo campos novos).
#
# USO (na VPS):  cd /root/petperdidosos && ./deploy-admin.sh
# ============================================================================
set -euo pipefail

REPO="/root/petperdidosos"
VOL="/var/lib/docker/volumes/edge_caddy_data/_data/sites/petperdidosos-admin"
URL="https://petperdidosos.imestredigital.cloud/admin"

cd "$REPO"

echo "==> Atualizando o repositório"
git pull --ff-only origin main
echo "    commit: $(git log --oneline -1)"

echo "==> Build do admin"
cd "$REPO/admin"
npm install --no-audit --no-fund
npm run build

# Nunca publicar um build vazio/quebrado por cima do que está no ar.
if [ ! -f "dist/index.html" ] || [ ! -d "dist/assets" ]; then
  echo "!!! Build não gerou dist/index.html + dist/assets — ABORTANDO (nada foi publicado)."
  exit 1
fi

echo "==> Backup do que está no ar"
BACKUP="/root/admin-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
tar czf "$BACKUP" -C "$VOL" index.html assets
echo "    $BACKUP"

echo "==> Publicando"
# ATENÇÃO: o app-test.apk mora nessa mesma pasta e NÃO pode ser tocado —
# por isso trocamos só index.html e assets/, nunca limpamos o diretório inteiro.
rm -rf "$VOL/assets"
cp -r dist/assets "$VOL/assets"
cp dist/index.html "$VOL/index.html"

echo "==> Verificando no ar"
LOCAL_HASH=$(grep -oE 'index-[A-Za-z0-9_-]+\.js' dist/index.html | head -1)
LIVE_HASH=$(curl -s --max-time 25 "$URL/" | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1)
echo "    build:  $LOCAL_HASH"
echo "    no ar:  $LIVE_HASH"

if [ "$LOCAL_HASH" = "$LIVE_HASH" ]; then
  echo ""
  echo "OK — painel atualizado."
  echo "Peça ao usuário para recarregar com Ctrl+Shift+R (o navegador cacheia o index antigo)."
else
  echo ""
  echo "!!! O hash no ar não bate com o do build."
  echo "    Pode ser cache do Caddy/CDN. Restaure se necessário:"
  echo "    tar xzf $BACKUP -C $VOL"
  exit 1
fi
