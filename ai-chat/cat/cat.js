// The blue cat lives on a strip of the page (its "stage") and acts there: sits, grooms, peeks over the edge,
// strolls, stalks, rolls on a big globe, flies a paper plane, leaps and stretches. Drawn in side view like the
// owner's references: flat blue body on rubber-hose legs, a front-facing head, round white eyes, a hooked tail.
// Motion rules from rossark0/rossark-motion-skill (read on GitHub, not installed): anticipation before every jump,
// 15-20% squash on landing with a springy settle, the head and each tail joint a beat behind the body, blinks
// close in 110 ms and open in 190 ms, props appear by scale, one clock, seeded choices (no per-frame random),
// pause when hidden, a still frame under reduced motion. Each state holds long enough to read and a queued
// state waits its turn, so nothing cuts off.
const NS = 'http://www.w3.org/2000/svg'
const CAT = 'currentColor', FACE = 'var(--cat-face, #fff)', PROP = 'var(--cat-prop, #d9d9d9)'
export const H = 170                          // stage height, px
const K = 0.8, M = 50, GR = 42, G = H - 4     // cat scale, side margin, globe radius, ground line

// seconds a state holds before a queued one may take over; done ends itself, then idle
const MIN = { idle: 0, sleep: 0, walk: 0.9, think: 1.2, search: 2.4, write: 1.4, done: 0 }

// poses in the cat's own units, facing right, origin on the ground under its middle.
// h = hip, s = shoulder, n = head offset from shoulder, bw = body thickness,
// f = feet (back far, back near, front far, front near), ta/tc = tail angle at the root / curl to the tip
const POSES = {
  stand:  { hx: -30, hy: -47, sx: 22, sy: -49, nx: 16, ny: -22, bw: 28, f: [-34, 0, -24, 0, 18, 0, 28, 0], ta: 222, tc: 120 },
  sit:    { hx: -14, hy: -22, sx: 6, sy: -58, nx: 6, ny: -22, bw: 32, f: [-2, 0, 4, 0, 12, 0, 18, 0], ta: 160, tc: 115 },
  lie:    { hx: -24, hy: -16, sx: 18, sy: -17, nx: 16, ny: -12, bw: 32, f: [-20, -1, -14, -1, 24, -1, 32, -1], ta: 165, tc: -210 },
  crouch: { hx: -30, hy: -32, sx: 22, sy: -24, nx: 20, ny: -12, bw: 27, f: [-30, 0, -20, 0, 16, 0, 26, 0], ta: 185, tc: 70 },
  bow:    { hx: -24, hy: -50, sx: 18, sy: -18, nx: 22, ny: -8, bw: 27, f: [-24, 0, -16, 0, 36, 0, 46, 0], ta: 265, tc: 90 },
  leap:   { hx: -32, hy: -42, sx: 26, sy: -46, nx: 16, ny: -20, bw: 26, f: [-52, -22, -46, -18, 48, -28, 54, -24], ta: 185, tc: 80 },
  perch:  { hx: -22, hy: -40, sx: 16, sy: -42, nx: 16, ny: -22, bw: 28, f: [-17, 0, -11, 0, 7, 0, 13, 0], ta: 222, tc: 120 },   // feet close, on the globe's top
  ride:   { hx: -22, hy: -18, sx: 16, sy: -24, nx: 14, ny: -18, bw: 32, f: [-20, -2, -14, -2, 22, -2, 28, -2], ta: 178, tc: 40 },
}
const P = {}
for (const k in POSES) {
  const { f, ...rest } = POSES[k]
  P[k] = rest
  f.forEach((v, i) => P[k]['f' + i] = v)
}
const DEF = { wag: 0.35, ws: 1.6, tilt: 0, open: 1, openR: 1, happy: 0, lookX: 0.3, lookY: 0, lid: 0, ear: 0, earL: 0,
  smile: 0.5, w: 0, stride: 24, lift: 7, globe: 0, plane: 0, rot: 0, beansN: 0, beansF: 0, sq: 1 }
