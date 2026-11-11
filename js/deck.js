// Slide engine: a fixed 1600x900 stage, steps within a slide, a URL hash, an overview,
// a notes overlay, and a presenter window that talks to the deck with postMessage
// (postMessage works between file:// pages; BroadcastChannel does not in every browser).
const Deck = (() => {
  const params = new URLSearchParams(location.search)
  if (params.has('shot')) document.documentElement.classList.add('shot')
  const mode = params.has('presenter') ? 'presenter' : params.has('view') ? 'view' : 'main'
  const stage = document.getElementById('stage')
  const slides = [...stage.querySelectorAll('.slide')]
  const controllers = {}
  const started = new Set()
  let idx = 0
  let step = 0
  let presenterWin = null
  let touchNav = null

  const PARTS = {
    music: { label: '5 Minutes to Jam', color: 'var(--yellow)' },
  }

  const maxStep = (s) =>
    s.dataset.steps !== undefined
      ? +s.dataset.steps
      : Math.max(0, ...[...s.querySelectorAll('[data-s],[data-only]')].map((e) => +(e.dataset.s ?? e.dataset.only)))

  function fit() {
    const reserved = touchNav ? touchNav.offsetHeight : 0
    const height = Math.max(1, document.documentElement.clientHeight - reserved)
    const k = Math.min(document.documentElement.clientWidth / 1600, height / 900)
    stage.style.top = `${height / 2}px`
    stage.style.transform = `scale(${k}) translate(-50%, -50%)`
  }

  function applySteps(s, n) {
    s.dataset.step = n
    s.querySelectorAll('[data-s]').forEach((e) => {
      e.classList.toggle('on', n >= +e.dataset.s)
      e.classList.toggle('past-step', n > +e.dataset.s)
    })
    s.querySelectorAll('[data-only]').forEach((e) => {
      const v = e.dataset.only.split(',').map(Number)
      e.classList.toggle('on', v.includes(n))
    })
  }

  function call(s, hook, ...args) {
    const c = controllers[s.dataset.id]
    if (c && c[hook]) {
      try {
        c[hook](s, ...args)
      } catch (err) {
        console.error(`[${s.dataset.id}.${hook}]`, err)
      }
    }
  }

  function chrome() {
    const s = slides[idx]
    const part = PARTS[s.dataset.part || 'music']
    const el = document.getElementById('chrome')
    el.querySelector('.part').textContent = part.label
    el.querySelector('.num').textContent = `${idx + 1} / ${slides.length}`
    const bar = el.querySelector('.bar')
    bar.innerHTML = ''
    const span = document.createElement('span')
    span.style.width = `${((idx + 1) / slides.length) * 100}%`
    span.style.background = part.color
    bar.appendChild(span)
    stage.dataset.chrome = s.dataset.chrome || 'on'
    document.body.style.background = s.dataset.bg || ''
    if (touchNav) {
      touchNav.querySelector('[data-nav="prev"]').disabled = idx === 0 && step === 0
      touchNav.querySelector('[data-nav="next"]').disabled = idx === slides.length - 1 && step === maxStep(s)
      touchNav.querySelector('[data-progress]').textContent = `${idx + 1} / ${slides.length}`
    }
  }

  function go(i, n = 0, silent = false) {
    i = Math.max(0, Math.min(slides.length - 1, i))
    const prev = slides[idx]
    const changed = i !== idx || !started.has('first')
    if (changed && started.has('first')) call(prev, 'leave')
    slides.forEach((s, k) => {
      s.classList.toggle('active', k === i)
      s.classList.toggle('past', k < i)
    })
    idx = i
    const s = slides[idx]
    if (!started.has(s.dataset.id) && s.dataset.id) {
      started.add(s.dataset.id)
      call(s, 'init')
    }
    started.add('first')
    step = Math.max(0, Math.min(maxStep(s), n))
    applySteps(s, step)
    if (changed) call(s, 'enter')
    call(s, 'step', step)
    chrome()
    if (mode !== 'presenter') history.replaceState(null, '', `${location.search}#/${idx + 1}/${step}`)
    if (!silent) broadcast()
    document.getElementById('notesbox').innerHTML = notesHtml(idx)
  }

  function setStep(n) {
    go(idx, n)
  }
  function next() {
    if (step < maxStep(slides[idx])) setStep(step + 1)
    else if (idx < slides.length - 1) go(idx + 1, 0)
  }
  function prev() {
    if (step > 0) setStep(step - 1)
    else if (idx > 0) go(idx - 1, maxStep(slides[idx - 1]))
  }

  function notesHtml(i) {
    const n = slides[i] && slides[i].querySelector('.notes')
    return n ? n.innerHTML : '<p class="faint">No notes.</p>'
  }

  function broadcast() {
    const msg = { type: '5-minutes-to-jam-state', idx, step }
    if (presenterWin && !presenterWin.closed) presenterWin.postMessage(msg, '*')
    if (mode === 'presenter' && window.opener) window.opener.postMessage(msg, '*')
  }

  // ---------- overview ----------
  function buildOverview() {
    const ov = document.getElementById('overview')
    ov.innerHTML = ''
    slides.forEach((s, i) => {
      const a = document.createElement('a')
      a.href = '#'
      const title = (s.querySelector('h1,h2') || {}).textContent || s.dataset.id
      a.innerHTML = `<i>${i + 1}</i>${title}`
      a.style.setProperty('--c', PARTS[s.dataset.part || 'music'].color)
      if (i === idx) a.className = 'cur'
      a.onclick = (e) => {
        e.preventDefault()
        ov.classList.remove('open')
        go(i, 0)
      }
      ov.appendChild(a)
    })
  }
  function toggleOverview() {
    const ov = document.getElementById('overview')
    if (!ov.classList.contains('open')) buildOverview()
    ov.classList.toggle('open')
  }

  // ---------- presenter ----------
  function openPresenter() {
    presenterWin = window.open(`${location.pathname}?presenter#/${idx + 1}/${step}`, '5-minutes-to-jam-presenter', 'width=1400,height=900')
    setTimeout(broadcast, 800)
  }

  function presenterView() {
    document.body.classList.add('presenter')
    const root = document.getElementById('presenter')
    const base = location.pathname
    root.innerHTML = `
      <div class="frame"><iframe id="pcur" src="${base}?view#/1/0"></iframe></div>
      <div class="col">
        <div class="frame" style="max-height:260px"><iframe id="pnext" src="${base}?view#/2/0"></iframe></div>
        <div class="meta">
          <div class="clock" id="pclock">00:00</div>
          <div id="ppart"></div>
          <div id="pstep"></div>
          <div>→ / space: next · ← back · R: reset clock</div>
        </div>
      </div>
      <div class="pnotes" id="pnotes"></div>`
    let t0 = Date.now()
    const partStart = {}
    let lastPart = null
    setInterval(() => {
      const fmt = (ms) => {
        const s = Math.floor(ms / 1000)
        return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
      }
      document.getElementById('pclock').textContent = fmt(Date.now() - t0)
      const s = slides[idx]
      const p = s.dataset.part || 'music'
      if (p !== lastPart) {
        partStart[p] = partStart[p] || Date.now()
        lastPart = p
      }
      const target = { music: '8 min', research: '18 min' }[p]
      document.getElementById('ppart').textContent =
        `${PARTS[p].label}: ${fmt(Date.now() - partStart[p])}${target ? ` (target ${target})` : ''}`
    }, 500)
    const show = () => {
      const cur = document.getElementById('pcur')
      const nx = document.getElementById('pnext')
      const ms = maxStep(slides[idx])
      const nextPos = step < ms ? [idx, step + 1] : [idx + 1, 0]
      cur.contentWindow && cur.contentWindow.postMessage({ type: '5-minutes-to-jam-goto', idx, step }, '*')
      nx.contentWindow && nx.contentWindow.postMessage({ type: '5-minutes-to-jam-goto', idx: nextPos[0], step: nextPos[1] }, '*')
      document.getElementById('pnotes').innerHTML = notesHtml(idx)
      document.getElementById('pstep').textContent = `slide ${idx + 1}/${slides.length} · step ${step}/${ms}`
    }
    document.getElementById('pcur').onload = show
    document.getElementById('pnext').onload = show
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === '5-minutes-to-jam-state') {
        idx = e.data.idx
        step = e.data.step
        show()
      }
    })
    window.addEventListener('keydown', (e) => {
      const nav = { ArrowRight: 'next', ' ': 'next', PageDown: 'next', ArrowLeft: 'prev', PageUp: 'prev' }[e.key]
      if (nav && window.opener) {
        e.preventDefault()
        window.opener.postMessage({ type: '5-minutes-to-jam-nav', action: nav }, '*')
      }
      if (e.key === 'r' || e.key === 'R') t0 = Date.now()
    })
    const m = location.hash.match(/#\/(\d+)\/(\d+)/)
    if (m) {
      idx = +m[1] - 1
      step = +m[2]
    }
    setTimeout(show, 600)
  }

  function touchNavigation() {
    touchNav = document.createElement('nav')
    touchNav.id = 'touch-nav'
    touchNav.setAttribute('aria-label', 'Presentation navigation')
    touchNav.innerHTML = `
      <button type="button" data-nav="prev" aria-label="Previous step">← Previous</button>
      <button type="button" data-nav="overview" aria-label="Toggle slide overview">Slides</button>
      <span data-progress aria-live="polite" aria-atomic="true"></span>
      <button type="button" data-nav="next" aria-label="Next step">Next →</button>`
    document.body.appendChild(touchNav)
    touchNav.querySelector('[data-nav="prev"]').addEventListener('click', prev)
    touchNav.querySelector('[data-nav="next"]').addEventListener('click', next)
    touchNav.querySelector('[data-nav="overview"]').addEventListener('click', toggleOverview)

    // Keep gestures on instruments, media, and controls with their own handlers.
    const interactive = 'button, a, input, select, textarea, audio, video, .kbd, .dcard, .jcard, [role="button"], #overview, #notesbox, #touch-nav'
    let start = null
    document.addEventListener('touchstart', (event) => {
      start = null
      if (event.touches.length !== 1 || event.target.closest(interactive)) return
      const touch = event.touches[0]
      // Leave the browser's edge gestures available.
      if (touch.clientX < 24 || touch.clientX > innerWidth - 24) return
      start = { x: touch.clientX, y: touch.clientY }
    }, { passive: true })
    document.addEventListener('touchend', (event) => {
      const origin = start
      start = null
      if (!origin || event.touches.length || event.changedTouches.length !== 1) return
      const touch = event.changedTouches[0]
      const dx = touch.clientX - origin.x
      const dy = touch.clientY - origin.y
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
      dx < 0 ? next() : prev()
    }, { passive: true })
    document.addEventListener('touchcancel', () => { start = null }, { passive: true })
  }

  // ---------- input ----------
  function onKey(e) {
    if (e.target.matches('input, textarea, select')) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const pianoSlide = slides[idx].hasAttribute('data-piano')
    const k = e.key
    if (['ArrowRight', 'PageDown', ' ', 'ArrowDown'].includes(k)) {
      e.preventDefault()
      next()
      return
    }
    if (['ArrowLeft', 'PageUp', 'ArrowUp'].includes(k)) {
      e.preventDefault()
      prev()
      return
    }
    if (k === 'Home') return go(0, 0)
    if (k === 'End') return go(slides.length - 1, 0)
    if (k === 'Escape') return document.getElementById('overview').classList.remove('open')
    // On slides with a piano, plain letters play notes; deck shortcuts need Shift.
    if (pianoSlide && !e.shiftKey) return
    const l = k.toLowerCase()
    if (l === 'o') toggleOverview()
    else if (l === 'n') document.getElementById('notesbox').classList.toggle('open')
    else if (l === 'p') openPresenter()
    else if (l === 'f') {
      if (document.fullscreenElement) document.exitFullscreen()
      else document.documentElement.requestFullscreen()
    }
  }

  function init() {
    if (mode === 'presenter') return presenterView()
    if (mode === 'main' && !params.has('shot')) touchNavigation()
    fit()
    addEventListener('resize', fit)
    addEventListener('keydown', onKey)
    addEventListener('message', (e) => {
      const d = e.data || {}
      if (d.type === '5-minutes-to-jam-nav') d.action === 'next' ? next() : prev()
      if (d.type === '5-minutes-to-jam-goto') go(d.idx, d.step, true)
    })
    if (mode === 'view') document.body.classList.add('view')
    const m = location.hash.match(/#\/(\d+)(?:\/(\d+))?/)
    go(m ? +m[1] - 1 : 0, m && m[2] ? +m[2] : 0)
  }

  return {
    register: (id, c) => (controllers[id] = c),
    init,
    next,
    prev,
    go,
    setStep,
    get step() {
      return step
    },
    get index() {
      return idx
    },
    get current() {
      return slides[idx]
    },
    // Iframes in the presenter window render slides silently.
    muted: mode !== 'main',
    mode,
  }
})()
