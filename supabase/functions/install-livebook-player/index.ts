// install-livebook-player v9 — CEO-171 follow-up (2026-04-27): mobile
// portrait intro screen layout overlap fix. Source previously lived
// only in the deployed bundle (extracted from the Supabase edge fn
// sourcemap and committed for the first time here). User-reported
// regression: on a portrait phone, the intro screen's centered flex
// layout caused the long h1 title and the lede text to visually
// overlap because total content height exceeded viewport while
// justify-content:center pushed top content above the screen.
//
// Fix: extend the existing @media (max-width:680px) block to:
//  - switch intro to top-aligned scrollable (justify-content:flex-start
//    + overflow-y:auto)
//  - shrink h1 font-size to clamp(1.3rem,5.2vw,1.8rem) so a 12+ word
//    title fits in 4–5 lines instead of 8+
//  - drop the meta row from 3-column grid to single-column stacked,
//    so labels and values fit on narrow screens
//  - tighten vertical margins and side padding to claw back space
//
// CRITICAL: zero changes to the playback logic, audio chain, particle
// engine, or run loop. This is a CSS-only diff inside the @media block.
//
// v8 (prior): keep the v7 architectural fix (tremolo on moodGain
// instead of master) but revert master gain control to setTargetAtTime
// (proven in v6). v7's linearRampToValueAtTime didn't audibly produce
// sound — likely a subtle interaction with AudioParam value-reading
// when used inside a fresh context.
//
// Audio chain (unchanged since v7):
//   voices -> ambMoodGain (tremolo here when pulse mood)
//          -> ambFilter
//          -> ambMaster   (slider/mute, no LFO)
//          -> destination
//
// Master gain control: setTargetAtTime with cancelScheduledValues.
//
// Visible audio state probe in the err-banner if AudioContext fails
// to start, so we see what's wrong instead of silent failure.

import { createClient } from "jsr:@supabase/supabase-js@2";

const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET");