const TAU = { open: 0.05, openR: 0.05, happy: 0.05, lid: 0.06, earL: 0.05, w: 0.12, nx: 0.2, ny: 0.2, tilt: 0.22,
  globe: 0.16, plane: 0.16, rot: 0.1, beansN: 0.08, beansF: 0.08 }
const LEG = [0.5, 0, 0.75, 0.25]   // walk order: back far, back near, front far, front near
const LW = 150                     // width of the globe's land strip before it repeats
const LANDS = [[18, -12, 16, 10, -20], [50, 10, 11, 16, 15], [92, -6, 20, 12, 10], [126, 16, 10, 7, -30], [72, -24, 9, 5, 0]]

const n = x => Math.round(x * 10) / 10
const ease = x => x * x * (3 - 2 * x)
const lerp = (a, b, k) => a + (b - a) * k
function rng32(a) {
  return () => {
    a = a + 0x6D2B79F5 | 0
    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}
function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag)
  for (const k in attrs) e.setAttribute(k, attrs[k])
  parent?.appendChild(e)
  return e
}

// ---- moves shared by the states ----
const clampX = (c, x, m = M) => Math.max(m, Math.min(c.W - m, x))
function newX(c, min) {
  let x = M + c.rng() * (c.W - 2 * M)
  if (Math.abs(x - c.x) < min) x = c.x > c.W / 2 ? M + c.rng() * (c.W / 2 - M) : c.W / 2 + c.rng() * (c.W / 2 - M)
  return x
}
// walk toward x: speeds up from rest, slows into the stop; true once there
function go(c, x, v, dt) {
  const d = x - c.x
  if (Math.abs(d) < 1.5) { c.spd = 0; return true }
  c.face = Math.sign(d)
  c.spd += (v - c.spd) * (1 - Math.exp(-dt / 0.25))
  const step = Math.min(Math.abs(d), c.spd * Math.min(1, Math.abs(d) / 28 + 0.25) * dt)
  c.x += c.face * step
  c.pace = step / dt
  return false
}
// a jump: crouch first (anticipation), a real arc, then a squash on landing
const hop = (c, x1, y1, h, dur = 0.5) => { c.arc = { t: 0, pre: 0.14, dur, x0: c.x, y0: c.y, x1, y1, h } }
function arcStep(c, dt, g) {
  const a = c.arc
  a.t += dt
  if (a.t < a.pre) { Object.assign(g, P.crouch); g.sq = 0.86; return }
  const u = Math.min(1, (a.t - a.pre) / a.dur)
  c.x = lerp(a.x0, a.x1, u)
  c.y = lerp(a.y0, a.y1, u) + a.h * 4 * u * (1 - u)
  if (Math.abs(a.x1 - a.x0) > 1) c.face = Math.sign(a.x1 - a.x0)
  Object.assign(g, u < 0.7 ? P.leap : P.stand)
  g.sq = u < 0.5 ? 1.08 : 1
  g.open = 1.1
  if (u === 1) { c.arc = null; c.v.sq = 0.82; c.sqv = 0 }
}
// a spot d px ahead, or behind if that runs off the stage
const near = (c, d) => { const x = c.x + c.face * d; return clampX(c, x < M || x > c.W - M ? c.x - c.face * d : x) }
const off = c => clampX(c, c.x + c.face * (GR + 36))   // a spot beside the globe

