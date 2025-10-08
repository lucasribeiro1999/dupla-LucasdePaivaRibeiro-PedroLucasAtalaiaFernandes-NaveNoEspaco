/* ======================================================================
   Nave no Espaço — Patrulha de Asteroides (Canvas + JS puro)
   Atende: loop rAF, update/draw, input, paralaxe, entidades, colisão AABB,
           SPRITESHEET & CLIPPING (idle/run/shoot com frameTimer), projéteis.
====================================================================== */

(() => {
  // ===== Canvas / Setup =====
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const WIDTH = canvas.width, HEIGHT = canvas.height;

  // ===== Estados do jogo =====
  const GameState = { MENU: 'menu', PLAYING: 'playing', GAMEOVER: 'gameover' };
  let gameState = GameState.MENU;

  // ===== Entrada por teclado =====
  const keys = Object.create(null);
  const PRESS = (e, v) => { keys[e.code] = v; if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault(); };
  addEventListener('keydown', e => PRESS(e, true));
  addEventListener('keyup',   e => PRESS(e, false));

  // Botão iniciar e tecla Enter
  document.getElementById('startBtn').addEventListener('click', startGame);
  addEventListener('keydown', e => {
    if (e.code === 'Enter' && (gameState === GameState.MENU || gameState === GameState.GAMEOVER)) startGame();
  });

  // ===== Utilidades =====
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const aabb = (ax, ay, aw, ah, bx, by, bw, bh) =>
    ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

  // ===== Parâmetros da SPRITESHEET (Item 3) =====
  // {larguraFrame}x{alturaFrame} e {cols}x{rows}: idle/run/shoot em linhas
  const FRAME_W = 32, FRAME_H = 32;
  const COLS = 4, ROWS = 3; // 4 colunas × 3 linhas
  const FRAMES_PER_STATE = 4;

  const PState = { IDLE: 0, RUN: 1, SHOOT: 2 };

  // Spritesheet do player gerada em runtime (pode ser imagem externa se desejar)
  const shipSheet = document.createElement('canvas');
  shipSheet.width = FRAME_W * COLS;
  shipSheet.height = FRAME_H * ROWS;
  const sctx = shipSheet.getContext('2d');

  // Desenha 3 linhas (IDLE/RUN/SHOOT), cada uma com 4 frames
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x = col * FRAME_W, y = row * FRAME_H;

      // fundo transparente
      sctx.clearRect(x, y, FRAME_W, FRAME_H);

      // brilho
      sctx.fillStyle = 'rgba(124,199,255,0.12)';
      sctx.beginPath(); sctx.arc(x+16, y+16, 15, 0, Math.PI*2); sctx.fill();

      // cor por estado (só para visualização)
      const body = row === PState.IDLE ? '#c7f0ff'
                 : row === PState.RUN  ? '#9fe0ff'
                 :                        '#d3f9d8';
      sctx.fillStyle = body;
      sctx.strokeStyle = '#2b88c8';
      sctx.lineWidth = 2;

      // nave triangular
      sctx.beginPath();
      sctx.moveTo(x + 16, y + 5);
      sctx.lineTo(x + 27, y + 26);
      sctx.lineTo(x + 5,  y + 26);
      sctx.closePath();
      sctx.fill(); sctx.stroke();

      // cockpit
      sctx.fillStyle = '#163a5a';
      sctx.fillRect(x + 13, y + 12, 6, 6);

      // chama traseira (oscila por coluna)
      const flick = (col % 2 === 0) ? 3 : 0;
      sctx.fillStyle = row === PState.SHOOT ? '#ffd166' : '#ffa94d';
      sctx.beginPath();
      sctx.moveTo(x + 16, y + 28);
      sctx.lineTo(x + 12, y + 24 + flick);
      sctx.lineTo(x + 20, y + 24 + (3 - flick));
      sctx.closePath();
      sctx.fill();

      // detalhe em RUN
      if (row === PState.RUN) {
        sctx.fillStyle = 'rgba(255,255,255,0.3)';
        sctx.fillRect(x + 7 + (col%2), y + 18, 3, 3);
        sctx.fillRect(x + 22 - (col%2), y + 18, 3, 3);
      }
    }
  }

  // Animator simples com frameTimer e estados
  class SpriteAnimator {
    constructor({ frameRate = 0.10 } = {}) {
      this.state = PState.IDLE;
      this.col = 0;
      this.frameTimer = 0;
      this.frameRate = frameRate;   // segundos por frame
      this.pendingReturn = null;    // para SHOOT one-shot
    }
    setState(next, oneShot = false) {
      if (this.state === next) return;
      if (oneShot) this.pendingReturn = this.state;
      this.state = next; this.col = 0; this.frameTimer = 0;
    }
    update(dt) {
      this.frameTimer += dt;
      if (this.frameTimer >= this.frameRate) {
        this.frameTimer = 0;
        this.col = (this.col + 1) % FRAMES_PER_STATE;
        if (this.state === PState.SHOOT && this.col === 0 && this.pendingReturn !== null) {
          this.state = this.pendingReturn; this.pendingReturn = null;
        }
      }
    }
    draw(ctx, x, y, w, h) {
      const sx = this.col * FRAME_W;
      const sy = this.state * FRAME_H;
      // CLIPPING com drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
      ctx.drawImage(shipSheet, sx, sy, FRAME_W, FRAME_H, x, y, w, h);
    }
  }

  // ===== Entidades =====
  class Player {
    constructor() {
      this.w = 32; this.h = 32;
      this.x = WIDTH/2 - this.w/2;
      this.y = HEIGHT - 80;
      this.speed = 260;
      this.cooldown = 0;
      this.hp = 3;
      this.invul = 0;
      this.anim = new SpriteAnimator({ frameRate: 0.09 });
    }
    update(dt) {
      let dx = 0, dy = 0;
      if (keys['ArrowLeft'] || keys['KeyA']) dx -= 1;
      if (keys['ArrowRight']|| keys['KeyD']) dx += 1;
      if (keys['ArrowUp']   || keys['KeyW']) dy -= 1;
      if (keys['ArrowDown'] || keys['KeyS']) dy += 1;

      const moving = (dx !== 0 || dy !== 0);

      const len = Math.hypot(dx, dy) || 1;
      this.x += (dx/len) * this.speed * dt;
      this.y += (dy/len) * this.speed * dt;
      this.x = clamp(this.x, 0, WIDTH - this.w);
      this.y = clamp(this.y, 0, HEIGHT - this.h);

      // Alterna estado de animação (idle/run)
      this.anim.setState(moving ? PState.RUN : PState.IDLE);

      // Disparo (estado SHOOT one-shot)
      this.cooldown -= dt;
      if ((keys['Space'] || keys['KeyJ']) && this.cooldown <= 0) {
        this.cooldown = 0.18;
        spawnBullet(this.x + this.w/2 - 2, this.y - 6);
        this.anim.setState(PState.SHOOT, true);
      }

      this.anim.update(dt);
      if (this.invul > 0) this.invul -= dt;
    }
    draw(ctx) {
      if (this.invul > 0 && Math.floor(this.invul*20) % 2 === 0) return; // piscada pós-hit
      this.anim.draw(ctx, this.x, this.y, this.w, this.h);
    }
    hit() {
      if (this.invul > 0) return;
      this.hp--; this.invul = 1.2;
      if (this.hp <= 0) endGame();
    }
  }

  class Bullet {
    constructor(x, y) {
      this.x = x; this.y = y; this.w = 4; this.h = 10;
      this.speed = 520; this.dead = false;
    }
    update(dt) { this.y -= this.speed * dt; if (this.y + this.h < 0) this.dead = true; }
    draw(ctx) { ctx.fillStyle = '#7cc7ff'; ctx.fillRect(this.x, this.y, this.w, this.h); }
  }

  class Asteroid {
    constructor() {
      this.w = this.h = 28 + Math.random()*28;
      this.x = Math.random() * (WIDTH - this.w);
      this.y = -this.h - Math.random() * 140;
      this.speed = 60 + Math.random()*120;
      this.dead = false;
      this.rot = Math.random()*Math.PI;
      this.rotSpeed = (Math.random() * 1 - .5) * 1.5;
    }
    update(dt) {
      this.y += this.speed * dt;
      this.rot += this.rotSpeed * dt;
      if (this.y > HEIGHT + 80) this.dead = true;

      if (aabb(this.x, this.y, this.w, this.h, player.x, player.y, player.w, player.h)) {
        this.dead = true; player.hit(); spawnParticles(this.x + this.w/2, this.y + this.h/2);
      }
    }
    draw(ctx) {
      ctx.save();
      ctx.translate(this.x + this.w/2, this.y + this.h/2);
      ctx.rotate(this.rot);
      ctx.fillStyle = '#9aa4b1';
      ctx.strokeStyle = '#5a6778';
      ctx.lineWidth = 2;
      roundedRect(ctx, -this.w/2, -this.h/2, this.w, this.h, 6);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  // Partículas simples
  const particles = [];
  function spawnParticles(x, y) {
    for (let i=0;i<12;i++) {
      particles.push({
        x, y,
        vx: (Math.random()*2-1)*120,
        vy: (Math.random()*2-1)*120,
        life: 0.4 + Math.random()*0.4
      });
    }
  }

  // ===== Paralaxe (3 camadas de estrelas) =====
  function makeStars(n, speed) {
    const a = new Array(n);
    for (let i=0;i<n;i++) a[i] = { x: Math.random()*WIDTH, y: Math.random()*HEIGHT, size: Math.random()*2+0.5, speed };
    return a;
  }
  const starsFar  = makeStars(60,  20);
  const starsMid  = makeStars(50,  40);
  const starsNear = makeStars(40,  80);

  function updateStars(arr, dt) {
    for (const s of arr) { s.y += s.speed * dt; if (s.y > HEIGHT) { s.y = -2; s.x = Math.random()*WIDTH; } }
  }
  function drawStars(arr) {
    ctx.beginPath();
    for (const s of arr) ctx.rect(s.x, s.y, s.size, s.size);
    ctx.fillStyle = '#cfe8ff'; ctx.fill();
  }

  // ===== Mundo =====
  let player = null;
  const bullets = [];
  const asteroids = [];
  let score = 0;
  let spawnTimer = 0;

  function startGame() {
    player = new Player();
    bullets.length = 0; asteroids.length = 0; particles.length = 0;
    score = 0; spawnTimer = 0;
    gameState = GameState.PLAYING;
  }
  function endGame() { gameState = GameState.GAMEOVER; }

  function spawnBullet(x, y) { bullets.push(new Bullet(x, y)); }
  function spawnAsteroid() {
    for (let i=asteroids.length-1; i>=0; i--) if (asteroids[i].dead) asteroids.splice(i,1);
    asteroids.push(new Asteroid());
  }

  // ===== Loop =====
  let last = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    const dt = Math.min((ts - last) / 1000, 0.033);
    last = ts; update(dt); draw();
  }
  requestAnimationFrame(loop);

  // ===== UPDATE (lógica) =====
  function update(dt) {
    if (gameState !== GameState.PLAYING) return;

    updateStars(starsFar, dt); updateStars(starsMid, dt); updateStars(starsNear, dt);

    player.update(dt);
    for (const b of bullets) b.update(dt);
    for (const a of asteroids) a.update(dt);

    // Colisão bala x asteroide
    for (const a of asteroids) {
      if (a.dead) continue;
      for (const b of bullets) {
        if (b.dead) continue;
        if (aabb(a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h)) {
          a.dead = true; b.dead = true; score += 10; spawnParticles(a.x + a.w/2, a.y + a.h/2); break;
        }
      }
    }

    // Limpeza
    for (let i=bullets.length-1; i>=0; i--) if (bullets[i].dead) bullets.splice(i,1);
    for (let i=asteroids.length-1; i>=0; i--) if (asteroids[i].dead) asteroids.splice(i,1);

    // Spawner com leve aceleração
    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawnAsteroid(); spawnTimer = Math.max(0.25, 1.1 - score * 0.002); }

    // Partículas
    for (let i=particles.length-1; i>=0; i--) {
      const p = particles[i]; p.life -= dt; p.x += p.vx*dt; p.y += p.vy*dt; if (p.life <= 0) particles.splice(i,1);
    }
  }

  // ===== DRAW (renderização) =====
  function draw() {
    // Fundo
    ctx.fillStyle = '#060a12'; ctx.fillRect(0,0,WIDTH,HEIGHT);

    // Paralaxe
    drawStars(starsFar); drawStars(starsMid); drawStars(starsNear);

    // Estados
    if (gameState === GameState.MENU) { drawTitle('NAVE NO ESPAÇO', 'Pressione ENTER ou clique em Jogar'); return; }
    if (gameState === GameState.GAMEOVER) { drawHUD(); drawTitle('GAME OVER', 'ENTER para reiniciar'); return; }

    // Gameplay
    for (const a of asteroids) a.draw(ctx);
    for (const b of bullets)   b.draw(ctx);
    for (const p of particles) { ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = '#7cc7ff'; ctx.fillRect(p.x, p.y, 3, 3); ctx.globalAlpha = 1; }
    player.draw(ctx);
    drawHUD();
  }

  // ===== HUD / UI =====
  function drawHUD() {
    ctx.fillStyle = '#e6f1ff';
    ctx.font = '16px monospace';
    ctx.fillText(`Score: ${score}`, 16, 26);
    ctx.fillText(`HP: ${player ? player.hp : 0}`, 16, 46);
  }
  function drawTitle(title, subtitle) {
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(0,0,WIDTH,HEIGHT);
    ctx.fillStyle = '#7cc7ff'; ctx.font = 'bold 48px system-ui,Segoe UI,Roboto,sans-serif';
    centerText(title, HEIGHT/2 - 10);
    ctx.fillStyle = '#e6f1ff'; ctx.font = '20px system-ui,Segoe UI,Roboto,sans-serif';
    centerText(subtitle, HEIGHT/2 + 28);
  }
  function centerText(text, y) { const m = ctx.measureText(text); ctx.fillText(text, WIDTH/2 - m.width/2, y); }
  function roundedRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x+r, y); c.lineTo(x+w-r, y); c.quadraticCurveTo(x+w, y, x+w, y+r);
    c.lineTo(x+w, y+h-r); c.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    c.lineTo(x+r, y+h); c.quadraticCurveTo(x, y+h, x, y+h-r);
    c.lineTo(x, y+r); c.quadraticCurveTo(x, y, x+r, y); c.closePath();
  }
})();
