# -*- coding: utf-8 -*-
"""
Gera os recursos gráficos exigidos pela Google Play e pela App Store.

    python logotipo/gerar-assets-loja.py

Saída em logotipo/loja/:
  - icone-512.png       512x512  — ícone da ficha da Play Store
  - icone-1024.png      1024x1024 — ícone da App Store (sem transparência)
  - destaque-1024x500.png — gráfico de destaque da Play Store

O gráfico de destaque é cortado nas bordas em telas menores, então todo o
conteúdo importante fica na faixa central (safe zone marcada no código).
"""
from PIL import Image, ImageDraw, ImageFont
import os

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, 'loja')
os.makedirs(OUT, exist_ok=True)

# Paleta da marca (a mesma dos gradientes do app)
CORAL_CLARO = (255, 107, 129)   # #FF6B81
CORAL       = (255, 71, 87)     # #FF4757
BRANCO      = (255, 255, 255)

F_BLACK = 'C:/Windows/Fonts/seguibl.ttf'   # Segoe UI Black
F_BOLD  = 'C:/Windows/Fonts/segoeuib.ttf'  # Segoe UI Bold
F_REG   = 'C:/Windows/Fonts/segoeui.ttf'


def fonte(caminho, tamanho):
    try:
        return ImageFont.truetype(caminho, tamanho)
    except Exception:
        return ImageFont.load_default()


# ---------------------------------------------------------------- ícones
origem = Image.open(os.path.join(BASE, 'icon.png')).convert('RGB')

for lado in (512, 1024):
    ico = origem.resize((lado, lado), Image.LANCZOS)
    destino = os.path.join(OUT, f'icone-{lado}.png')
    ico.save(destino, 'PNG', optimize=True)
    print(f'  {os.path.basename(destino)}  {lado}x{lado}')


# ------------------------------------------------- gráfico de destaque
L, A = 1024, 500
g = Image.new('RGB', (L, A), CORAL)
d = ImageDraw.Draw(g)

# Gradiente diagonal suave (claro no topo-esquerdo → escuro embaixo-direita)
for y in range(A):
    for faixa in range(0, L, 8):  # passo de 8px: gradiente suave e rápido
        t = (faixa / L * 0.55) + (y / A * 0.45)
        cor = tuple(int(CORAL_CLARO[i] + (CORAL[i] - CORAL_CLARO[i]) * t) for i in range(3))
        d.rectangle([faixa, y, faixa + 8, y + 1], fill=cor)

# Patas decorativas, bem discretas, no canto direito
patas = Image.new('RGBA', (L, A), (0, 0, 0, 0))
dp = ImageDraw.Draw(patas)


def pata(cx, cy, r, alpha):
    c = (255, 255, 255, alpha)
    dp.ellipse([cx - r, cy - r * 0.85, cx + r, cy + r * 0.95], fill=c)          # coxim
    for dx, dy, rr in ((-1.35, -1.5, 0.44), (-0.45, -1.9, 0.44),
                       (0.45, -1.9, 0.44), (1.35, -1.5, 0.44)):                  # dedos
        dp.ellipse([cx + dx * r - rr * r, cy + dy * r - rr * r,
                    cx + dx * r + rr * r, cy + dy * r + rr * r], fill=c)


pata(905, 120, 30, 26)
pata(975, 235, 22, 20)
pata(848, 300, 17, 15)
g = Image.alpha_composite(g.convert('RGBA'), patas).convert('RGB')
d = ImageDraw.Draw(g)

# Ícone do app à direita — dentro da safe zone
LADO_ICONE = 250
ico = origem.resize((LADO_ICONE, LADO_ICONE), Image.LANCZOS)
mascara = Image.new('L', (LADO_ICONE, LADO_ICONE), 0)
ImageDraw.Draw(mascara).rounded_rectangle(
    [0, 0, LADO_ICONE, LADO_ICONE], radius=int(LADO_ICONE * 0.225), fill=255)

ix, iy = 700, (A - LADO_ICONE) // 2

# Cartão branco atrás do ícone: sem ele, o ícone (coral) se funde no fundo
# (também coral) e some. A moldura branca faz a marca destacar.
MARGEM = 26
cx0, cy0 = ix - MARGEM, iy - MARGEM
cx1, cy1 = ix + LADO_ICONE + MARGEM, iy + LADO_ICONE + MARGEM
raio_cartao = int((LADO_ICONE + MARGEM * 2) * 0.235)

sombra = Image.new('RGBA', (L, A), (0, 0, 0, 0))
ImageDraw.Draw(sombra).rounded_rectangle(
    [cx0 + 4, cy0 + 12, cx1 + 4, cy1 + 12], radius=raio_cartao, fill=(120, 18, 28, 85))
g = Image.alpha_composite(g.convert('RGBA'), sombra).convert('RGB')
d = ImageDraw.Draw(g)
d.rounded_rectangle([cx0, cy0, cx1, cy1], radius=raio_cartao, fill=BRANCO)

g.paste(ico, (ix, iy), mascara)
d = ImageDraw.Draw(g)

# Texto à esquerda
x = 84
f_titulo = fonte(F_BLACK, 62)
f_sub    = fonte(F_REG, 27)
f_selo   = fonte(F_BOLD, 20)

d.text((x, 150), 'PetPerdido', font=f_titulo, fill=BRANCO)
larg = d.textlength('PetPerdido', font=f_titulo)
d.text((x + larg, 150), 'SOS', font=f_titulo, fill=(255, 226, 230))

d.text((x, 232), 'A rede que reúne pets perdidos', font=f_sub, fill=(255, 236, 239))
d.text((x, 268), 'aos seus tutores', font=f_sub, fill=(255, 236, 239))

# Selo "100% gratuito"
texto_selo = '100% GRATUITO'
w = d.textlength(texto_selo, font=f_selo)
d.rounded_rectangle([x, 330, x + w + 34, 330 + 42], radius=21,
                    fill=(255, 255, 255, 255))
d.text((x + 17, 340), texto_selo, font=f_selo, fill=CORAL)

destino = os.path.join(OUT, 'destaque-1024x500.png')
g.save(destino, 'PNG', optimize=True)
print(f'  {os.path.basename(destino)}  {L}x{A}')

print('\nPronto — arquivos em logotipo/loja/')