// ---- the states; g = this frame's targets ----
const IDLE = [['sit', 2, 2], ['look', 2.6, 3], ['groom', 2.4, 2], ['stroll', 99, 3], ['stretch', 2.2, 1.2], ['peek', 3.6, 1.6], ['flick', 1.4, 2]]
const B = {
  idle(c, s, t, dt, g) {
    if (s > 45) return B.sleep(c, s, t, dt, g)
    const m = c.m
    if (!m.a || s > m.end) {   // pick the next small thing to do, never the same twice
      let a
      const sum = IDLE.reduce((x, i) => x + i[2], 0)
      do { let r = c.rng() * sum; a = IDLE.find(i => (r -= i[2]) < 0) } while (m.a && a[0] === m.a[0])
      if (!m.a) a = IDLE[0]
      Object.assign(m, { a, t0: s, end: s + a[1], x: null })
    }
    const u = s - m.t0, k = m.a[0]
    Object.assign(g, P.sit)
    g.lookX = 0.4 * Math.sin(t * 0.5)
    if (k !== 'peek' && c.y < 0) c.y = Math.min(0, c.y + 140 * dt)
    if (k === 'look') { g.lookX = Math.sin(u * 2.2); g.tilt = 9 * Math.sin(u * 1.6); g.earL = u > 1 && u < 1.2 ? 1 : 0 }
    if (k === 'flick') { g.earL = u % 0.6 < 0.12 ? 1 : 0; g.wag = 1.1; g.ws = 5; g.lookX = -0.6 }
    if (k === 'groom' && u > 0.2 && u < m.a[1] - 0.3) {   // lick the near front paw
      g.f6 = 14; g.f7 = -58 + 2 * Math.sin(u * 12); g.beansN = 1
      g.ny += 3 + 1.5 * Math.sin(u * 12); g.tilt = -10; g.open = 0; g.happy = 1
    }
    if (k === 'stroll') {
      Object.assign(g, P.stand)
      g.lookX = 0.8; g.wag = 0.5; g.ws = 2.4
      if (go(c, m.x ??= newX(c, 80), 62, dt)) m.end = s
    }
    if (k === 'stretch' && u < 1.4) { Object.assign(g, P.bow); g.open = 0; g.happy = 1; g.wag = 0.8; g.ws = 3; g.smile = 1 }
    if (k === 'peek') {   // duck behind the edge, peek over it with both paws, come back up
      c.y += ((u < 2.9 ? -52 : 0) - c.y) * (1 - Math.exp(-dt / 0.16))
      if (u > 0.4 && u < 2.9) {
        const gy = c.y / K - 1
        g.f4 = 0; g.f5 = gy; g.f6 = 18; g.f7 = gy; g.beansN = g.beansF = 1
        g.lookX = Math.sin(u * 2.4); g.lookY = -0.2; g.earL = u > 1.6 && u < 1.75 ? 1 : 0
      }
    }
  },
  sleep(c, s, t, dt, g) {
    Object.assign(g, P.lie)
    g.open = g.openR = 0; g.wag = 0.12; g.ws = 0.7; g.ear = 0.2; g.smile = 0.3
    g.bw += 1.4 * Math.sin(t * 1.6); g.hy += 0.8 * Math.sin(t * 1.6)
  },
  walk(c, s, t, dt, g) {   // the question goes out: a brisk trot along the stage
    Object.assign(g, P.stand)
    g.stride = 26; g.lift = 8; g.lookX = 0.8; g.wag = 0.6; g.ws = 3; g.tilt = -3
    if (c.m.x == null || go(c, c.m.x, 100, dt)) c.m.x = newX(c, 90)
  },
  think(c, s, t, dt, g) {   // stalk, wiggle, sometimes pounce, sit and ponder, again
    const m = c.m
    m.k ??= 'stalk'; m.t0 ??= 0
    const u = s - m.t0, next = k => { m.k = k; m.t0 = s }
    if (m.k === 'stalk') {
      Object.assign(g, P.crouch)
      g.stride = 15; g.lift = 4; g.lid = 0.35; g.lookX = 1; g.wag = 0.3; g.ws = 2.4; g.ear = 0.15
      if (go(c, m.x ??= near(c, 60 + c.rng() * 60), 36, dt)) next('wiggle')   // a short creep, not across the stage
    } else if (m.k === 'wiggle') {
      Object.assign(g, P.crouch)
      g.hy -= 4; g.hx += 3 * Math.sin(u * 22); g.wag = 0.9; g.ws = 9; g.lookX = 1; g.ear = 0.3
      if (u > 1.1) {
        if (c.rng() < 0.55) hop(c, clampX(c, c.x + c.face * 52), 0, 22, 0.42)
        next('ponder')
      }
    } else {
      Object.assign(g, P.sit)
      g.lookY = -1; g.lookX = 0.4; g.tilt = 10 * Math.sin(u * 1.2); g.smile = 0.15; g.wag = 0.5
      if (u > 2) { m.x = null; next('stalk') }
    }
  },
  search(c, s, t, dt, g) {   // a big globe rolls up; the cat hops on and walks it, stopping to peer down
    const m = c.m
    if (m.gx == null) {
      let gx = c.x + c.face * 100
      if (gx < M + GR || gx > c.W - M - GR) gx = c.x - c.face * 100
      c.gx = m.gx = clampX(c, gx, GR + 12)
    }
    g.globe = 1
    Object.assign(g, c.y > GR ? P.perch : P.stand)
    const top = 2 * GR
    if (c.arc || Math.abs(c.x - m.gx) > 1 || c.y < top - 1) {
      g.lookX = 1; g.lookY = 0.5
      if (!c.arc && s > 0.35) hop(c, m.gx, top, 24, 0.55)
      return
    }
    c.ball = true
    m.on ??= s
    const u = (s - m.on) % 3.6, cyc = Math.floor((s - m.on) / 3.6)
    if (cyc !== m.cyc) { if (m.cyc != null && c.rng() < 0.45) c.face = -c.face; m.cyc = cyc }
    g.wag = 0.5; g.ws = 2.2; g.lookY = 0.6
    if (u < 2.4) { c.pace = 40; c.spin += c.face * 50 * dt; g.stride = 13; g.lift = 5; g.lookX = 0.9 }
    else { g.ny += 7; g.nx += 4; g.tilt = -10; g.lookY = 1; g.lookX = 0.5 + 0.5 * Math.sin(u * 5); g.lid = 0.2 }
  },
  write(c, s, t, dt, g) {   // the answer streams: the cat flies a paper plane up and down the stage, loops now and then
    const m = c.m
    g.plane = 1
    Object.assign(g, P.ride)
    g.ear = 0.8; g.lookX = 1; g.smile = 0.9; g.wag = 1; g.ws = 11
    if (c.arc || s < 0.4) return   // the plane grows under the cat first
    m.ft ??= 0; m.ft += dt
    m.nextLoop ??= 3 + c.rng() * 3
    const vx = 92 * Math.min(1, (s - 0.4) * 1.5)
    if (m.loop) {
      const L = m.loop, u = Math.min(1, (L.t += dt) / 1.4), a = 2 * Math.PI * ease(u)
      c.x = L.x + c.face * (22 * Math.sin(a) + 50 * u)
      c.y = L.y + 22 * (1 - Math.cos(a))
      g.rot = -c.face * a * 57.3
      if (u === 1) { m.loop = null; c.v.rot += c.face * 360; m.nextLoop = m.ft + 5 + c.rng() * 3 }
      return
    }
    const y0 = c.y
    c.x += c.face * vx * dt
    c.y += (46 + 16 * Math.sin(m.ft * 2) - c.y) * (1 - Math.exp(-dt / 0.5))
    g.rot = -c.face * Math.max(-25, Math.min(25, Math.atan2((c.y - y0) / dt, vx || 1) * 57.3))
    if ((c.face > 0 && c.x > c.W - M - 10) || (c.face < 0 && c.x < M + 10)) c.face = -c.face
    else if (m.ft > m.nextLoop && c.x > M + 70 && c.x < c.W - M - 70) m.loop = { t: 0, x: c.x, y: c.y }
  },
  done(c, s, t, dt, g) {   // land, leap for joy, stretch, sit and wink
    const m = c.m
    m.from ??= c.y > 0.5 ? c.prev : 'ground'
    if (m.from === 'write' && c.y > 0.5) {   // glide the plane down
      Object.assign(g, P.ride)
      g.plane = 1; g.ear = 0.5; g.smile = 1; g.lookX = 1; g.rot = c.face * 8
      c.x += c.face * 60 * dt
      if ((c.face > 0 && c.x > c.W - M) || (c.face < 0 && c.x < M)) c.face = -c.face
      c.y = Math.max(0, c.y - 55 * dt)
      if (!c.y) { c.v.sq = 0.85; c.sqv = 0 }
      return
    }
    if (c.y > 0.5) {   // off the globe (or anywhere up high)
      Object.assign(g, P.stand)
      g.globe = 1
      if (!c.arc) hop(c, off(c), 0, 20, 0.5)
      return
    }
    m.g0 ??= s
    Object.assign(g, P.stand)
    g.smile = 1
    if (s - m.g0 < 0.35 || c.arc) return
    if (!m.leapt) { m.leapt = true; return hop(c, clampX(c, c.x + c.face * 44), 0, 36, 0.5) }
    const v = s - (m.land ??= s)
    if (v < 1) { Object.assign(g, P.bow); g.open = g.openR = 0; g.happy = 1; g.wag = 1; g.ws = 4 }
    else { Object.assign(g, P.sit); g.happy = 1; g.tilt = 8; if (v < 1.8) g.openR = 0 }
    if (v > 2) c.over = true
  },
}
const AIR = { search: 1, write: 1, done: 1 }   // states that handle being up high themselves

