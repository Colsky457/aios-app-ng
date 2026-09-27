/* Memory-map view. One canvas, six toggle views of the SAME nodes.
   Everything a tuner touches lives in the MAP block at the top. */
const MAP = {
  NODE_CAP: 1200,
  LINK_CAP: 6000,
  RING_GAP: 24,
  RING_INSET: 40,
  ORBIT_SPEED: 0.18,
  ORBIT_TILT: 22,
  ORBIT_RADIUS: 0.92,
  DRAG_GAIN: 1.0,
  ZOOM_MIN: 0.25,
  ZOOM_MAX: 4,
  FLY_MS: 700,
  SEARCH_DEBOUNCE: 120,
  LABEL_FADE_MS: 220,
  HOVER_DIM: 0.18,
  CARD_MAX: 320,
};
const KINDS = ['root','area','project','skill','memory','note','routine','run','app'];
const LAYERS = ['core','memory','skills','routines','apps','runs'];
const VIEWS = ['rings','circle','areas','links','timeline','3d-orbit'];
const AREA_COLORS = ['#f97316','#38bdf0','#a78bfa','#34d399','#fbbf24','#fb7185','#60a5fa','#22d3ee','#f472b6','#a3e635','#94a3b8','#7c3aed'];
const KIND_SHAPE = { root:'cross', area:'hex', project:'tri', skill:'rect', memory:'diamond', note:'dot', routine:'ring', run:'bar', app:'gear' };

/* ---- state ---- */
let M = { nodes:[], links:[], view:'rings', names:false, motion:true, fit:true, full:false,
  selArea:null, selKind:null, q:'', hover:null, cam:{x:0,y:0,z:1}, orbit:0, dirty:true };
let svg, g, defs, areaIdx, kindIdx, linkCount;
let lastT = 0, rafId = 0;
let zoomBehavior = null, dragBehavior = null;

/* ---- helpers ---- */
const $ = (id) => document.getElementById(id);
const areaColor = (a) => (AREA_COLORS[(areaIdx.get(a) || 0) % AREA_COLORS.length]);
const linkDeg = (n) => (linkCount.get(n.id) || 0);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const esc = (s) => (s == null ? '' : String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])));

/* ---- shape renderers (canvas path API, not SVG glyphs) ---- */
const SHAPE_PATH = {
  cross: (s, r) => `M${s-r} ${s} L${s+r} ${s} M${s} ${s-r} L${s} ${s+r}`,
  dot:   (s, r) => `M${s-r} ${s} a${r} ${r} 0 1 0 ${r*0.001} ${r*0.001} Z`,
  ring:  (s, r) => `M${s-r} ${s} a${r} ${r} 0 1 0 ${r*0.001} ${r*0.001} Z M${s-r*0.55} ${s} a${r*0.55} ${r*0.55} 0 1 0 ${r*0.00055} ${r*0.00055} Z`,
  tri:   (s, r) => `M${s} ${s-r} L${s+r*0.95} ${s+r*0.7} L${s-r*0.95} ${s+r*0.7} Z`,
  rect:  (s, r) => `M${s-r*0.75} ${s-r*0.75} H${s+r*0.75} V${s+r*0.75} H${s-r*0.75} Z`,
  hex:   (s, r) => { const h=r*0.866; return `M${s} ${s-r} L${s+h} ${s-r*0.5} L${s+h} ${s+r*0.5} L${s} ${s+r} L${s-h} ${s+r*0.5} L${s-h} ${s-r*0.5} Z`; },
  diamond:(s, r) => `M${s} ${s-r} L${s+r} ${s} L${s} ${s+r} L${s-r} ${s} Z`,
  bar:   (s, r) => `M${s-r*0.5} ${s-r} H${s+r*0.5} V${s+r} H${s-r*0.5} Z`,
  gear:  (s, r) => { let p=''; const teeth=7; for (let i=0;i<teeth;i++){const a=(i/teeth)*Math.PI*2; const a2=a+Math.PI/teeth; const o1=Math.cos(a)*r, o2=Math.sin(a)*r, i1=Math.cos(a2)*(r*0.62), i2=Math.sin(a2)*(r*0.62); p+=`M${s+o1} ${s+o2} L${s+i1} ${s+i2} `;} return p+'Z'; },
};
const shapePath = (kind, s, r) => (SHAPE_PATH[KIND_SHAPE[kind] || 'dot'] || SHAPE_PATH.dot)(s, r);

