# -*- coding: utf-8 -*-
"""
Monta as capturas de tela para a ficha da loja: a tela REAL do app, com uma
faixa de legenda no topo (fundo coral da marca). O conteúdo continua sendo o
print autêntico — a legenda só dá contexto, prática aceita pela Play/App Store.

    python logotipo/gerar-capturas.py

Saída em logotipo/loja/capturas/  (1440x3120, pronto para as duas lojas).
"""
from PIL import Image, ImageDraw, ImageFont
import os

BASE = os.path.dirname(os.path.abspath(__file__))
PRINTS = os.path.join(BASE, 'prints')
OUT = os.path.join(BASE, 'loja', 'capturas')
os.makedirs(OUT, exist_ok=True)

CORAL_CLARO = (255, 107, 129)
CORAL       = (255, 71, 87)
BRANCO      = (255, 255, 255)

F_BLACK = 'C:/Windows/Fonts/seguibl.ttf'
F_BOLD  = 'C:/Windows/Fonts/segoeuib.ttf'

# (arquivo, legenda) — a ordem é a ordem na loja.
CAPTURAS = [
    ('Screenshot_20260722_194520_PetPerdidoSOS.jpg', 'Veja pets perdidos\nperto de você'),
    ('Screenshot_20260722_194539_PetPerdidoSOS.jpg', 'Cada alerta com foto,\nlocal e recompensa'),
    ('Screenshot_20260722_195010_PetPerdidoSOS.jpg', 'Encontrou um pet?\nDescubra o tutor pela foto'),
    ('Screenshot_20260722_195052_PetPerdidoSOS.jpg', 'Converse com segurança,\nsem expor seu telefone'),
    ('Screenshot_20260722_195117_PetPerdidoSOS.jpg', 'Histórias reais\nde reencontro'),
]

FAIXA = 300     # altura da faixa de legenda
CORTE_TOPO = 116  # remove a barra de status do Android (relógio, ícones, bateria)


def fonte(caminho, tamanho):
    try:
        return ImageFont.truetype(caminho, tamanho)
    except Exception:
        return ImageFont.load_default()


f_leg = fonte(F_BLACK, 74)
f_marca = fonte(F_BOLD, 34)

for i, (arq, legenda) in enumerate(CAPTURAS, 1):
    print_orig = Image.open(os.path.join(PRINTS, arq)).convert('RGB')
    # Corta a barra de status do sistema — ela tem o relógio e os ícones do
    # aparelho do usuário, que não devem aparecer na ficha da loja.
    print_orig = print_orig.crop((0, CORTE_TOPO, print_orig.width, print_orig.height))
    L = print_orig.width  # 1440

    canvas = Image.new('RGB', (L, FAIXA + print_orig.height), CORAL)
    d = ImageDraw.Draw(canvas)

    # Gradiente horizontal suave na faixa
    for x in range(0, L, 6):
        t = x / L
        cor = tuple(int(CORAL_CLARO[k] + (CORAL[k] - CORAL_CLARO[k]) * t) for k in range(3))
        d.rectangle([x, 0, x + 6, FAIXA], fill=cor)

    # Legenda (2 linhas), centralizada verticalmente na faixa
    linhas = legenda.split('\n')
    alt_linha = 84
    bloco = alt_linha * len(linhas)
    y = (FAIXA - bloco) // 2 + 4
    for linha in linhas:
        w = d.textlength(linha, font=f_leg)
        d.text(((L - w) / 2, y), linha, font=f_leg, fill=BRANCO)
        y += alt_linha

    # Print real abaixo da faixa
    canvas.paste(print_orig, (0, FAIXA))

    destino = os.path.join(OUT, f'captura-{i}.png')
    canvas.save(destino, 'PNG', optimize=True)
    print(f'  captura-{i}.png  {canvas.width}x{canvas.height}  «{legenda.replace(chr(10)," ")}»')

print('\nPronto — em logotipo/loja/capturas/')