// ---- one clock for every cat ----
const cats = new Set()
const reduced = matchMedia('(prefers-reduced-motion: reduce)')
let raf = 0, last = 0, uid = 0
function loop(ms) {
  const dt = Math.min(0.05, (ms - last) / 1000)
  last = ms
  for (const c of cats) c.svg.isConnected ? c.tick(ms / 1000, dt) : cats.delete(c)
  raf = cats.size && !document.hidden ? requestAnimationFrame(loop) : 0
}
function wake() {
  if (raf || !cats.size || document.hidden || reduced.matches) return
  last = performance.now()
  raf = requestAnimationFrame(loop)
}
document.addEventListener('visibilitychange', wake)

export function makeCat(host, state = 'idle') {
  const id = ++uid
  const svg = el('svg', { class: 'cat', height: H, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })
  svg.style.cssText = 'width:100%;overflow:visible;display:block'
  const defs = el('defs', {}, svg)
  el('circle', { cy: -GR, r: GR - 1.5 }, el('clipPath', { id: 'cg' + id }, defs))
  const below = el('rect', { x: -1e4, y: -1e4, width: 2e4 }, el('clipPath', { id: 'cc' + id }, defs))   // the cat can duck behind the edge

  // the globe: white ball, blue land rolling across it
  const globe = el('g', {}, svg)
  el('ellipse', { rx: GR * 0.9, ry: 4, fill: CAT, opacity: 0.12 }, globe)
  el('circle', { cy: -GR, r: GR, fill: FACE }, globe)
  const land = el('g', {}, el('g', { 'clip-path': `url(#cg${id})` }, globe))
  for (const o of [0, LW]) for (const [x, y, rx, ry, a] of LANDS) el('ellipse', { cx: x + o, cy: y - GR, rx, ry, fill: CAT, opacity: 0.35, transform: `rotate(${a} ${x + o} ${y - GR})` }, land)
  el('path', { d: `M${-GR} ${-GR}H${GR}`, stroke: CAT, 'stroke-width': 1.2 }, globe)
  el('ellipse', { cy: -GR, rx: GR * 0.45, ry: GR, stroke: CAT, 'stroke-width': 1.2 }, globe)
  el('circle', { cy: -GR, r: GR, stroke: CAT, 'stroke-width': 3 }, globe)

  const shadow = el('ellipse', { rx: 30, ry: 4, fill: CAT, opacity: 0.12 }, svg)
  const root = el('g', {}, el('g', { 'clip-path': `url(#cc${id})` }, svg))
  // the paper plane sits under the cat's feet
  const plane = el('g', { 'stroke-width': 2.5, stroke: CAT }, root)
  el('path', { d: 'M66 2L-36 6L-46 20Z', fill: PROP }, plane)
  el('path', { d: 'M66 2L-56 -8L-36 6Z', fill: FACE }, plane)

  const body = el('g', { fill: CAT }, root)
  const tail = el('path', { stroke: CAT, fill: 'none', 'stroke-width': 8 }, body)
  const legs = [0, 1, 2].map(() => el('path', { stroke: CAT, fill: 'none', 'stroke-width': 9 }, body))
  const torso = el('path', { stroke: CAT }, body)
  const haunch = el('circle', {}, body), chest = el('circle', {}, body)
  const head = el('g', {}, body)
  el('path', { d: 'M-20 7L-32 4M-20 11L-32 12M20 7L32 4M20 11L32 12', stroke: CAT, 'stroke-width': 1.3 }, head)
  const skull = el('path', { stroke: CAT, 'stroke-width': 3 }, head)
  const eyes = [-9, 9].map(x => {
    const e = el('g', { transform: `translate(${x} -1)` }, head)
    return { white: el('ellipse', { rx: 5.6, fill: FACE }, e), pupil: el('ellipse', { rx: 2.8, fill: CAT }, e),
      lid: el('rect', { x: -7, y: -7, width: 14, fill: CAT }, e), shut: el('path', { stroke: FACE, 'stroke-width': 1.6 }, e) }
  })
  el('path', { d: 'M-2 5.5H2L0 7.6Z', fill: FACE, stroke: FACE, 'stroke-width': 1 }, head)
  const mouth = el('path', { stroke: FACE, 'stroke-width': 1.1 }, head)
  legs.push(el('path', { stroke: CAT, fill: 'none', 'stroke-width': 9 }, body))   // the near front paw goes in front of the face (grooming)
  const beans = [2, 3].map(() => {
    const b = el('g', { fill: FACE }, body)
    el('ellipse', { cy: 1.6, rx: 3, ry: 2.3 }, b)
    for (const [x, y] of [[-3, -2], [0, -3.4], [3, -2]]) el('circle', { cx: x, cy: y, r: 1.1 }, b)
    return b
  })

  const c = {
    svg, W: 300, x: 0, y: 0, face: 1, dir: 1, spd: 0, pace: 0, p: 0, spin: 0, gx: -999, sqv: 0,
    st: state, prev: null, s: 0, m: {}, q: [], over: false, arc: null, ball: false,
    rng: rng32(id * 9973), v: { ...DEF, ...P.sit }, nb: 1 + id * 0.7, bs: -9,
  }
  host.appendChild(svg)
  const size = () => {
    c.W = host.clientWidth || 300
    svg.setAttribute('viewBox', `0 0 ${c.W} ${H}`)
    below.setAttribute('height', 1e4 + G + 1)
    c.x = c.x ? clampX(c, c.x) : c.W * 0.3
  }
  size()
  new ResizeObserver(size).observe(host)

  function enter(st) { c.prev = c.st; c.st = st; c.s = 0; c.m = {}; c.over = false }
  const put = (e, k, x) => e.setAttribute(k, typeof x === 'number' ? n(x) : x)

  function draw(t) {
    const v = c.v
    globe.style.display = v.globe < 0.01 ? 'none' : ''
    put(globe, 'transform', `translate(${n(c.gx)} ${G}) scale(${n(v.globe * 100) / 100})`)
    put(land, 'transform', `translate(${n(-(((c.spin % LW) + LW) % LW) - GR)} 0)`)
    const sh = c.y < -4 ? 0 : Math.max(0, 1 - c.y / 100)
    put(shadow, 'transform', `translate(${n(c.x)} ${G}) scale(${n(sh * 100) / 100})`)
    put(root, 'transform', `translate(${n(c.x)} ${n(G - c.y)}) rotate(${n(v.rot)}) scale(${n(c.dir * K * 100) / 100} ${K})`)
    plane.style.display = v.plane < 0.01 ? 'none' : ''
    put(plane, 'transform', `scale(${n(v.plane * 100) / 100})`)
    put(body, 'transform', `scale(${n(100 / v.sq ** 0.6) / 100} ${n(v.sq * 100) / 100})`)

    // walking: feet step in a cat's order, the body bobs twice a cycle, the head rides a little behind
    const bob = v.w * 1.6 * Math.sin(4 * Math.PI * c.p)
    const hx = v.hx, hy = v.hy + bob, sx = v.sx, sy = v.sy + v.w * 1.6 * Math.sin(4 * Math.PI * c.p + 1.2)
    put(torso, 'd', `M${n(hx)} ${n(hy)}Q${n((hx + sx) / 2)} ${n((hy + sy) / 2 - 5)} ${n(sx)} ${n(sy)}`)   // a soft arch in the back
    put(torso, 'stroke-width', v.bw)
    put(haunch, 'cx', hx + 1); put(haunch, 'cy', hy + 3); put(haunch, 'r', v.bw * 0.56)
    put(chest, 'cx', sx + 2); put(chest, 'cy', sy + 4); put(chest, 'r', v.bw * 0.48)

    const joints = [[hx + 3, hy + 6], [hx - 3, hy + 6], [sx + 3, sy + 8], [sx - 3, sy + 8]]
    for (let i = 0; i < 4; i++) {
      let fx = v['f' + 2 * i], fy = v['f' + (2 * i + 1)]
      if (v.w > 0.01) {   // stance: foot slides back; swing: lifts and reaches forward
        const q = (c.p + LEG[i]) % 1
        let dx, dy = 0
        if (q < 0.62) dx = v.stride * (0.5 - q / 0.62)
        else { const u = (q - 0.62) / 0.38; dx = v.stride * (ease(u) - 0.5); dy = -v.lift * Math.sin(Math.PI * u) }
        fx += v.w * dx; fy += v.w * dy
      }
      if (c.ball) fy += (GR - Math.sqrt(Math.max(0, GR * GR - (fx * K) ** 2))) / K   // feet follow the globe's curve
      const [jx, jy] = joints[i], dx = fx - jx, dy = fy - jy, d = Math.hypot(dx, dy) || 1
      const b = Math.min(7, Math.max(1.5, (34 - d) * 0.45)) * (i < 2 ? -1 : 1)   // knees forward, elbows back
      put(legs[i], 'd', `M${n(jx)} ${n(jy)}Q${n((jx + fx) / 2 - dy / d * b)} ${n((jy + fy) / 2 + dx / d * b)} ${n(fx)} ${n(fy)}`)
      if (i > 1) {
        const k = i === 3 ? v.beansN : v.beansF, bn = beans[i - 2]
        bn.style.display = k < 0.02 ? 'none' : ''
        put(bn, 'transform', `translate(${n(fx)} ${n(fy)}) scale(${n(k * 100) / 100})`)
      }
    }

    // tail: each joint swings a beat after the one before it, curling toward the tip; it rests on the floor
    let px = hx - v.bw * 0.42, py = hy - 3, dt = `M${n(px)} ${n(py)}`
    const pts = []
    for (let i = 0; i < 11; i++) {
      const k = (i + 1) / 11
      const a = (v.ta + v.tc * k ** 3 + v.wag * 22 * (0.3 + k) * Math.sin(t * v.ws - i * 0.6)) * Math.PI / 180
      px += Math.cos(a) * 6.8; py = Math.min(-2.5, py + Math.sin(a) * 6.8)
      pts.push([px, py])
    }
    pts.forEach(([x, y], i) => {
      const nx = pts[i + 1]
      dt += nx ? `Q${n(x)} ${n(y)} ${n((x + nx[0]) / 2)} ${n((y + nx[1]) / 2)}` : `L${n(x)} ${n(y)}`
    })
    put(tail, 'd', dt)

    // head and face
    put(head, 'transform', `translate(${n(sx + v.nx)} ${n(sy + v.ny + bob * 0.5)}) rotate(${n(v.tilt)}) scale(.9)`)
    const eL = v.ear + v.earL * 0.7, eR = v.ear
    put(skull, 'd', `M-23 6C-24-6-21-14-18-17L${n(-17 - 4 * eL)} ${n(-31 + 10 * eL)}L-7-19Q0-21 7-19L${n(17 + 4 * eR)} ${n(-31 + 10 * eR)}L18-17C21-14 24-6 23 6C22 16 12 21 0 21C-12 21-22 16-23 6Z`)
    // blink: close 110 ms, hold 40, open 190; every 3-4 s, sometimes twice
    if (t > c.nb) { c.bs = t; c.nb = t + (c.rng() < 0.2 ? 0.45 : 3 + c.rng() * 1.2) }
    const tb = t - c.bs, blink = tb < 0.11 ? 1 - tb / 0.11 : tb < 0.15 ? 0 : tb < 0.34 ? (tb - 0.15) / 0.19 : 1
    eyes.forEach((e, i) => {
      const o = Math.max(0, Math.min(1.15, (i ? v.openR * v.open : v.open) * blink)), shut = o < 0.3
      put(e.white, 'ry', 5.6 * Math.max(o, 0.06))
      put(e.pupil, 'cx', v.lookX * 2.4); put(e.pupil, 'cy', v.lookY * 2.4 * Math.min(1, o))
      put(e.pupil, 'ry', 2.8 * Math.min(1, o))
      put(e.lid, 'height', Math.max(0, 1.4 + 11.2 * v.lid))
      e.white.style.display = e.pupil.style.display = e.lid.style.display = shut ? 'none' : ''
      e.shut.style.display = shut ? '' : 'none'
      put(e.shut, 'd', v.happy > 0.5 ? 'M-5 1.5Q0-4 5 1.5' : 'M-5-1Q0 3 5-1')
    })
    put(mouth, 'd', `M-3.5 9.5Q-1.7 ${n(9.5 + 2.5 * v.smile)} 0 9.5Q1.7 ${n(9.5 + 2.5 * v.smile)} 3.5 9.5`)
  }

  const cat = {
    svg,
    get state() { return c.st },
    tick(t, dt) {
      c.s += dt
      const ready = c.s >= MIN[c.st] && !c.arc && (c.st !== 'done' || c.over)
      if (c.q.length && ready) enter(c.q.shift())
      else if (c.st === 'done' && c.over) enter('idle')
      const g = { ...DEF }
      c.pace = 0; c.ball = false
      if (c.y > 0.5 && !c.arc && !AIR[c.st]) hop(c, c.gx > 0 && Math.abs(c.x - c.gx) < 2 ? off(c) : c.x, 0, 14, 0.4)
      if (c.st !== 'idle' && c.y < 0) c.y = Math.min(0, c.y + 160 * dt)
      B[c.st](c, c.s, t, dt, g)
      if (c.arc) arcStep(c, dt, g)
      g.w = c.pace > 1 ? 1 : 0
      for (const k in g) if (k !== 'sq') c.v[k] += (g[k] - c.v[k]) * (1 - Math.exp(-dt / (TAU[k] ?? (k[0] === 'f' ? 0.1 : 0.14))))
      c.sqv += (280 * (g.sq - c.v.sq) - 14 * c.sqv) * dt   // springy squash: overshoots a little, settles
      c.v.sq += c.sqv * dt
      c.dir += (c.face - c.dir) * (1 - Math.exp(-dt / 0.06))   // a turn flips through the middle, like a body turning
      c.p += c.pace * 0.62 / (c.v.stride * K) * dt
      draw(t)
    },
    // ask for a state; it plays once the current one has held long enough
    set(s) {
      if (reduced.matches) {   // still pictures: a calm pose per state
        c.q = []; enter(s); c.arc = null; c.y = 0
        for (let i = 0; i < 20; i++) cat.tick(performance.now() / 1000, 0.05)
        return
      }
      if (s !== (c.q.at(-1) ?? c.st)) c.q.push(s)
      wake()
    },
  }
  cats.add(cat)
  reduced.matches ? cat.set(state) : wake()
  return cat
}