/* ---- data: fetch the graph from the shell ---- */
async function loadMapData() {
  try {
    const d = await window.glassShell.memoryMap();
    if (!d || !d.nodes) return;
    const nodes = d.nodes.slice(0, MAP.NODE_CAP);
    const linkSet = new Set();
    const links = [];
    for (const l of (d.links || [])) {
      const k = l.s + '|' + l.t;
      if (linkSet.has(k)) continue;
      linkSet.add(k); links.push(l);
      if (links.length >= MAP.LINK_CAP) break;
    }
    M.nodes = nodes; M.links = links;
    indexNodes();
    M.dirty = true; schedule();
  } catch (e) { console.warn('[map] memoryMap failed', e); }
}
function indexNodes() {
  areaIdx = new Map(); kindIdx = new Map(); linkCount = new Map();
  let ai=0, ki=0;
  for (const n of M.nodes) {
    if (!areaIdx.has(n.area)) areaIdx.set(n.area, ai++);
    if (!kindIdx.has(n.kind)) kindIdx.set(n.kind, ki++);
    linkCount.set(n.id, 0);
  }
  for (const l of M.links) { linkCount.set(l.s, (linkCount.get(l.s)||0)+1); linkCount.set(l.t, (linkCount.get(l.t)||0)+1); }
}

/* ---- canvas setup ---- */
function ensureCanvas() {
  if (svg) return;
  const host = $('map-host');
  if (!host) return;
  svg = d3.select(host).append('svg').attr('class','map-canvas');
  g = svg.append('g');
  defs = svg.append('defs');
  // soft glow for the ring views
  const f = defs.append('filter').attr('id','map-glow').attr('x','-50%').attr('y','-50%').attr('width','200%').attr('height','200%');
  f.append('feGaussianBlur').attr('stdDeviation','2.4').attr('result','b');
  f.append('feMerge').selectAll('feMergeNode').data([0,1]).enter().append('feMergeNode').attr('in','b');
  const ln = defs.append('linearGradient').attr('id','map-link').attr('x1','0').attr('y1','0').attr('x2','1').attr('y2','0');
  ln.append('stop').attr('offset','0%').attr('stop-color','#38bdf0').attr('stop-opacity','0.5');
  ln.append('stop').attr('offset','100%').attr('stop-color','#f97316').attr('stop-opacity','0.5');
  const bg = defs.append('radialGradient').attr('id','map-bg');
  bg.append('stop').attr('offset','0%').attr('stop-color','#0c0c0f');
  bg.append('stop').attr('offset','100%').attr('stop-color','#050506');
  svg.append('rect').attr('class','map-bg-rect').attr('width','100%').attr('height','100%').attr('fill','url(#map-bg)');

  zoomBehavior = d3.zoom().scaleExtent([MAP.ZOOM_MIN, MAP.ZOOM_MAX]).on('zoom', (ev) => { M.cam = ev.transform; M.dirty = true; });
  dragBehavior = d3.drag().on('start', dragStart).on('drag', dragDrag).on('end', dragEnd);
  svg.call(zoomBehavior);
  svg.call(dragBehavior);
  svg.on('dblclick.zoom', null);
  svg.on('wheel', (ev) => { ev.preventDefault(); });
  window.addEventListener('resize', resize);
  resize();
}
let dragStartAt, dragCamAt;
function dragStart(ev) { dragStartAt = { x: ev.x, y: ev.y }; dragCamAt = { x: M.cam.x, y: M.cam.y }; }
function dragDrag(ev) { M.cam.x = dragCamAt.x + (ev.x - dragStartAt.x) * MAP.DRAG_GAIN; M.cam.y = dragCamAt.y + (ev.y - dragStartAt.y) * MAP.DRAG_GAIN; M.dirty = true; }
function dragEnd() { /* keep */ }
function resize() {
  if (!svg) return;
  const r = $('map-host').getBoundingClientRect();
  svg.attr('width', r.width).attr('height', r.height);
  M.dirty = true;
}
function fitView() {
  if (!svg) return;
  const r = $('map-host').getBoundingClientRect();
  const cx = r.width/2, cy = r.height/2;
  const t = d3.zoomIdentity.translate(cx, cy).scale(1);
  svg.call(zoomBehavior.transform, t);
  M.cam = t; M.dirty = true;
}

