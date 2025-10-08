/* ======================================================================
   Nave no Espaço — Patrulha de Asteroides (Canvas + JS puro)

   + Música de fundo (MP3) em loop:
     - Coloque seu arquivo em /audio/music.mp3
     - A música inicia na primeira interação do usuário e fica em loop contínuo.
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
  const PRESS = (e, v) => {
    keys[e.code] = v;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  };
  addEventListener('keydown', e => PRESS(e, true));
  addEventListener('keyup',   e => PRESS(e, false));

  // Botão iniciar e tecla Enter
  const startBtn = document.getElementById('startBtn');
  startBtn.addEventListener('click', startGame);
  addEventListener('keydown', e => {
    if (e.code === 'Enter' && (gameState === GameState.MENU || gameState === GameState.GAMEOVER)) startGame();
  });

  // ===== Utilidades =====
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const aabb = (ax, ay, aw, ah, bx, by, bw, bh) =>
    ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  const MAX_DT = 0.033;

  // ====== Áudio (Web Audio API) ======
  // Música de fundo em loop usando Web Audio (baixa latência e loop contínuo).
  const AudioMgr = (() => {
    const Ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buffers = {}; // nome → AudioBuffer
    let resumed = false;

    async function load(name, url) {
      const res = await fetch(url);
      const arr = await res.arrayBuffer();
      buffers[name] = await Ctx.decodeAudioData(arr);
    }

    function playLoop(name, { volume = 0.35, detune = 0 } = {}) {
      const buf = buffers[name];
      if (!buf) return null;
      const src = Ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true; // <-- loop contínuo
      if (src.detune) src.detune.value = detune;
      const gain = Ctx.createGain();
      gain.gain.value = volume;
      src.connect(gain).connect(Ctx.destination);
      src.start(0);
      return { src, gain };
    }

    // Desbloqueio do áudio no primeiro gesto do usuário
    function resumeOnUserGesture() {
      if (resumed) return;
      const tryResume = () => {
        if (Ctx.state !== 'running') Ctx.resume();
        resumed = true;
        removeEventListener('click', tryResume);
        removeEventListener('keydown', tryResume);
        removeEventListener('touchstart', tryResume);
      };
      addEventListener('click', tryResume);
      addEventListener('keydown', tryResume);
      addEventListener('touchstart', tryResume);
    }

    return { Ctx, load, playLoop, resumeOnUserGesture };
  })();

  // Carregue sua música MP3 de /audio/music.mp3
  AudioMgr.resumeOnUserGesture();
  const audioReady = AudioMgr.load('bgm', 'audio/music.mp3');
  let bgmHandle = null; // { src, gain }
  let bgmStarted = false;

  // ===== Spritesheet do Player (idle/run/shoot) =====
  const FRAME_W = 32, FRAME_H = 32;
  const COLS = 4, ROWS = 3, FRAMES_PER_STATE = 4;
  const PState = { IDLE: 0, RUN: 1, SHOOT: 2 };

  const shipSheet = document.createElement('canvas');
  shipSheet.width = FRAME_W * COLS; shipSheet.height = FRAME_H * ROWS;
  const sctx = shipSheet.getContext('2d');
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    const x = col*FRAME_W, y = row*FRAME_H;
    sctx.clearRect(x,y,FRAME_W,FRAME_H);
    sctx.fillStyle='rgba(124,199,255,0.12)'; sctx.beginPath(); sctx.arc(x+16,y+16,15,0,Math.PI*2); sctx.fill();
    sctx.fillStyle = row===PState.IDLE?'#c7f0ff':row===PState.RUN?'#9fe0ff':'#d3f9d8';
    sctx.strokeStyle='#2b88c8'; sctx.lineWidth=2;
    sctx.beginPath(); sctx.moveTo(x+16,y+5); sctx.lineTo(x+27,y+26); sctx.lineTo(x+5,y+26); sctx.closePath(); sctx.fill(); sctx.stroke();
    sctx.fillStyle='#163a5a'; sctx.fillRect(x+13,y+12,6,6);
    const flick = (col%2===0)?3:0;
    sctx.fillStyle = row===PState.SHOOT?'#ffd166':'#ffa94d';
    sctx.beginPath(); sctx.moveTo(x+16,y+28); sctx.lineTo(x+12,y+24+flick); sctx.lineTo(x+20,y+24+(3-flick)); sctx.closePath(); sctx.fill();
    if(row===PState.RUN){ sctx.fillStyle='rgba(255,255,255,0.3)'; sctx.fillRect(x+7+(col%2),y+18,3,3); sctx.fillRect(x+22-(col%2),y+18,3,3); }
  }

  class SpriteAnimator {
    constructor({ frameRate=0.10 }={}){ this.state=PState.IDLE; this.col=0; this.frameTimer=0; this.frameRate=frameRate; this.pendingReturn=null; }
    setState(next, oneShot=false){ if(this.state===next) return; if(oneShot) this.pendingReturn=this.state; this.state=next; this.col=0; this.frameTimer=0; }
    update(dt){
      this.frameTimer += dt;
      if(this.frameTimer >= this.frameRate){
        this.frameTimer = 0; this.col = (this.col+1)%FRAMES_PER_STATE;
        if(this.state===PState.SHOOT && this.col===0 && this.pendingReturn!==null){ this.state=this.pendingReturn; this.pendingReturn=null; }
      }
    }
    draw(ctx,x,y,w,h){ const sx=this.col*FRAME_W, sy=this.state*FRAME_H; ctx.drawImage(shipSheet,sx,sy,FRAME_W,FRAME_H,x,y,w,h); }
  }

  // ===== Pools =====
  class Bullet {
    constructor(){ this.w=4; this.h=10; this.speed=520; this.active=false; this.x=0; this.y=0; }
    spawn(x,y){ this.x=x; this.y=y; this.active=true; }
    kill(){ this.active=false; }
    update(dt){ if(!this.active) return; this.y -= this.speed*dt; if(this.y + this.h < 0) this.kill(); }
    draw(ctx){ if(!this.active) return; ctx.fillStyle='#7cc7ff'; ctx.fillRect(this.x,this.y,this.w,this.h); }
  }
  const BULLET_POOL_SIZE=64;
  const bullets=Array.from({length:BULLET_POOL_SIZE},()=>new Bullet());
  const resetBullets=()=>{ for(let i=0;i<bullets.length;i++) bullets[i].active=false; };
  function spawnBullet(x,y){ for(let i=0;i<BULLET_POOL_SIZE;i++){ const b=bullets[i]; if(!b.active){ b.spawn(x,y); return; } } }

  class Particle {
    constructor(){ this.active=false; this.x=0; this.y=0; this.vx=0; this.vy=0; this.life=0; }
    spawn(x,y){ this.active=true; this.x=x; this.y=y; this.vx=(Math.random()*2-1)*120; this.vy=(Math.random()*2-1)*120; this.life=0.4+Math.random()*0.4; }
    update(dt){ if(!this.active) return; this.life-=dt; this.x+=this.vx*dt; this.y+=this.vy*dt; if(this.life<=0) this.active=false; }
    draw(ctx){ if(!this.active) return; ctx.globalAlpha=Math.max(0,this.life); ctx.fillStyle='#7cc7ff'; ctx.fillRect(this.x,this.y,3,3); ctx.globalAlpha=1; }
  }
  const PARTICLE_POOL_SIZE=128;
  const particles=Array.from({length:PARTICLE_POOL_SIZE},()=>new Particle());
  const resetParticles=()=>{ for(let i=0;i<particles.length;i++) particles[i].active=false; };
  function spawnParticles(x,y){ let spawned=0; for(let i=0;i<PARTICLE_POOL_SIZE && spawned<12;i++){ const p=particles[i]; if(!p.active){ p.spawn(x,y); spawned++; } } }

  // ===== Player (com trailing e knockback) =====
  class Player {
    constructor(){
      this.w=32; this.h=32;
      this.x=WIDTH/2 - this.w/2; this.y=HEIGHT-80;
      this.speed=260; this.cooldown=0; this.hp=3; this.invul=0;
      this.anim=new SpriteAnimator({frameRate:0.09});
      this.trail=[]; this.TRAIL_MAX=12; this._trailAcc=0;
      this.kx=0; this.ky=0; this.kTimer=0;
    }
    update(dt){
      let dx=0, dy=0;
      if(keys['ArrowLeft'] || keys['KeyA']) dx-=1;
      if(keys['ArrowRight']|| keys['KeyD']) dx+=1;
      if(keys['ArrowUp']   || keys['KeyW']) dy-=1;
      if(keys['ArrowDown'] || keys['KeyS']) dy+=1;

      const moving = (dx||dy);
      const len = Math.hypot(dx,dy)||1;
      this.x += (dx/len)*this.speed*dt;
      this.y += (dy/len)*this.speed*dt;

      if(this.kTimer>0){ this.x += this.kx*dt; this.y += this.ky*dt; this.kx*=0.9; this.ky*=0.9; this.kTimer-=dt; }

      this.x = clamp(this.x,0,WIDTH-this.w);
      this.y = clamp(this.y,0,HEIGHT-this.h);

      this.anim.setState(moving ? PState.RUN : PState.IDLE);

      this.cooldown -= dt;
      if((keys['Space']||keys['KeyJ']) && this.cooldown<=0){
        this.cooldown=0.18;
        spawnBullet(this.x+this.w/2-2, this.y-6);
        this.anim.setState(PState.SHOOT, true);
      }

      this._trailAcc += dt;
      if(moving && this._trailAcc >= 0.02){
        this._trailAcc = 0;
        this.trail.unshift({x:this.x, y:this.y, frame:this.anim.col, state:this.anim.state});
        if(this.trail.length>this.TRAIL_MAX) this.trail.pop();
      } else if(!moving && this.trail.length>0){
        this.trail.pop();
      }

      this.anim.update(dt);
      if(this.invul>0) this.invul-=dt;
    }
    draw(ctx){
      for(let i=this.trail.length-1;i>=0;i--){
        const t=this.trail[i];
        const alpha = (i+1)/(this.TRAIL_MAX*6);
        ctx.globalAlpha = alpha;
        const sx=t.frame*FRAME_W, sy=t.state*FRAME_H;
        ctx.drawImage(shipSheet, sx, sy, FRAME_W, FRAME_H, t.x, t.y, this.w, this.h);
      }
      ctx.globalAlpha = 1;
      if(this.invul>0 && Math.floor(this.invul*20)%2===0) return;
      this.anim.draw(ctx,this.x,this.y,this.w,this.h);
    }
    hit(){
      if(this.invul>0) return;
      this.hp--; this.invul=1.2;
      const vx = (this.x + this.w/2) - WIDTH/2;
      const vy = (this.y + this.h/2) - HEIGHT/2;
      const n = Math.hypot(vx,vy) || 1;
      this.kx = (vx/n) * 260;
      this.ky = (vy/n) * 260;
      this.kTimer = 0.15;
      screenFlash = 0.20;
      if(this.hp<=0) endGame();
    }
  }

  // ===== Inimigos =====
  class Asteroid {
    constructor(){
      this.w=this.h=28 + Math.random()*28;
      this.x=Math.random()*(WIDTH-this.w);
      this.y=-this.h - Math.random()*140;
      this.speed=60 + Math.random()*120;
      this.dead=false;
      this.rot=Math.random()*Math.PI;
      this.rotSpeed=(Math.random()*1 - .5)*1.5;
    }
    update(dt){
      this.y += this.speed*dt; this.rot += this.rotSpeed*dt;
      if(this.y>HEIGHT+80) this.dead=true;
      if(!this.dead && aabb(this.x,this.y,this.w,this.h, player.x,player.y,player.w,player.h)){
        this.dead=true; player.hit(); spawnParticles(this.x+this.w/2, this.y+this.h/2);
      }
    }
    draw(ctx){
      ctx.save(); ctx.translate(this.x+this.w/2, this.y+this.h/2); ctx.rotate(this.rot);
      ctx.fillStyle='#9aa4b1'; ctx.strokeStyle='#5a6778'; ctx.lineWidth=2;
      roundedRect(ctx,-this.w/2,-this.h/2,this.w,this.h,6); ctx.fill(); ctx.stroke(); ctx.restore();
    }
  }
  const asteroids=[];
  const resetAsteroids=()=>{ asteroids.length=0; };
  function spawnAsteroid(){ for(let i=asteroids.length-1;i>=0;i--) if(asteroids[i].dead) asteroids.splice(i,1); asteroids.push(new Asteroid()); }

  // ===== Paralaxe (4 camadas + poeira/nébula) =====
  function makeStars(n, speedY, speedX=0){
    const a=new Array(n);
    for(let i=0;i<n;i++) a[i]={ x:Math.random()*WIDTH, y:Math.random()*HEIGHT, size:Math.random()*2+0.5, sy:speedY, sx:speedX };
    return a;
  }
  const starsUltraFar = makeStars(70, 10,  -4);
  const starsFar      = makeStars(60, 20,   6);
  const starsMid      = makeStars(50, 40,  -12);
  const starsNear     = makeStars(40, 80,   18);

  const nebula = new Array(6).fill(0).map(() => ({
    x: Math.random()*WIDTH, y: Math.random()*HEIGHT,
    r: 80+Math.random()*120, sy: 6+Math.random()*6, sx: (Math.random()<.5?-1:1)*3
  }));

  function updateStars(arr, dt){
    for(let i=0;i<arr.length;i++){
      const s=arr[i];
      s.y += s.sy*dt; s.x += s.sx*dt;
      if(s.y > HEIGHT) { s.y = -2; s.x = Math.random()*WIDTH; }
      if(s.x < -4) s.x = WIDTH+4; else if(s.x > WIDTH+4) s.x = -4;
    }
  }
  function drawStars(arr){
    ctx.beginPath();
    for(let i=0;i<arr.length;i++){ const s=arr[i]; ctx.rect(s.x, s.y, s.size, s.size); }
    ctx.fillStyle='#cfe8ff'; ctx.fill();
  }
  function updateNebula(dt){
    for(const n of nebula){
      n.y += n.sy*dt; n.x += n.sx*dt;
      if(n.y - n.r > HEIGHT){ n.y = -n.r; n.x = Math.random()*WIDTH; }
      if(n.x < -n.r) n.x = WIDTH+n.r; else if(n.x > WIDTH+n.r) n.x = -n.r;
    }
  }
  function drawNebula(){
    for(const n of nebula){
      const g = ctx.createRadialGradient(n.x, n.y, n.r*0.2, n.x, n.y, n.r);
      g.addColorStop(0, 'rgba(120,160,255,0.18)');
      g.addColorStop(1, 'rgba(120,160,255,0.0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI*2); ctx.fill();
    }
  }

  // ===== Mundo =====
  let player=null, score=0, spawnTimer=0, screenFlash=0;

  function startGame(){
    // Inicia música em loop na primeira vez que o jogo começa
    if (!bgmStarted) {
      bgmStarted = true;
      audioReady.then(() => {
        if (!bgmHandle) bgmHandle = AudioMgr.playLoop('bgm', { volume: 0.35 });
      });
    }

    player=new Player();
    resetBullets(); resetParticles(); resetAsteroids();
    score=0; spawnTimer=0; screenFlash=0;
    gameState=GameState.PLAYING;
  }
  function endGame(){ gameState=GameState.GAMEOVER; }

  // ===== Loop =====
  let last=0;
  function loop(ts){
    requestAnimationFrame(loop);
    const dt = Math.min((ts-last)/1000, MAX_DT); last=ts;
    update(dt); draw();
  }
  requestAnimationFrame(loop);

  // ===== UPDATE =====
  function update(dt){
    if(gameState !== GameState.PLAYING) return;

    updateStars(starsUltraFar, dt);
    updateStars(starsFar, dt);
    updateStars(starsMid, dt);
    updateStars(starsNear, dt);
    updateNebula(dt);

    player.update(dt);

    for(let i=0;i<bullets.length;i++) bullets[i].update(dt);
    for(let i=0;i<asteroids.length;i++) asteroids[i].update(dt);

    for(let i=0;i<asteroids.length;i++){
      const a=asteroids[i]; if(a.dead) continue;
      for(let j=0;j<bullets.length;j++){
        const b=bullets[j]; if(!b.active) continue;
        if(aabb(a.x,a.y,a.w,a.h,b.x,b.y,b.w,b.h)){
          a.dead=true; b.kill(); score+=10; spawnParticles(a.x+a.w/2, a.y+a.h/2); break;
        }
      }
    }

    for(let i=asteroids.length-1;i>=0;i--) if(asteroids[i].dead) asteroids.splice(i,1);

    spawnTimer -= dt;
    if(spawnTimer<=0){ spawnAsteroid(); spawnTimer = Math.max(0.25, 1.1 - score * 0.002); }

    for(let i=0;i<particles.length;i++) particles[i].update(dt);

    if(screenFlash>0) screenFlash -= dt;
  }

  // ===== DRAW =====
  function draw(){
    ctx.fillStyle='#060a12'; ctx.fillRect(0,0,WIDTH,HEIGHT);

    drawStars(starsUltraFar);
    drawNebula();
    drawStars(starsFar);
    drawStars(starsMid);
    drawStars(starsNear);

    if(gameState===GameState.MENU){ drawTitle('NAVE NO ESPAÇO', 'Pressione ENTER ou clique em Jogar'); return; }
    if(gameState===GameState.GAMEOVER){ drawHUD(); drawTitle('GAME OVER', 'ENTER para reiniciar'); return; }

    for(let i=0;i<asteroids.length;i++) asteroids[i].draw(ctx);
    for(let i=0;i<bullets.length;i++)   bullets[i].draw(ctx);
    for(let i=0;i<particles.length;i++) particles[i].draw(ctx);
    player.draw(ctx);

    if(screenFlash>0){
      ctx.globalAlpha = Math.min(0.6, screenFlash*3);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0,0,WIDTH,HEIGHT);
      ctx.globalAlpha = 1;
    }

    drawHUD();
  }

  // ===== HUD / UI =====
  function drawHUD(){
    ctx.save();
    ctx.fillStyle='#e6f1ff';
    ctx.font='700 16px monospace';
    ctx.shadowColor='rgba(0,0,0,0.6)';
    ctx.shadowBlur=6;
    ctx.fillText(`Score: ${score}`, 16, 26);
    ctx.fillText(`HP: ${player ? player.hp : 0}`, 16, 46);
    ctx.restore();
  }
  function drawTitle(title, subtitle){
    ctx.fillStyle='rgba(0,0,0,.35)'; ctx.fillRect(0,0,WIDTH,HEIGHT);
    ctx.fillStyle='#7cc7ff'; ctx.font='bold 48px system-ui,Segoe UI,Roboto,sans-serif';
    centerText(title, HEIGHT/2 - 10);
    ctx.fillStyle='#e6f1ff'; ctx.font='20px system-ui,Segoe UI,Roboto,sans-serif';
    centerText(subtitle, HEIGHT/2 + 28);
  }
  function centerText(text,y){ const m=ctx.measureText(text); ctx.fillText(text, WIDTH/2 - m.width/2, y); }
  function roundedRect(c,x,y,w,h,r){ c.beginPath(); c.moveTo(x+r,y); c.lineTo(x+w-r,y); c.quadraticCurveTo(x+w,y,x+w,y+r); c.lineTo(x+w,y+h-r); c.quadraticCurveTo(x+w,y+h,x+w-r,y+h); c.lineTo(x+r,y+h); c.quadraticCurveTo(x,y+h,x,y+h-r); c.lineTo(x,y+r); c.quadraticCurveTo(x,y,x+r,y); c.closePath(); }
})();
