# Nave no Espaço — Patrulha de Asteroides

Jogo 2D em **HTML5 Canvas + JS puro**. Tema: **Nave no Espaço**.

## Como executar
1. Abra `index.html` no navegador (Chrome/Edge/Firefox).  
2. Clique em **Jogar** ou pressione **ENTER**.

## Controles
- **WASD/Setas**: mover a nave  
- **ESPAÇO**: atirar  
- **ENTER**: iniciar/reiniciar

## Requisitos atendidos (1–6)
- **Loop + update/draw**: `requestAnimationFrame`, funções separadas.  
- **Input**: WASD/Setas + Espaço.  
- **Paralaxe**: 4 camadas (distância, velocidade X/Y) + **nébula**.  
- **AABB**: colisões Player×Asteroide e Bala×Asteroide.  
- **Spritesheet & Clipping**: sprite programático **4x3** (idle/run/shoot) com `drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)` e `frameTimer`.  
- **Projéteis**: pool de balas, direção/velocidade, remoção off-screen, score no HUD.
- **Otimização**: object pooling (balas/partículas), culling, `MAX_DT`.  
- **Polimento**: trailing (motion blur falso), HUD com sombra, **flash + knockback** ao dano.

## Estrutura
index.html
style.css
main.js

## Créditos de assets
Sprites do player gerados por código (sem arquivo externo). Sons/imagens externos **utilizados**.

## Licença
Uso acadêmico/educacional.