/* ---- layout: one function per view returns {x,y} per node ---- */
function layoutRings() {
  const byLayer = new Map();
  for (const l of LAYERS) byLayer.set(l, []);
  for (const n of M.nodes) { const arr = byLayer.get(n.layer); if (arr) arr.push(n); }
  const cx = 0, cy = 0;
  let r = MAP.RING_INSET;
  for (const l of LAYERS) {
    const arr = byLayer.get(l) || [];
    if (!arr.length) continue;
    const n = arr.length;
    for (let i=0;i<n;i++){
      const a = (i/n)*Math.PI*2;
      const node = arr[i];
      node._x = cx + Math.cos(a)*r; node._y = cy + Math.sin(a)*r;
    }
    r += MAP.RING_GAP;
  }
}
function layoutCircle() {
  const n = M.nodes.length, cx=0, cy=0, r = 220;
  for (let i=0;i<n;i++){
    const a = (i/n)*Math.PI*2;
    M.nodes[i]._x = cx + Math.cos(a)*r; M.nodes[i]._y = cy + Math.sin(a)*r;
  }
}
function layoutAreas() {
  const groups = new Map();
  for (const n of M.nodes) { if (!groups.has(n.area)) groups.set(n.area, []); groups.get(n.area).push(n); }
  const arr = [...groups.values()];
  const cx=0, cy=0, rad = 200;
  let a0 = 0;
  for (const g of arr) {
    const span = (g.length / M.nodes.length) * Math.PI*2;
    for (let i=0;i<g.length;i++){
      const a = a0 + (i/g.length)*span;
      g[i]._x = cx + Math.cos(a)*rad; g[i]._y = cy + Math.sin(a)*rad;
    }
    a0 += span;
  }
}
function layoutLinks() {
  // d3 force on a copy; stable across frames
  const nodes = M.nodes.map(n => ({ id:n.id, _x:n._x||0, _y:n._y||0, _area:areaIdx.get(n.area)||0, _links:linkCount.get(n.id)||0 }));
  const links = M.links.map(l => ({ source:l.s, target:l.t }));
  const sim = d3.forceSimulation(nodes).force('link', d3.forceLink(links).id(d=>d.id).distance(26).strength(0.18))
    .force('charge', d3.forceManyBody().strength(-70))
    .force('center', d3.forceCenter())
    .force('collide', d3.forceCollide().radius(d=>nodeR(d._links)+4))
    .force('x', d3.forceX().x(d=>d._area*8))
    .stop();
  sim.tick(120);
  for (let i=0;i<nodes.length;i++){ M.nodes[i]._x = nodes[i]._x; M.nodes[i]._y = nodes[i]._y; }
}
function layoutTimeline() {
  // top half: routine runs by day (bucket by day index); bottom: files by last change
  const byDay = new Map();
  for (const n of M.nodes) {
    if (n.kind !== 'routine') continue;
    const d = n.changed || 0;
    const k = Math.floor(d / 86400000);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(n);
  }
  const days = [...byDay.keys()].sort((a,b)=>a-b);
  const cx=0, cy=-60, w=140;
  for (let i=0;i<days.length;i++){
    const arr = byDay.get(days[i]);
    for (let j=0;j<arr.length;j++){
      arr[j]._x = cx + (i+1)*w; arr[j]._y = cy + j*10;
    }
  }
  const files = M.nodes.filter(n=>n.kind!=='routine').sort((a,b)=>(b.changed||0)-(a.changed||0));
  const step = 100;
  for (let i=0;i<files.length;i++){
    files[i]._x = (i % 20) * step; files[i]._y = 60 + Math.floor(i/20)*step;
  }
}
function layoutOrbit() {
  const n = M.nodes.length, cx=0, cy=0, rad = 0;
  for (let i=0;i<n;i++){
    const a = (i/n)*Math.PI*2;
    M.nodes[i]._x = cx + Math.cos(a)*rad; M.nodes[i]._y = cy + Math.sin(a)*rad;
  }
}
function applyLayout() {
  switch (M.view) {
    case 'rings': layoutRings(); break;
    case 'circle': layoutCircle(); break;
    case 'areas': layoutAreas(); break;
    case 'links': layoutLinks(); break;
    case 'timeline': layoutTimeline(); break;
    case '3d-orbit': layoutOrbit(); break;
  }
}

