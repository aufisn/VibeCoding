const SIZE = 280;
const c = document.getElementById('c');
const x = c.getContext('2d');           // visible drawing, in the chosen color
const ink = document.createElement('canvas');
ink.width = ink.height = SIZE;
const k = ink.getContext('2d');         // hidden copy in black: this is what gets recognized,
                                        // so pale colors don't hurt accuracy
const $ = id => document.getElementById(id);
let mode = 'digits', drawn = false, down = false, timer, seq = 0;
let color = '#000000', width = 18;

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, v) { try { localStorage.setItem(key, v); } catch { /* storage unavailable */ } },
};

for (const ctx of [x, k]) { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; }
k.strokeStyle = '#000';

// ---------- pen cursor ----------
function penCursor(col) {
  // Pencil pointing to the bottom-left; the hotspot (2,30) is the tip.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <path d="M22 3l7 7-17 17-9 2 2-9z" fill="#fff" stroke="#18181b" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M22 3l7 7-3 3-7-7z" fill="#a1a1aa" stroke="#18181b" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M5 20l7 7-9 2z" fill="${col}" stroke="#18181b" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`;
  c.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 30, crosshair`;
}

// ---------- color & tip controls ----------
function setColor(col, save = true) {
  color = col;
  x.strokeStyle = col;
  $('dot').style.background = col;
  document.querySelectorAll('.sw').forEach(b => b.classList.toggle('on', b.dataset.c === col));
  $('custom').parentElement.classList.toggle('on', !document.querySelector(`.sw[data-c="${col}"]`));
  penCursor(col);
  if (save) store.set('penColor', col);
}

function setWidth(w, save = true) {
  width = w;
  x.lineWidth = k.lineWidth = w;
  $('size').value = w;
  $('sizeVal').textContent = w + 'px';
  $('dot').style.width = $('dot').style.height = w + 'px';
  if (save) store.set('penWidth', w);
}

document.querySelectorAll('.sw').forEach(b => b.onclick = () => setColor(b.dataset.c));
$('custom').oninput = e => setColor(e.target.value);
$('size').oninput = e => setWidth(Number(e.target.value));

// ---------- drawing ----------
function clear() {
  x.fillStyle = k.fillStyle = '#fff';
  x.fillRect(0, 0, SIZE, SIZE); k.fillRect(0, 0, SIZE, SIZE);
  drawn = false; seq++;
  $('guess').textContent = '?'; $('kind').textContent = ''; $('bars').innerHTML = ''; $('err').textContent = '';
}

const pos = e => {
  const r = c.getBoundingClientRect();
  return [(e.clientX - r.left) * SIZE / r.width, (e.clientY - r.top) * SIZE / r.height];
};
const both = fn => { fn(x); fn(k); };

c.onpointerdown = e => {
  down = drawn = true; c.setPointerCapture(e.pointerId);
  const p = pos(e);
  both(ctx => { ctx.beginPath(); ctx.moveTo(...p); ctx.lineTo(...p); ctx.stroke(); });
};
c.onpointermove = e => {
  if (!down) return;
  const p = pos(e);
  both(ctx => { ctx.lineTo(...p); ctx.stroke(); });
  clearTimeout(timer); timer = setTimeout(send, 120);
};
c.onpointerup = c.onpointercancel = () => { if (down) { down = false; send(); } };

// ---------- prediction ----------
const kind = ch => /[0-9]/.test(ch) ? 'digit' : ch === ch.toUpperCase() ? 'CAPITAL letter' : 'small letter';

async function send() {
  if (!drawn) return;
  const id = ++seq;
  let d;
  try {
    const r = await fetch('/predict?mode=' + mode, { method: 'POST', body: ink.toDataURL('image/png') });
    d = await r.json();
  } catch {
    d = { error: 'Server not reachable' };
  }
  if (id !== seq) return; // a newer request or a Clear happened meanwhile
  if (d.error) { $('err').textContent = d.error; return; }
  $('err').textContent = '';
  const top = d.top;
  $('guess').textContent = top[0][0];
  $('kind').textContent = kind(top[0][0]);
  $('bars').innerHTML = top.map(([ch, p]) =>
    `<div class="bar"><b>${ch}</b><div style="width:${p * 140}px"></div>${(p * 100).toFixed(1)}%</div>`).join('');
}

document.querySelectorAll('.modes button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.modes button').forEach(o => o.classList.toggle('on', o === b));
  mode = b.dataset.m; send();
});
$('clear').onclick = clear;

// ---------- start ----------
const savedColor = store.get('penColor');
const savedWidth = Number(store.get('penWidth'));
if (savedColor && /^#[0-9a-f]{6}$/i.test(savedColor)) {
  if (!document.querySelector(`.sw[data-c="${savedColor}"]`)) $('custom').value = savedColor;
  setColor(savedColor, false);
} else {
  setColor('#000000', false);
}
setWidth(savedWidth >= 6 && savedWidth <= 36 ? savedWidth : 18, false);
clear();
