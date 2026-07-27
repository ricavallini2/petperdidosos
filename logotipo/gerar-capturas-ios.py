# -*- coding: utf-8 -*-
"""
Mesma arte das capturas da Play, mas no tamanho exigido pela App Store.

    python logotipo/gerar-capturas-ios.py

A Apple exige capturas de iPhone 6,9" em 1320x2868. Em vez de redimensionar o
PNG do Android (que daria distorção ou barra preta), a arte é remontada nessa
medida: o print entra redimensionado para 1320 de largura e a faixa de legenda
absorve a diferença de altura.

Saída em logotipo/loja/capturas-ios/
"""
from PIL import Image, ImageDraw, ImageFont
import os

BASE = os.path.dirname(os.path.abspath(__file__))
PRINTS = os.path.join(BASE, 'prints')
OUT = os.path.join(BASE, 'loja', 'capturas-ios')
os.makedirs(OUT, exist_ok=True)

CORAL_CLARO = (255, 107, 129)
CORAL       = (255, 71, 87)
BRANCO      = (255, 255, 255)

F_BLACK = 'C:/Windows/Fonts/seguibl.ttf'

# Mesmas legendas e ordem da ficha da Play.
CAPTURAS = [
    ('Screenshot_20260722_194520_PetPerdidoSOS.jpg', 'Veja pets perdidos\nperto de você'),
    ('Screenshot_20260722_194539_PetPerdidoSOS.jpg', 'Cada alerta com foto,\nlocal e recompensa'),
    ('Screenshot_20260722_195010_PetPerdidoSOS.jpg', 'Encontrou um pet?\nDescubra o tutor pela foto'),
    ('Screenshot_20260722_195052_PetPerdidoSOS.jpg', 'Converse com segurança,\nsem expor seu telefone'),
    ('Screenshot_20260722_195117_PetPerdidoSOS.jpg', 'Histórias reais\nde reencontro'),
]

LARGURA, ALTURA = 1320, 2868   # iPhone 6,9" (App Store)
CORTE_TOPO = 116               # barra de status do Android
CORTE_BASE = 165               # barra de navegação do Android


def fonte(caminho, tamanho):
    try:
        return ImageFont.truetype(caminho, tamanho)
    except Exception:
        return ImageFont.load_default()


f_leg = fonte(F_BLACK, 68)     # 74 do Android reescalado para 1320 de largura

for i, (arq, legenda) in enumerate(CAPTURAS, 1):
    print_orig = Image.open(os.path.join(PRINTS, arq)).convert('RGB')
    print_orig = print_orig.crop(
        (0, CORTE_TOPO, print_orig.width, print_orig.height - CORTE_BASE))

    # Redimensiona para a largura da App Store mantendo a proporção do print.
    nova_alt = round(print_orig.height * LARGURA / print_orig.width)
    print_orig = print_orig.resize((LARGURA, nova_alt), Image.LANCZOS)

    # A faixa de legenda absorve o que sobra da altura exigida.
    faixa = ALTURA - nova_alt

    canvas = Image.new('RGB', (LARGURA, ALTURA), CORAL)
    d = ImageDraw.Draw(canvas)

    for x in range(0, LARGURA, 6):
        t = x / LARGURA
        cor = tuple(int(CORAL_CLARO[k] + (CORAL[k] - CORAL_CLARO[k]) * t) for k in range(3))
        d.rectangle([x, 0, x + 6, faixa], fill=cor)

    linhas = legenda.split('\n')
    alt_linha = 77
    y = (faixa - alt_linha * len(linhas)) // 2 + 4
    for linha in linhas:
        w = d.textlength(linha, font=f_leg)
        d.text(((LARGURA - w) / 2, y), linha, font=f_leg, fill=BRANCO)
        y += alt_linha

    canvas.paste(print_orig, (0, faixa))

    destino = os.path.join(OUT, f'captura-{i}.png')
    canvas.save(destino, 'PNG', optimize=True)
    print(f'  captura-{i}.png  {canvas.width}x{canvas.height}  faixa={faixa}')

print('\nPronto — em logotipo/loja/capturas-ios/')