/* ---- render: draw nodes + links into the <g> ---- */
function nodeR(links) { return clamp(4 + Math.sqrt(links) * 1.6, 4, 22); }
function nodeVisible(n) {
  if (M.selArea && n.area !== M.selArea) return false;
  if (M.selKind && n.kind !== M.selKind) return false;
  if (M.q) {
    const s = (n.label + ' ' + n.path + ' ' + (n.note||'')).toLowerCase();
    if (!s.includes(M.q)) return false;
  }
  return true;
}
function neighbourOf(id) {
  const out = new Set([id]);
  for (const l of M.links) { if (l.s===id) out.add(l.t); else if (l.t===id) out.add(l.s); }
  return out;
}
function render() {
  if (!g) return;
  applyLayout();
  const visible = M.nodes.filter(nodeVisible);
  const visSet = new Set(visible.map(n=>n.id));
  const links = M.links.filter(l => visSet.has(l.s) && visSet.has(l.t));
  const cx = 0, cy = 0;
  const hoverN = M.hover ? neighbourOf(M.hover) : null;

  g.selectAll('.map-node').data(visible, d=>d.id).join(
    enter => enter.append('g').attr('class','map-node').attr('opacity',0)
      .call(enter => {
        const gg = enter.append('g').attr('class','map-shape');
        gg.append('path').attr('class','map-node-stroke');
        gg.append('text').attr('class','map-node-label');
      }),
    update => update
  ).attr('transform', d => {
    let x = d._x, y = d._y;
    if (M.view === '3d-orbit') { const t = Math.tan(M.ORBIT_TILT*Math.PI/180); y *= t; }
    return `translate(${x},${y}) scale(${M.cam.z}) translate(${-M.cam.x},${-M.cam.y})`;
  }).attr('opacity', d => (hoverN && !hoverN.has(d.id)) ? M.HOVER_DIM : 1)
    .select('.map-node-stroke')
    .attr('d', d => shapePath(d.kind, 0, nodeR(linkCount.get(d.id)||0)))
    .attr('fill', d => areaColor(d.area))
    .attr('stroke', d => d.id === M.hover ? '#fff' : 'rgba(255,255,255,0.25)')
    .attr('stroke-width', d => d.id === M.hover ? 2.2 : 1)
    .attr('filter', d => d.id === M.hover ? 'url(#map-glow)' : null);
  g.selectAll('.map-node').select('.map-node-label')
    .text(d => M.names ? d.label : '')
    .attr('text-anchor','middle').attr('dominant-baseline','central')
    .attr('fill','#cfcfd6').attr('font-size', d => clamp(9 + Math.sqrt(linkCount.get(d.id)||0)*0.5, 9, 14))
    .attr('opacity', d => M.names ? 1 : 0);

  g.selectAll('.map-link').data(links, d=>d.s+'|'+d.t).join(
    enter => enter.append('line').attr('class','map-link').attr('stroke','url(#map-link)').attr('stroke-width',0.6).attr('opacity',0.5),
    update => update
  ).attr('x1', d => M.nodes.find(n=>n.id===d.s)?._x||0)
   .attr('y1', d => M.nodes.find(n=>n.id===d.s)?._y||0)
   .attr('x2', d => M.nodes.find(n=>n.id===d.t)?._x||0)
   .attr('y2', d => M.nodes.find(n=>n.id===d.t)?._y||0)
   .attr('opacity', d => (hoverN && !hoverN.has(d.s) && !hoverN.has(d.t)) ? M.HOVER_DIM : 0.5);
}

/* ---- animation loop (60fps budget: only the cheap transforms re-run) ---- */
function frame(t) {
  if (!lastT) lastT = t;
  const dt = (t - lastT) / 1000; lastT = t;
  if (M.motion && M.view === '3d-orbit') {
    M.orbit += MAP.ORBIT_SPEED * dt * 60;
    if (M.orbit > 360) M.orbit -= 360;
    M.dirty = true;
  }
  if (M.dirty) { render(); M.dirty = false; }
  rafId = requestAnimationFrame(frame);
}

