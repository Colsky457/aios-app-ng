/* RB Agentic OS — center-stage globe: wireframe sphere + colour particle cluster (decorative canvas) */
"use strict";
(() => {
  const cv = document.getElementById("globe");
  if (!cv || !cv.getContext) return;
  const ctx = cv.getContext("2d");
  const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = 0, H = 0, DPR = 1;
  const resize = () => {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.max(1, Math.round(W * DPR));
    cv.height = Math.max(1, Math.round(H * DPR));
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  };
  resize();
  addEventListener("resize", resize);

  // --- wireframe sphere: points on a globe, rotating ---
  const LAT = 12, LON = 24;
  const spherePts = [];
  for (let i = 1; i < LAT; i++) {
    const phi = (Math.PI * i) / LAT;
    for (let j = 0; j < LON; j++) {
      const theta = (2 * Math.PI * j) / LON;
      spherePts.push([
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      ]);
    }
  }

  // --- colour cluster: dense multicolour particles near the core (reference look) ---
  // Using AIOS App NG theme colors
  const PALETTE = [
    "#f97316", // --accent
    "#ff9d4d", // --accent-soft / --st-busy
    "#34d399", // --st-idle / --st-ok
    "#60a5fa", // --st-input
    "#fbbf24", // --st-warn
    "#f87171", // --st-error
    "#ffffff"  // white for highlights
  ];
  const N = 420;
  const cluster = [];
  for (let i = 0; i < N; i++) {
    // gaussian-ish radial falloff
    const r = Math.pow(Math.random(), 1.7);
    const a = Math.random() * Math.PI * 2;
    const z = (Math.random() * 2 - 1);
    cluster.push({
      x: Math.cos(a) * r,
      y: Math.sin(a) * r * 0.85,
      z,
      s: 0.7 + Math.random() * 1.9,
      c: PALETTE[(Math.random() * PALETTE.length) | 0],
      ph: Math.random() * Math.PI * 2,
      sp: 0.4 + Math.random() * 1.2,
    });
  }

  // faint connective network lines among random sphere points
  const netIdx = [];
  for (let i = 0; i < 46; i++) netIdx.push((Math.random() * spherePts.length) | 0);
  const netPairs = [];
  for (let i = 0; i < netIdx.length; i++) {
    for (let k = i + 1; k < netIdx.length; k++) {
      const a = spherePts[netIdx[i]], b = spherePts[netIdx[k]];
      const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
      if (d < 0.55) netPairs.push([netIdx[i], netIdx[k]]);
    }
  }

  let t = 0;
  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H * 0.54;
    const R = Math.min(W, H) * 0.40;
    const rot = t * 0.0016;

    // network lines
    ctx.lineWidth = 1;
    netPairs.forEach(([i, k]) => {
      const a = spherePts[i], b = spherePts[k];
      const ax = a[0] * Math.cos(rot) - a[2] * Math.sin(rot);
      const bx = b[0] * Math.cos(rot) - b[2] * Math.sin(rot);
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.beginPath();
      ctx.moveTo(cx + ax * R, cy + a[1] * R);
      ctx.lineTo(cx + bx * R, cy + b[1] * R);
      ctx.stroke();
    });

    // sphere points
    spherePts.forEach((p) => {
      const x = p[0] * Math.cos(rot) - p[2] * Math.sin(rot);
      const z = p[0] * Math.sin(rot) + p[2] * Math.cos(rot);
      const depth = (z + 1) / 2;
      ctx.fillStyle = `rgba(255,255,255,${0.05 + depth * 0.16})`;
      ctx.beginPath();
      ctx.arc(cx + x * R, cy + p[1] * R, 1 + depth * 1.1, 0, Math.PI * 2);
      ctx.fill();
    });

    // colour cluster (slow drift + twinkle)
    const K = R * 0.46;
    cluster.forEach((p) => {
      const wob = REDUCE ? 0 : Math.sin(t * 0.002 * p.sp + p.ph) * 0.045;
      const px = cx + (p.x + wob) * K;
      const py = cy + (p.y + wob * 0.7) * K;
      const tw = REDUCE ? 0.85 : 0.62 + 0.38 * Math.sin(t * 0.004 * p.sp + p.ph);
      ctx.globalAlpha = Math.max(0.25, tw);
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.arc(px, py, p.s, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    t += 16;
    if (!REDUCE) requestAnimationFrame(draw);
  };
  draw();
})();