function buildPlayerHtml(slug: string): string {
  const manifestUrl = `https://lodupspxdvadamrqvkje.supabase.co/functions/v1/livebook-manifest?slug=${encodeURIComponent(slug)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>LiveBook — Penworth</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
<style>
:root { --bg:#0a0806; --paper:#f5ede0; --gold-glow:#d4a95f; --serif:'Fraunces',Georgia,serif; --sans:'Inter',system-ui,sans-serif; }
* { box-sizing:border-box; margin:0; padding:0; }
html,body { width:100%; height:100%; overflow:hidden; background:var(--bg); color:var(--paper); font-family:var(--sans); }
#stage { position:fixed; inset:0; overflow:hidden; }
#particles { position:absolute; inset:0; width:100%; height:100%; z-index:1; }
#tint { position:absolute; inset:0; z-index:2; pointer-events:none; background:radial-gradient(ellipse at 50% 50%, var(--scene-tint, rgba(212,169,95,0.06)) 0%, transparent 70%); transition:background 2.4s ease; }
#image-stage { position:absolute; inset:0; z-index:3; pointer-events:none; display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity 1.6s ease; }
#image-stage.visible { opacity:0.62; }
#image-stage.dominant { opacity:0.85; }
#image-stage img { max-width:60vw; max-height:60vh; object-fit:contain; filter:contrast(1.05) saturate(0.9); transition:transform 8s ease; }
#image-stage.parallax img { transform:translateY(-12px); }
#chap-line { position:absolute; top:1.5rem; left:50%; transform:translateX(-50%); z-index:6; opacity:0; transition:opacity 0.8s ease; font-family:var(--sans); font-size:0.7rem; letter-spacing:0.3em; text-transform:uppercase; color:rgba(244,239,229,0.45); white-space:nowrap; max-width:90vw; overflow:hidden; text-overflow:ellipsis; }
#chap-line.visible { opacity:1; }
.cap-layer { position:absolute; left:50%; bottom:8vh; z-index:5; transform:translateX(-50%); width:min(82vw,920px); text-align:center; font-family:var(--serif); font-weight:400; font-size:clamp(1.2rem,2.4vmin,1.55rem); line-height:1.55; color:rgba(244,239,229,0.95); text-shadow:0 2px 24px rgba(0,0,0,0.75); pointer-events:none; opacity:0; transition:opacity 200ms ease; }
.cap-layer.visible { opacity:1; }
.word { transition:color 200ms ease,text-shadow 200ms ease; color:rgba(244,239,229,0.4); }
.word.spoken { color:rgba(244,239,229,0.92); }
.word.active { color:var(--paper); text-shadow:0 0 12px rgba(247,213,138,0.4),0 2px 24px rgba(0,0,0,0.85); }
#intro { position:absolute; inset:0; z-index:20; display:flex; flex-direction:column; align-items:center; justify-content:center; background:linear-gradient(180deg,#0a0806 0%,#120e0a 100%); transition:opacity 1.2s ease; padding:2rem; }
#intro.hidden { opacity:0; pointer-events:none; }
#intro .eyebrow { font-family:var(--sans); font-size:0.7rem; letter-spacing:0.3em; text-transform:uppercase; color:var(--gold-glow); margin-bottom:1.5rem; }
#intro h1 { font-family:var(--serif); font-weight:400; font-size:clamp(1.8rem,4vw,3rem); line-height:1.15; text-align:center; max-width:880px; margin-bottom:1.5rem; min-height:3rem; }
#intro .lede { font-family:var(--sans); font-weight:300; color:rgba(244,239,229,0.7); font-size:0.95rem; line-height:1.6; text-align:center; max-width:540px; margin-bottom:2.5rem; min-height:1.5rem; }
#intro .meta { display:grid; grid-template-columns:repeat(3,auto); gap:2rem; margin-bottom:2rem; font-family:var(--sans); font-size:0.7rem; letter-spacing:0.18em; text-transform:uppercase; color:rgba(244,239,229,0.4); }
#intro .meta b { display:block; margin-top:0.4rem; font-weight:500; font-size:0.85rem; letter-spacing:0.02em; text-transform:none; color:var(--paper); }
#play-btn { background:var(--gold-glow); color:#0a0806; border:none; padding:1rem 3rem; font-family:var(--serif); font-size:1.05rem; font-weight:500; border-radius:999px; cursor:pointer; transition:transform 0.3s ease,box-shadow 0.3s ease; }
#play-btn:disabled { opacity:0.5; cursor:not-allowed; }
#play-btn:hover:not(:disabled) { transform:scale(1.04); box-shadow:0 8px 32px rgba(212,169,95,0.3); }
#intro .hint { margin-top:2rem; font-family:var(--sans); font-size:0.75rem; color:rgba(244,239,229,0.4); }
#controls { position:absolute; bottom:1.5rem; right:1.5rem; z-index:9; display:flex; align-items:center; gap:0.6rem; opacity:0; transition:opacity 0.4s ease; }
#controls.active { opacity:1; }
.control-btn { background:rgba(10,8,6,0.8); color:var(--paper); border:1px solid rgba(244,239,229,0.18); padding:0.55rem 1.1rem; font-family:var(--sans); font-size:0.78rem; border-radius:999px; cursor:pointer; backdrop-filter:blur(8px); display:inline-flex; align-items:center; gap:0.4rem; }
.control-btn .dot { width:6px; height:6px; border-radius:50%; background:var(--gold-glow); }
.control-btn.muted .dot { background:transparent; border:1px solid rgba(244,239,229,0.4); }
.audio-cluster { display:inline-flex; align-items:center; gap:0.5rem; background:rgba(10,8,6,0.8); border:1px solid rgba(244,239,229,0.18); border-radius:999px; padding:0.4rem 0.9rem; backdrop-filter:blur(8px); }
.audio-cluster .label { font-family:var(--sans); font-size:0.7rem; color:rgba(244,239,229,0.55); letter-spacing:0.04em; }
#mood-select { background:transparent; color:var(--paper); border:none; font-family:var(--sans); font-size:0.75rem; cursor:pointer; outline:none; padding:0; }
#mood-select option { background:#0a0806; color:var(--paper); }
#vol-slider { -webkit-appearance:none; appearance:none; width:80px; height:3px; background:rgba(244,239,229,0.18); border-radius:2px; outline:none; cursor:pointer; }
#vol-slider::-webkit-slider-thumb { -webkit-appearance:none; width:12px; height:12px; border-radius:50%; background:var(--gold-glow); cursor:pointer; border:none; }
#vol-slider::-moz-range-thumb { width:12px; height:12px; border-radius:50%; background:var(--gold-glow); cursor:pointer; border:none; }
#progress-wrap { position:absolute; bottom:1.5rem; left:1.5rem; right:24rem; z-index:9; height:2px; background:rgba(244,239,229,0.08); border-radius:2px; opacity:0; transition:opacity 0.4s ease; }
#progress-wrap.active { opacity:1; }
#progress-bar { height:100%; width:0; background:linear-gradient(90deg,transparent,var(--gold-glow)); border-radius:2px; transition:width 0.3s linear; }
#timecode { position:absolute; top:-1.5rem; right:0; font-family:var(--sans); font-size:0.7rem; color:rgba(244,239,229,0.4); }
#segment-badge { position:absolute; top:1.5rem; right:1.5rem; z-index:6; opacity:0; transition:opacity 0.6s ease; font-family:var(--sans); font-size:0.65rem; letter-spacing:0.2em; text-transform:uppercase; color:rgba(244,239,229,0.35); }
#segment-badge.visible { opacity:1; }
#end-screen { position:absolute; inset:0; z-index:20; display:flex; flex-direction:column; align-items:center; justify-content:center; background:linear-gradient(180deg,transparent 0%,rgba(10,8,6,0.92) 50%,var(--bg) 100%); opacity:0; pointer-events:none; transition:opacity 1.5s ease; }
#end-screen.visible { opacity:1; pointer-events:auto; }
#end-screen .eyebrow { font-family:var(--sans); font-size:0.7rem; letter-spacing:0.3em; text-transform:uppercase; color:var(--gold-glow); margin-bottom:1.5rem; }
#end-screen h2 { font-family:var(--serif); font-weight:400; font-size:clamp(1.6rem,3.5vw,2.4rem); text-align:center; margin-bottom:1rem; max-width:640px; }
#end-screen p { font-family:var(--sans); color:rgba(244,239,229,0.65); max-width:480px; text-align:center; line-height:1.6; margin-bottom:2rem; }
#end-screen button { background:var(--gold-glow); color:#0a0806; border:none; font-family:var(--serif); font-size:1rem; padding:0.85rem 2rem; border-radius:999px; cursor:pointer; }
#err-banner { position:absolute; top:0; left:0; right:0; z-index:30; background:#3a0c08; color:#ffd; font-family:var(--sans); font-size:0.75rem; padding:0.5rem 1rem; text-align:center; display:none; }
#err-banner.visible { display:block; }
@media (max-width:680px){ #progress-wrap{right:1.5rem; bottom:5.5rem;} #controls{flex-wrap:wrap; max-width:calc(100vw - 3rem);} .audio-cluster{padding:0.35rem 0.7rem;} #vol-slider{width:60px;} #intro{justify-content:flex-start; padding:3rem 1rem 2rem 1rem; overflow-y:auto;} #intro h1{font-size:clamp(1.3rem,5.2vw,1.8rem); margin-bottom:1rem; min-height:0;} #intro .lede{font-size:0.85rem; margin-bottom:1.5rem; padding:0 0.5rem;} #intro .meta{grid-template-columns:1fr; gap:0.75rem; margin-bottom:1.5rem; text-align:center;} #intro .meta span{display:flex; gap:0.5rem; justify-content:center; align-items:baseline;} #intro .meta b{display:inline; margin-top:0;} #intro .eyebrow{margin-bottom:1rem;} }
</style>
</head>
<body>
<div id="stage">
  <div id="err-banner"></div>
  <canvas id="particles"></canvas>
  <div id="tint"></div>
  <div id="image-stage"><img id="scene-img" alt="" /></div>
  <div id="chap-line"></div>
  <div id="segment-badge"></div>
  <div class="cap-layer" id="cap-a"></div>
  <div class="cap-layer" id="cap-b"></div>
  <audio id="narration" preload="auto"></audio>
  <div id="progress-wrap"><div id="timecode"><span id="elapsed">0:00</span> / <span id="total-time">—</span></div><div id="progress-bar"></div></div>
  <div id="controls">
    <div class="audio-cluster">
      <span class="label">Mood</span>
      <select id="mood-select">
        <option value="auto">Auto</option>
        <option value="calm">Calm</option>
        <option value="tension">Tension</option>
        <option value="pulse">Pulse</option>
        <option value="airy">Airy</option>
        <option value="bright">Bright</option>
      </select>
    </div>
    <div class="audio-cluster">
      <span class="label">Vol</span>
      <input type="range" id="vol-slider" min="0" max="100" value="40" />
    </div>
    <button class="control-btn" id="music-btn"><span class="dot"></span><span>Music</span></button>
    <button class="control-btn" id="pause-btn">Pause</button>
  </div>
  <div id="intro">
    <div class="eyebrow">Penworth · Directed Reading</div>
    <h1 id="intro-title">Loading…</h1>
    <div class="lede" id="intro-lede"></div>
    <div class="meta"><span>Chapter<b id="intro-chapter">—</b></span><span>Duration<b id="intro-duration">—</b></span><span>Voice<b id="intro-voice">—</b></span></div>
    <button id="play-btn" disabled>Loading…</button>
    <div class="hint" id="intro-hint">Headphones recommended.</div>
  </div>
  <div id="end-screen">
    <div class="eyebrow">End of preview</div>
    <h2>The book continues from here.</h2>
    <p>Continue reading or listening on Penworth.</p>
    <button id="restart-btn">Play again</button>
  </div>
</div>
<script>
'use strict';
const MANIFEST_URL = ${JSON.stringify(manifestUrl)};
let MANIFEST = null;
function showError(msg) { const b = document.getElementById('err-banner'); b.textContent = msg; b.classList.add('visible'); console.error('[livebook]', msg); }
async function loadManifest() { const r = await fetch(MANIFEST_URL); if (!r.ok) throw new Error('manifest ' + r.status); return await r.json(); }

const PALETTES = { amber:{rgb:[[212,169,95],[247,213,138],[180,130,60]],tint:'rgba(212,169,95,0.10)'}, cyan:{rgb:[[120,180,210],[80,140,180],[180,210,230]],tint:'rgba(120,180,210,0.08)'}, pale:{rgb:[[244,239,229],[200,200,210],[255,250,240]],tint:'rgba(244,239,229,0.05)'}, ember:{rgb:[[230,80,60],[200,50,40],[255,140,90]],tint:'rgba(230,80,60,0.10)'}, verdant:{rgb:[[120,180,120],[80,160,90],[160,200,150]],tint:'rgba(120,180,120,0.08)'} };
const MODE_BEHAVIOR = { calm:{spawn_rate:0.04,init_spread:'wide',velocity:0.15,life:12000}, chaotic:{spawn_rate:0.20,init_spread:'center',velocity:0.8,life:4000}, flowing:{spawn_rate:0.10,init_spread:'wide',velocity:0.35,life:9000}, pulsing:{spawn_rate:0.15,init_spread:'center',velocity:0.5,life:3000,burst:true,burst_interval:1600}, structured:{spawn_rate:0.07,init_spread:'wide',velocity:0.25,life:14000} };
class ParticleEngine {
  constructor(canvas) { this.canvas=canvas; this.ctx=canvas.getContext('2d'); this.particles=[]; this.cfg={mode:'calm',velocity:0.3,density:0.4,palette:PALETTES.amber.rgb}; this.w=0; this.h=0; this.lastT=0; this.lastBurstAt=0; this.spawnCarry=0; this.resize(); window.addEventListener('resize',()=>this.resize()); requestAnimationFrame(this.loop.bind(this)); }
  resize() { const dpr=window.devicePixelRatio||1; this.w=this.canvas.clientWidth; this.h=this.canvas.clientHeight; this.canvas.width=this.w*dpr; this.canvas.height=this.h*dpr; this.ctx.setTransform(1,0,0,1,0,0); this.ctx.scale(dpr,dpr); }
  setSegment(c) { const palName=PALETTES[c.color_theme]?c.color_theme:'amber'; this.cfg={mode:MODE_BEHAVIOR[c.mode]?c.mode:'calm',velocity:typeof c.velocity==='number'?c.velocity:0.4,density:typeof c.density==='number'?c.density:0.5,palette:PALETTES[palName].rgb}; document.documentElement.style.setProperty('--scene-tint',PALETTES[palName].tint); if (c.transition_from_previous==='hard_cut') this.particles=[]; }
  loop(t) { if (!this.lastT) this.lastT=t; const dt=Math.min(t-this.lastT,60); this.lastT=t; this.spawn(dt); this.update(dt); this.render(); requestAnimationFrame(this.loop.bind(this)); }
  spawn(dt) { const beh=MODE_BEHAVIOR[this.cfg.mode]; if (beh.burst) { if (this.lastT-this.lastBurstAt>=beh.burst_interval) { this.lastBurstAt=this.lastT; const n=Math.round(40*this.cfg.density); for (let i=0;i<n;i++) this.spawnOne(beh); } return; } const rate=beh.spawn_rate*(0.4+this.cfg.density*1.6); this.spawnCarry+=rate*dt; while (this.spawnCarry>=1) { this.spawnOne(beh); this.spawnCarry-=1; } }
  spawnOne(beh) { const w=this.w,h=this.h; const v=this.cfg.velocity*beh.velocity; let x,y,vx,vy; if (beh.init_spread==='center') { x=w*0.5+(Math.random()-0.5)*w*0.3; y=h*0.5+(Math.random()-0.5)*h*0.3; const a=Math.random()*Math.PI*2; vx=Math.cos(a)*v*(0.5+Math.random()); vy=Math.sin(a)*v*(0.5+Math.random()); } else { x=Math.random()*w; y=Math.random()<0.5?-10:h+10; vx=(Math.random()-0.5)*0.1*v; vy=(y<0?1:-1)*(0.2+Math.random()*0.3)*v; } const palette=this.cfg.palette; this.particles.push({x,y,vx,vy,life:beh.life,maxLife:beh.life,size:0.7+Math.random()*1.6,alpha:0.4+Math.random()*0.4,color:palette[Math.floor(Math.random()*palette.length)],twinkle:Math.random()*Math.PI*2}); }
  update(dt) { if (this.particles.length>600) this.particles.splice(0,this.particles.length-600); for (let i=this.particles.length-1;i>=0;i--) { const p=this.particles[i]; p.x+=p.vx*dt; p.y+=p.vy*dt; p.twinkle+=0.001*dt; p.life-=dt; if (p.life<=0||p.x<-50||p.x>this.w+50||p.y<-50||p.y>this.h+50) this.particles.splice(i,1); } }
  render() { const ctx=this.ctx; ctx.clearRect(0,0,this.w,this.h); ctx.globalCompositeOperation='lighter'; for (const p of this.particles) { const lifeT=p.life/p.maxLife; const fadeIn=0.15,fadeOut=0.3; let aMul=1; if (1-lifeT<fadeIn) aMul=(1-lifeT)/fadeIn; else if (lifeT<fadeOut) aMul=lifeT/fadeOut; const alpha=p.alpha*aMul*(0.7+0.3*Math.sin(p.twinkle)); const [r,g,b]=p.color; ctx.fillStyle='rgba('+r+','+g+','+b+','+alpha+')'; ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,Math.PI*2); ctx.fill(); } ctx.globalCompositeOperation='source-over'; }
}

// ============================================================================
// AMBIENT MUSIC v8 — v7 architecture, v6 master gain mechanism
// ============================================================================
const AMBIENT_VOLUME_CEILING = 0.16;
const MOOD_GAIN_TRIM = { calm:1.0, tension:0.85, pulse:0.62, airy:0.95, bright:0.95 };

let userVolumeFraction = 0.40;
let moodSelection = 'auto';
let musicMuted = false;

const MUSIC_MOODS = {
  calm: {
    voices: [{freq:110,gain:0.50,type:'sine',detune:-7},{freq:110,gain:0.50,type:'sine',detune:7},{freq:196,gain:0.32,type:'sine',detune:-7},{freq:196,gain:0.32,type:'sine',detune:7}],
    filterFreq: 800, lfoFreq: 0.05,
  },
  tension: {
    voices: [{freq:87,gain:0.55,type:'sawtooth',detune:-3},{freq:87,gain:0.55,type:'sawtooth',detune:3},{freq:123,gain:0.42,type:'triangle',detune:-5},{freq:123,gain:0.42,type:'triangle',detune:5}],
    filterFreq: 600, lfoFreq: 0.08,
  },
  pulse: {
    voices: [{freq:65,gain:0.65,type:'sine',detune:0},{freq:130,gain:0.45,type:'triangle',detune:-7},{freq:130,gain:0.45,type:'triangle',detune:7}],
    filterFreq: 700, lfoFreq: 0.03, tremoloHz: 1.2,
  },
  airy: {
    voices: [{freq:392,gain:0.42,type:'sine',detune:-5},{freq:392,gain:0.42,type:'sine',detune:5},{freq:523,gain:0.32,type:'sine',detune:-5},{freq:523,gain:0.32,type:'sine',detune:5}],
    filterFreq: 1800, lfoFreq: 0.04,
  },
  bright: {
    voices: [{freq:130,gain:0.50,type:'sine',detune:-7},{freq:130,gain:0.50,type:'sine',detune:7},{freq:165,gain:0.40,type:'sine',detune:-7},{freq:165,gain:0.40,type:'sine',detune:7},{freq:196,gain:0.30,type:'sine',detune:0}],
    filterFreq: 1100, lfoFreq: 0.05,
  },
};

function segmentToMood(seg) {
  if (!seg) return 'calm';
  const emotion = (seg.dominant_emotion || '').toLowerCase();
  const role = seg.narrative_role || 'setup';
  const mode = seg.particle?.mode || 'calm';
  if (/alarm|panic|fear|dread|terror|anger|rage/.test(emotion)) return 'tension';
  if (/joy|hope|elat|triumph|peace|relie|grateful/.test(emotion)) return 'bright';
  if (/grief|sad|melanchol|longing|wistful/.test(emotion)) return 'airy';
  if (mode === 'chaotic' || role === 'conflict') return 'tension';
  if (mode === 'pulsing' || role === 'build') return 'pulse';
  if (role === 'reflection') return 'airy';
  if (role === 'resolution' && mode !== 'chaotic') return 'bright';
  return 'calm';
}

let ambCtx = null;
let ambMaster = null;
let ambFilter = null;
let ambMoodGain = null;
let ambFilterLfo = null, ambFilterLfoDepth = null;
let ambVoices = [];
let ambTremoloLfo = null, ambTremoloGain = null;
let currentMood = null;

function ensureAmbient() {
  if (ambCtx) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  ambCtx = new Ctx();

  ambMaster = ambCtx.createGain();
  ambMaster.gain.value = 0;
  ambMaster.connect(ambCtx.destination);

  ambFilter = ambCtx.createBiquadFilter();
  ambFilter.type = 'lowpass';
  ambFilter.frequency.value = 800;
  ambFilter.Q.value = 0.7;
  ambFilter.connect(ambMaster);

  ambMoodGain = ambCtx.createGain();
  ambMoodGain.gain.value = 1;
  ambMoodGain.connect(ambFilter);

  ambFilterLfo = ambCtx.createOscillator();
  ambFilterLfo.type = 'sine';
  ambFilterLfo.frequency.value = 0.05;
  ambFilterLfoDepth = ambCtx.createGain();
  ambFilterLfoDepth.gain.value = 200;
  ambFilterLfo.connect(ambFilterLfoDepth);
  ambFilterLfoDepth.connect(ambFilter.frequency);
  ambFilterLfo.start();
}

function killVoices() {
  if (!ambCtx) return;
  const now = ambCtx.currentTime;
  for (const v of ambVoices) {
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setTargetAtTime(0, now, 0.5);
    try { v.osc.stop(now + 3); } catch {}
  }
  ambVoices = [];
  if (ambTremoloLfo) {
    try { ambTremoloLfo.stop(now + 3); } catch {}
    try { ambTremoloGain.disconnect(); } catch {}
    ambTremoloLfo = null;
    ambTremoloGain = null;
    if (ambMoodGain) {
      ambMoodGain.gain.cancelScheduledValues(now);
      // Use setTargetAtTime here too — proven, no edge cases.
      ambMoodGain.gain.setTargetAtTime(1, now, 0.3);
    }
  }
}

function effectiveMasterGain() {
  if (musicMuted) return 0;
  const trim = MOOD_GAIN_TRIM[currentMood] ?? 1.0;
  return Math.min(AMBIENT_VOLUME_CEILING, userVolumeFraction * AMBIENT_VOLUME_CEILING * trim);
}

// REVERTED to v6 mechanism: setTargetAtTime. Without LFO interference
// (now that tremolo is on moodGain), this is reliable AND responsive.
// The slider effect propagates within ~3*timeConstant which we keep small.
function applyMasterGain(fadeMs) {
  if (!ambMaster || !ambCtx) return;
  const now = ambCtx.currentTime;
  const target = effectiveMasterGain();
  const timeConstant = Math.max(0.05, (fadeMs || 800) / 1000 / 3);
  ambMaster.gain.cancelScheduledValues(now);
  ambMaster.gain.setTargetAtTime(target, now, timeConstant);
}

function setMood(mood, fadeMs) {
  if (!ambCtx) ensureAmbient();
  if (!ambCtx) return;
  if (mood === currentMood) return;
  const cfg = MUSIC_MOODS[mood] || MUSIC_MOODS.calm;
  const fade = (fadeMs || 4000) / 1000;
  const now = ambCtx.currentTime;

  killVoices();

  ambFilter.frequency.cancelScheduledValues(now);
  ambFilter.frequency.setTargetAtTime(cfg.filterFreq, now, fade / 3);
  if (ambFilterLfo) {
    ambFilterLfo.frequency.cancelScheduledValues(now);
    ambFilterLfo.frequency.setTargetAtTime(cfg.lfoFreq, now, fade / 3);
  }

  for (const v of cfg.voices) {
    const osc = ambCtx.createOscillator();
    osc.type = v.type;
    osc.frequency.value = v.freq;
    osc.detune.value = v.detune || 0;
    const g = ambCtx.createGain();
    g.gain.value = 0;
    osc.connect(g);
    g.connect(ambMoodGain);
    osc.start();
    g.gain.setTargetAtTime(v.gain, now, fade / 3);
    ambVoices.push({ osc, gain: g });
  }

  if (cfg.tremoloHz) {
    ambTremoloLfo = ambCtx.createOscillator();
    ambTremoloLfo.type = 'sine';
    ambTremoloLfo.frequency.value = cfg.tremoloHz;
    ambTremoloGain = ambCtx.createGain();
    ambTremoloGain.gain.value = 0.4;
    ambTremoloLfo.connect(ambTremoloGain);
    ambTremoloGain.connect(ambMoodGain.gain);
    ambTremoloLfo.start();
  }

  currentMood = mood;
  applyMasterGain(fade * 1000);
}

function startAmbient() {
  if (musicMuted) return;
  ensureAmbient();
  if (!ambCtx) return;
  // Resume the context. Ignore the returned promise: scheduled events on a
  // suspended context queue up and play once it resumes, so we don't need to
  // await this. But on Safari, sometimes resume() fails silently — so we
  // DO listen for the state change to surface it.
  if (ambCtx.state === 'suspended') {
    ambCtx.resume().catch(err => {
      console.warn('[livebook] AudioContext.resume failed:', err);
    });
  }
  if (!currentMood) {
    const initialMood = moodSelection === 'auto' ? 'calm' : moodSelection;
    setMood(initialMood, 100); // tiny fade so voices instantly start ramping
  }
  applyMasterGain(2500);
}
function stopAmbient() { applyMasterGainHard(0, 1500); }
function pauseAmbient() { if (musicMuted) return; applyMasterGainHard(0, 500); }
function resumeAmbient() { if (musicMuted) return; applyMasterGain(1200); }
function applyMasterGainHard(target, fadeMs) {
  if (!ambMaster || !ambCtx) return;
  const now = ambCtx.currentTime;
  ambMaster.gain.cancelScheduledValues(now);
  ambMaster.gain.setTargetAtTime(target, now, fadeMs / 1000 / 3);
}

function setMusicMuted(m) {
  musicMuted = m;
  const btn = document.getElementById('music-btn');
  btn.classList.toggle('muted', m);
  btn.querySelector('span:last-child').textContent = m ? 'Music off' : 'Music';
  applyMasterGain(400);
}

function loadPrefs() {
  try {
    const v = localStorage.getItem('penworth.livebook.volume');
    if (v !== null) userVolumeFraction = Math.max(0, Math.min(1, parseFloat(v)));
    const m = localStorage.getItem('penworth.livebook.mood');
    if (m && (m === 'auto' || MUSIC_MOODS[m])) moodSelection = m;
  } catch {}
}
function savePrefs() {
  try {
    localStorage.setItem('penworth.livebook.volume', String(userVolumeFraction));
    localStorage.setItem('penworth.livebook.mood', moodSelection);
  } catch {}
}

// ============================================================================
// CAPTIONS
// ============================================================================
function paginate(words) {
  if (!words.length) return [];
  const probe = document.createElement('div');
  probe.className = 'cap-layer'; probe.style.position='absolute'; probe.style.left='-9999px'; probe.style.top='0';
  probe.style.opacity='0'; probe.style.visibility='hidden';
  document.body.appendChild(probe);
  const realLayer = document.getElementById('cap-a');
  probe.style.width = realLayer.clientWidth + 'px';
  const lineHeight = parseFloat(getComputedStyle(probe).lineHeight);
  const pages = []; let cur = [], curHTML = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const trial = (curHTML ? curHTML + ' ' : '') + escapeHtml(w.word);
    probe.innerHTML = trial;
    const lines = Math.round(probe.offsetHeight / lineHeight);
    if (lines > 2 && cur.length > 0) {
      pages.push({ words: cur, start_s: cur[0].start_s, end_s: cur[cur.length - 1].end_s });
      cur = [w]; curHTML = escapeHtml(w.word);
    } else { cur.push(w); curHTML = trial; }
  }
  if (cur.length) pages.push({ words: cur, start_s: cur[0].start_s, end_s: cur[cur.length - 1].end_s });
  document.body.removeChild(probe);
  return pages;
}
function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function renderPageHtml(words) { return words.map((w, idx) => '<span class="word" data-i="' + idx + '">' + escapeHtml(w.word) + '</span>').join(' '); }
let capFront = 'cap-a';
function swapCaptionPage(pageWords) {
  const back = capFront === 'cap-a' ? 'cap-b' : 'cap-a';
  const backEl = document.getElementById(back);
  const frontEl = document.getElementById(capFront);
  backEl.innerHTML = renderPageHtml(pageWords);
  void backEl.offsetWidth;
  backEl.classList.add('visible');
  frontEl.classList.remove('visible');
  capFront = back;
  return backEl;
}
function clearCaptions() { document.getElementById('cap-a').classList.remove('visible'); document.getElementById('cap-b').classList.remove('visible'); }
function syncCaptionsToAudio(audio, pages) {
  return new Promise((resolve) => {
    if (!pages.length) { resolve(); return; }
    let pageIdx = -1, currentEl = null, lastActive = -1;
    const tick = () => {
      if (!playing) { resolve(); return; }
      if (paused) { requestAnimationFrame(tick); return; }
      const t = audio.currentTime;
      let newPageIdx = pageIdx;
      while (newPageIdx + 1 < pages.length && t >= pages[newPageIdx + 1].start_s) newPageIdx++;
      if (newPageIdx === -1) newPageIdx = 0;
      if (newPageIdx !== pageIdx) { pageIdx = newPageIdx; currentEl = swapCaptionPage(pages[pageIdx].words); lastActive = -1; }
      if (currentEl) {
        const page = pages[pageIdx];
        const wordEls = currentEl.querySelectorAll('.word');
        let active = -1;
        for (let i = 0; i < page.words.length; i++) {
          const w = page.words[i];
          if (t >= w.start_s && t < w.end_s) active = i;
          if (t >= w.end_s) wordEls[i]?.classList.add('spoken');
        }
        if (active !== lastActive) {
          if (lastActive >= 0) wordEls[lastActive]?.classList.remove('active');
          if (active >= 0) wordEls[active]?.classList.add('active');
          lastActive = active;
        }
      }
      if (audio.ended || (pageIdx === pages.length - 1 && t >= pages[pageIdx].end_s)) {
        if (currentEl) {
          const wordEls = currentEl.querySelectorAll('.word');
          for (const el of wordEls) el.classList.add('spoken');
          if (lastActive >= 0) wordEls[lastActive]?.classList.remove('active');
        }
        resolve(); return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// ============================================================================
// PLAYBACK
// ============================================================================
let engine = null;
let playing = false, paused = false, startedAt = 0, elapsedBeforePause = 0, currentSegmentId = null;
const NARR = document.getElementById('narration');
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
function findSegment(plan, id) { return plan?.segments?.find(s => s.id === id) || null; }
function findAssetForParagraph(assets, idx) { return (assets || []).find(a => a.paragraph_index === idx && a.image_url) || null; }
function applyAsset(asset, plan) { const stage=document.getElementById('image-stage'); const img=document.getElementById('scene-img'); if (!asset||!asset.image_url) {stage.classList.remove('visible','dominant','parallax'); return;} const planAsset=plan?.assets?.find(a=>a.asset_id===asset.asset_id); const dominant=planAsset?.visual_priority==='dominant'; const entry=planAsset?.behavior?.entry||'fade'; img.src=asset.image_url; img.onload=()=>{stage.classList.add('visible'); if (dominant) stage.classList.add('dominant'); if (entry==='parallax') stage.classList.add('parallax');}; }
function clearAsset() { document.getElementById('image-stage').classList.remove('visible', 'dominant', 'parallax'); }
function loadAndPlayParagraph(src) {
  return new Promise((resolve, reject) => {
    if (!src) return reject(new Error('no audio for paragraph'));
    let settled = false;
    const cleanup = () => { NARR.removeEventListener('error', onErr); NARR.removeEventListener('canplay', onCanPlay); clearTimeout(timer); };
    const onErr = () => { if (settled) return; settled = true; cleanup(); reject(new Error('audio element error code ' + (NARR.error?.code ?? '?'))); };
    const onCanPlay = () => { if (settled) return; NARR.play().then(() => { if (!settled) { settled = true; cleanup(); resolve(NARR); } }).catch(err => { if (!settled) { settled = true; cleanup(); reject(new Error('play() rejected: ' + (err?.message || err))); } }); };
    NARR.addEventListener('error', onErr, { once: true });
    NARR.addEventListener('canplay', onCanPlay, { once: true });
    const timer = setTimeout(() => { if (!settled) { settled = true; cleanup(); reject(new Error('audio load timeout (5s)')); } }, 5000);
    NARR.src = src; NARR.currentTime = 0;
    if (NARR.readyState >= 2) onCanPlay();
  });
}
async function run() {
  document.getElementById('intro').classList.add('hidden');
  document.getElementById('controls').classList.add('active');
  document.getElementById('progress-wrap').classList.add('active');
  document.getElementById('chap-line').classList.add('visible');
  startAmbient();
  playing = true; startedAt = Date.now();
  const totalDuration = MANIFEST.duration_sec || 1;
  const progressBar = document.getElementById('progress-bar');
  const elapsedEl = document.getElementById('elapsed');
  const progressInterval = setInterval(() => {
    if (!playing || paused) return;
    const elapsed = elapsedBeforePause + (Date.now() - startedAt) / 1000;
    progressBar.style.width = Math.min(100, (elapsed / totalDuration) * 100) + '%';
    elapsedEl.textContent = Math.floor(elapsed / 60) + ':' + String(Math.floor(elapsed % 60)).padStart(2, '0');
  }, 250);
  const paragraphs = MANIFEST.paragraphs || [];
  let firstFailureLogged = false;
  for (let i = 0; i < paragraphs.length; i++) {
    if (!playing) break;
    while (paused) await wait(100);
    const p = paragraphs[i];
    if (p.segment_id && p.segment_id !== currentSegmentId) {
      const seg = findSegment(MANIFEST.plan, p.segment_id);
      if (seg) {
        engine.setSegment(seg.particle);
        const badge = document.getElementById('segment-badge');
        badge.textContent = seg.dominant_emotion + ' · ' + seg.narrative_role;
        badge.classList.add('visible');
        if (moodSelection === 'auto') setMood(segmentToMood(seg), 4000);
      }
      currentSegmentId = p.segment_id;
    }
    const asset = findAssetForParagraph(MANIFEST.assets, i);
    if (asset) applyAsset(asset, MANIFEST.plan); else clearAsset();
    const pages = (p.word_timings && p.word_timings.length) ? paginate(p.word_timings) : [];
    try { await loadAndPlayParagraph(p.audio); }
    catch (e) { if (!firstFailureLogged) { showError('audio failed at paragraph ' + i + ': ' + e.message); firstFailureLogged = true; } continue; }
    await syncCaptionsToAudio(NARR, pages);
    await wait(p.gap_ms || 600);
  }
  clearCaptions(); clearAsset();
  document.getElementById('chap-line').classList.remove('visible');
  document.getElementById('segment-badge').classList.remove('visible');
  await wait(1800);
  document.getElementById('end-screen').classList.add('visible');
  document.getElementById('controls').classList.remove('active');
  document.getElementById('progress-wrap').classList.remove('active');
  playing = false; stopAmbient();
  clearInterval(progressInterval);
}

(async () => {
  try {
    loadPrefs();
    document.getElementById('intro-title').textContent = 'Loading…';
    MANIFEST = await loadManifest();
    if (!MANIFEST.paragraphs?.length) { document.getElementById('intro-title').textContent = 'No content available'; return; }
    document.getElementById('intro-title').textContent = MANIFEST.listing.title;
    const ledeText = (MANIFEST.plan?.livebook_experience?.description) || (MANIFEST.chapter.title + ' · directed for listening.');
    document.getElementById('intro-lede').textContent = ledeText;
    document.getElementById('intro-chapter').textContent = MANIFEST.chapter.title;
    const m = Math.floor((MANIFEST.duration_sec || 0) / 60), s = Math.floor((MANIFEST.duration_sec || 0) % 60);
    const dur = m + ':' + String(s).padStart(2, '0');
    document.getElementById('intro-duration').textContent = dur;
    document.getElementById('total-time').textContent = dur;
    document.getElementById('intro-voice').textContent = MANIFEST.voice?.name || '—';
    document.getElementById('chap-line').textContent = MANIFEST.listing.title + ' · ' + MANIFEST.chapter.title;
    if (MANIFEST.plan?.assets?.length) {
      const generated = (MANIFEST.assets || []).filter(a => a.image_url).length;
      const planned = MANIFEST.plan.assets.length;
      if (generated < planned) document.getElementById('intro-hint').textContent = 'Headphones recommended. ' + generated + '/' + planned + ' visual assets generated; rest will appear as particles.';
    }
    engine = new ParticleEngine(document.getElementById('particles'));
    const firstSeg = MANIFEST.plan?.segments?.[0];
    if (firstSeg) engine.setSegment(firstSeg.particle);

    const volSlider = document.getElementById('vol-slider');
    volSlider.value = String(Math.round(userVolumeFraction * 100));
    volSlider.addEventListener('input', (e) => {
      userVolumeFraction = Math.max(0, Math.min(1, parseInt(e.target.value, 10) / 100));
      savePrefs();
      applyMasterGain(250);
    });
    const moodSelect = document.getElementById('mood-select');
    moodSelect.value = moodSelection;
    moodSelect.addEventListener('change', (e) => {
      moodSelection = e.target.value;
      savePrefs();
      if (moodSelection === 'auto') {
        const seg = findSegment(MANIFEST.plan, currentSegmentId);
        if (seg) setMood(segmentToMood(seg), 2500);
      } else {
        setMood(moodSelection, 2500);
      }
    });

    const playBtn = document.getElementById('play-btn');
    playBtn.disabled = false; playBtn.textContent = 'Begin';
    playBtn.addEventListener('click', () => { if (playing) return; run().catch(e => showError('run failed: ' + e.message)); });
    document.getElementById('pause-btn').addEventListener('click', () => {
      if (paused) { paused = false; startedAt = Date.now(); NARR.play(); resumeAmbient(); document.getElementById('pause-btn').textContent = 'Pause'; }
      else { paused = true; elapsedBeforePause += (Date.now() - startedAt) / 1000; NARR.pause(); pauseAmbient(); document.getElementById('pause-btn').textContent = 'Resume'; }
    });
    document.getElementById('music-btn').addEventListener('click', () => setMusicMuted(!musicMuted));
    document.getElementById('restart-btn').addEventListener('click', () => {
      document.getElementById('end-screen').classList.remove('visible');
      elapsedBeforePause = 0; currentSegmentId = null;
      document.getElementById('progress-bar').style.width = '0';
      setTimeout(run, 400);
    });
  } catch (e) {
    document.getElementById('intro-title').textContent = 'Failed to load';
    document.getElementById('intro-lede').textContent = e.message;
    showError(e.message);
  }
})();
</script>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  if (req.headers.get("x-admin-secret") !== ADMIN_SECRET) return new Response("forbidden", { status: 403 });
  try {
    const { listing_id } = await req.json() as { listing_id?: string };
    if (!listing_id) return new Response(JSON.stringify({ error: "listing_id required" }), { status: 400 });
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: listing } = await supa.from("store_listings").select("id, listing_slug, livebook_asset_path, livebook_audio_source_path").eq("id", listing_id).maybeSingle();
    if (!listing) return new Response(JSON.stringify({ error: "listing not found" }), { status: 404 });
    const html = buildPlayerHtml(listing.listing_slug);
    const playerPath = `${listing_id}/player.html`;
    const { error: upErr } = await supa.storage.from("livebooks").upload(playerPath, html, {
      contentType: "text/html; charset=utf-8", upsert: true,
    });
    if (upErr) return new Response(JSON.stringify({ error: upErr.message }), { status: 500 });
    const audioSrc = listing.livebook_audio_source_path || listing.livebook_asset_path;
    await supa.from("store_listings").update({ livebook_asset_path: playerPath, livebook_audio_source_path: audioSrc }).eq("id", listing_id);
    return new Response(JSON.stringify({ ok: true, player_path: playerPath, audio_source_path: audioSrc, bytes: html.length }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
});