/* ---- hover / click ---- */
function nodeAt(ev) {
  let pt = svg.node().createSVGPoint();
  pt.x = ev.clientX; pt.y = ev.clientY;
  const m = svg.node().getScreenCTM();
  if (m) pt = pt.matrixTransform(m.inverse());
  const z = M.cam.z, cx = M.cam.x, cy = M.cam.y;
  for (const n of M.nodes) {
    if (!nodeVisible(n)) continue;
    let x = n._x, y = n._y;
    if (M.view === '3d-orbit') y *= Math.tan(M.ORBIT_TILT*Math.PI/180);
    const dx = (x - cx) * z - pt.x, dy = (y - cy) * z - pt.y;
    if (dx*dx + dy*dy <= nodeR(linkCount.get(n.id)||0) * nodeR(linkCount.get(n.id)||0) * z*z) return n;
  }
  return null;
}
function onMove(ev) {
  const n = nodeAt(ev);
  if (n !== M.hover) { M.hover = n ? n.id : null; M.dirty = true; svg.node().style.cursor = n ? 'pointer' : 'grab'; }
}
function onClick(ev) {
  const n = nodeAt(ev);
  if (n) openCard(n);
}
function flyTo(n) {
  if (!svg) return;
  let x = n._x || 0, y = n._y || 0;
  if (M.view === '3d-orbit') y *= Math.tan(M.ORBIT_TILT*Math.PI/180);
  const r = $('map-host').getBoundingClientRect();
  const tx = r.width/2 - x, ty = r.height/2 - y;
  const t0 = M.cam, t1 = d3.zoomIdentity.translate(tx, ty).scale(clamp(M.cam.z, MAP.ZOOM_MIN, MAP.ZOOM_MAX));
  const t0z = t0.z;
  d3.activeTimeout && clearTimeout(d3.activeTimeout);
  const start = performance.now();
  function step() {
    const p = clamp((performance.now()-start)/MAP.FLY_MS, 0, 1);
    const e = p<0.5?2*p*p:1-Math.pow(-2*p+2,2)/2;
    const z = t0z + (t1.z - t0z)*e;
    svg.call(zoomBehavior.transform, d3.zoomIdentity.translate(tx + (t0.x-tx)*(1-e), ty + (t0.y-ty)*(1-e)).scale(z));
    if (p < 1) d3.activeTimeout = setTimeout(step, 16); else { M.cam = d3.zoomIdentity.translate(tx,ty).scale(t1.z); M.dirty = true; }
  }
  step();
}

/* ---- click card ---- */
function openCard(n) {
  let card = $('map-card');
  if (!card) { card = document.createElement('div'); card.id = 'map-card'; document.body.appendChild(card); }
  card.innerHTML = `
    <div class="mc-head"><span class="mc-kind">${esc(n.kind)}</span><span class="mc-area">${esc(n.area)}</span></div>
    <div class="mc-label">${esc(n.label)}</div>
    <div class="mc-note">${esc(n.note||'')}</div>
    <div class="mc-path mono">${esc(n.path)}</div>
    <div class="mc-row">
      <button class="mc-btn" data-act="open">open</button>
      <button class="mc-btn" data-act="copy">copy path</button>
      <button class="mc-btn" data-act="fly">fly to</button>
      <button class="mc-btn" data-act="close">close</button>
    </div>`;
  card.style.display = 'block';
  card.querySelectorAll('.mc-btn').forEach(b => b.onclick = () => {
    const a = b.dataset.act;
    if (a === 'close') { card.style.display='none'; }
    else if (a === 'fly') { flyTo(n); card.style.display='none'; }
    else if (a === 'copy') { window.glassShell.copyText(n.path).then(ok=>{}); card.style.display='none'; }
    else if (a === 'open') { card.style.display='none'; void window.glassShell.openPathExternal(n.path); }
  });
}

/* ---- toggles / search / legend ---- */
let schedT = 0;
function schedule() { if (schedT) return; schedT = setTimeout(() => { schedT = 0; M.dirty = true; }, MAP.SEARCH_DEBOUNCE); }
function setView(v) { M.view = v; M.dirty = true; syncToggles(); }
function toggleNames() { M.names = !M.names; M.dirty = true; syncToggles(); }
function toggleMotion() { M.motion = !M.motion; syncToggles(); }
function toggleFit() { M.fit = !M.fit; if (M.fit) fitView(); syncToggles(); }
function toggleFull() {
  M.full = !M.full;
  const host = $('map-host'), wrap = $('map-wrap');
  if (M.full) { host.classList.add('map-full'); if (wrap) wrap.style.display='none'; }
  else { host.classList.remove('map-full'); if (wrap) wrap.style.display=''; }
  resize(); syncToggles();
}
function syncToggles() {
  const btns = document.querySelectorAll('.map-toggle');
  btns.forEach(b => b.classList.toggle('on', b.dataset.act === 'view' ? M.view === b.dataset.val :
    b.dataset.act === 'names' ? M.names :
    b.dataset.act === 'motion' ? M.motion :
    b.dataset.act === 'fit' ? M.fit :
    b.dataset.act === 'full' ? M.full : false));
}
function doSearch(q) {
  M.q = q ? q.trim().toLowerCase() : '';
  M.dirty = true;
  const host = $('map-host');
  if (!M.q) return;
  const first = M.nodes.find(n => nodeVisible(n));
  if (first) flyTo(first);
}
function isolateArea(a) { M.selArea = (M.selArea === a) ? null : a; renderLegend(); M.dirty = true; }
function isolateKind(k) { M.selKind = (M.selKind === k) ? null : k; renderLegend(); M.dirty = true; }
function renderLegend() {
  const box = $('map-legend'); if (!box) return;
  if (!areaIdx || !kindIdx) return;
  let h = '<div class="ml-title">areas</div>';
  for (const [a,i] of areaIdx) h += `<div class="ml-item" data-a="${esc(a)}"><span class="ml-dot" style="background:${AREA_COLORS[i%AREA_COLORS.length]}"></span>${esc(a)}</div>`;
  h += '<div class="ml-title">kinds</div>';
  for (const [k,i] of kindIdx) h += `<div class="ml-item" data-k="${esc(k)}"><span class="ml-shape" data-shape="${KIND_SHAPE[k]||'dot'}"></span>${esc(k)}</div>`;
  box.innerHTML = h;
  box.querySelectorAll('.ml-item').forEach(it => {
    it.onclick = () => { if (it.dataset.a !== undefined) isolateArea(it.dataset.a); else isolateKind(it.dataset.k); };
  });
}

/* ---- boot ---- */
function bootMap() {
  if (window.__mapBooted) return;
  window.__mapBooted = true;
  ensureCanvas();
  if (!svg) return;
  svg.on('mousemove', onMove).on('click', onClick).on('mouseleave', () => { if (M.hover) { M.hover = null; M.dirty = true; } });
  // wire the controls in the card
  document.querySelectorAll('.map-toggle').forEach(b => {
    const act = b.dataset.act;
    const fn = act === 'view' ? () => setView(b.dataset.val)
      : act === 'names' ? toggleNames
      : act === 'motion' ? toggleMotion
      : act === 'fit' ? toggleFit
      : act === 'full' ? toggleFull : null;
    if (fn) b.addEventListener('click', fn);
  });
  const search = $('map-search');
  if (search) {
    let st = 0;
    search.addEventListener('input', () => { clearTimeout(st); st = setTimeout(() => doSearch(search.value), MAP.SEARCH_DEBOUNCE); });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(st); doSearch(search.value); } });
  }
  // Legend + toggle state depend on indexNodes(), which loadMapData() runs.
  // Build them after the data lands — rendering before would iterate an empty areaIdx.
  loadMapData().then(() => { renderLegend(); syncToggles(); });
  rafId = requestAnimationFrame(frame);
}
window.addEventListener('d3:ready', () => { if (typeof d3 !== 'undefined' && typeof d3.select === 'function') bootMap(); });
// do NOT boot immediately: `window.d3` exists the moment the shim runs, but the
// modules are still loading, so an early boot would call d3.select on an empty
// object and then never re-boot (guarded by __mapBooted).
