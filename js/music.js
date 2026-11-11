// Part 1: a Web Audio electric piano, an on-screen keyboard, and one controller per music slide.
// MIDI numbers throughout: 60 is middle C.
const Music = (() => {
  const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
  const FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']
  const SOLF = ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si']
  const SOLF_B = ['Do', 'Ré♭', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Sol♭', 'Sol', 'La♭', 'La', 'Si♭', 'Si']
  // Keys whose scales are written with flats.
  const FLAT_ROOTS = new Set([5, 10, 3, 8, 1])
  const pc = (m) => ((m % 12) + 12) % 12
  const isBlack = (m) => [1, 3, 6, 8, 10].includes(pc(m))
  let solfege = false
  const name = (m, flat = false) => (solfege ? (flat ? SOLF_B : SOLF) : flat ? FLAT : SHARP)[pc(m)]
  const keyName = (m) => name(m, FLAT_ROOTS.has(pc(m)))

  const MAJOR = [2, 2, 1, 2, 2, 2, 1]
  const MINOR = [2, 1, 2, 2, 1, 2, 2]
  const scale = (root, steps) => steps.reduce((acc, s) => [...acc, acc[acc.length - 1] + s], [root])
  const triad = (root, minor) => [root, root + (minor ? 3 : 4), root + 7]

  // ---------------- synth ----------------
  let ctx = null
  let out = null
  let wet = null
  function audio() {
    if (Deck.muted) return null
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)()
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -14
      comp.ratio.value = 4
      out = ctx.createGain()
      out.gain.value = 0.7
      out.connect(comp).connect(ctx.destination)
      // A short synthetic room: decaying stereo noise as the impulse response.
      const len = ctx.sampleRate * 1.8
      const ir = ctx.createBuffer(2, len, ctx.sampleRate)
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch)
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3)
      }
      const conv = ctx.createConvolver()
      conv.buffer = ir
      wet = ctx.createGain()
      wet.gain.value = 0.22
      wet.connect(conv).connect(comp)
    }
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  }
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12)

  // Two-operator FM electric piano: a sine carrier with a decaying sine modulator,
  // plus a faint high "tine" partial on the attack.
  function pianoVoice(c, destination, room, m, t, { dur = 1.6, vel = 0.8, brightness = 1 } = {}) {
    const f = hz(m)
    const level = vel * 0.22 * Math.min(1, 220 / f + 0.55)
    const amp = c.createGain()
    amp.gain.setValueAtTime(0, t)
    amp.gain.linearRampToValueAtTime(level, t + 0.006)
    amp.gain.exponentialRampToValueAtTime(level * 0.35, t + 0.4)
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    const car = c.createOscillator()
    car.frequency.value = f
    const mod = c.createOscillator()
    mod.frequency.value = f
    const idx = c.createGain()
    idx.gain.setValueAtTime(f * 2.2 * vel * brightness, t)
    idx.gain.exponentialRampToValueAtTime(f * 0.3, t + 0.5)
    mod.connect(idx).connect(car.frequency)
    const tine = c.createOscillator()
    tine.frequency.value = f * 7.02
    const tg = c.createGain()
    tg.gain.setValueAtTime(level * 0.12, t)
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
    tine.connect(tg).connect(amp)
    car.connect(amp)
    amp.connect(destination)
    if (room) amp.connect(room)
    const sources = [car, mod, tine]
    car.onended = () => {
      sources.forEach(source => source.disconnect())
      ;[amp, idx, tg].forEach(node => node.disconnect())
    }
    sources.forEach((o) => {
      o.start(t)
      o.stop(t + dur + 0.05)
    })
    return sources
  }
  function play(m, { when = 0, ...options } = {}) {
    const context = audio()
    if (!context) return
    return pianoVoice(context, out, wet, m, context.currentTime + 0.01 + when, options)
  }
  const chord = (ms, opts = {}) => ms.forEach((m) => play(m, opts))
  const seq = (ms, gap = 0.28, opts = {}) => ms.forEach((m, i) => play(m, { ...opts, when: i * gap }))

  // A separate bus stops the accompaniment while leaving the playable piano live.
  function createBand(context = audio(), destination = out) {
    if (!context) return null
    const bus = context.createGain()
    bus.connect(destination)
    const voices = new Set()
    const noise = context.createBuffer(1, context.sampleRate / 2, context.sampleRate)
    const samples = noise.getChannelData(0)
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1
    let stopped = false

    function voice(source, nodes, time, duration) {
      let tail = source
      for (const node of nodes) { tail.connect(node); tail = node }
      tail.connect(bus)
      voices.add(source)
      source.onended = () => {
        voices.delete(source)
        source.disconnect()
        nodes.forEach(node => node.disconnect())
      }
      source.start(time)
      source.stop(time + duration)
    }

    function drums(time, index, beat) {
      const kick = context.createOscillator()
      kick.frequency.setValueAtTime(130, time)
      kick.frequency.exponentialRampToValueAtTime(48, time + 0.12)
      const body = context.createGain()
      body.gain.setValueAtTime(0.001, time)
      body.gain.linearRampToValueAtTime(0.5, time + 0.006)
      body.gain.exponentialRampToValueAtTime(0.001, time + 0.34)
      voice(kick, [body], time, 0.36)
      for (const offbeat of [false, true]) {
        const start = time + (offbeat ? beat / 2 : 0)
        const hat = context.createBufferSource()
        hat.buffer = noise
        const highpass = context.createBiquadFilter()
        highpass.type = 'highpass'
        highpass.frequency.value = 7500
        const amp = context.createGain()
        const duration = offbeat ? 0.12 : 0.035
        amp.gain.setValueAtTime(offbeat ? 0.045 : 0.025, start)
        amp.gain.exponentialRampToValueAtTime(0.0001, start + duration)
        voice(hat, [highpass, amp], start, duration)
      }
      if (index % 2 === 1) {
        const clap = context.createBufferSource()
        clap.buffer = noise
        const filter = context.createBiquadFilter()
        filter.type = 'bandpass'
        filter.frequency.value = 1600
        filter.Q.value = 0.6
        const amp = context.createGain()
        amp.gain.setValueAtTime(0.0001, time)
        for (const [offset, level] of [[0.002, 0.13], [0.012, 0.0001], [0.024, 0.17]]) {
          amp.gain.linearRampToValueAtTime(level, time + offset)
        }
        amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.16)
        voice(clap, [filter, amp], time, 0.18)
      }
    }

    function pad(notes, time, duration) {
      for (const note of notes) {
        for (const [type, detune] of [['sine', -4], ['triangle', 4]]) {
          const source = context.createOscillator()
          source.type = type
          source.frequency.value = hz(note)
          source.detune.value = detune
          const filter = context.createBiquadFilter()
          filter.type = 'lowpass'
          filter.frequency.value = 750
          filter.Q.value = 0.3
          const amp = context.createGain()
          const level = 0.012 / Math.sqrt(notes.length)
          amp.gain.setValueAtTime(0, time)
          amp.gain.linearRampToValueAtTime(level, time + 0.2)
          amp.gain.setValueAtTime(level, time + duration - 0.15)
          amp.gain.linearRampToValueAtTime(0, time + duration + 0.35)
          voice(source, [filter, amp], time, duration + 0.4)
        }
      }
    }

    return {
      get now() { return context.currentTime },
      beat(notes, index, time, duration) {
        if (stopped) return 0
        drums(time, index, duration)
        if (index === 0) pad(notes, time, duration * 4)
        if (index % 2 !== 0) return 0
        const sustain = duration * 1.8
        for (const note of notes) {
          const sources = pianoVoice(context, bus, null, note, time, {
            dur: sustain,
            vel: index === 0 ? 0.8 : 0.7,
            brightness: 0.6,
          })
          for (const source of sources) {
            voices.add(source)
            source.addEventListener('ended', () => voices.delete(source))
          }
        }
        return duration * 2
      },
      stop() {
        if (stopped) return
        stopped = true
        const time = context.currentTime
        bus.gain.setTargetAtTime(0, time, 0.005)
        voices.forEach(source => source.stop(time + 0.025))
        setTimeout(() => bus.disconnect(), 40)
      },
    }
  }

  // ---------------- keyboard ----------------
  // Letter keys on the computer keyboard play one octave starting from `base`.
  const LETTERS = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k', 'o', 'l', 'p', ';']
  const keyboards = new Set()

  class Keyboard {
    constructor(el, { from = 48, to = 72, base = from, onPlay = null, height = 240 } = {}) {
      this.el = el
      this.from = from
      this.to = to
      this.base = base
      this.onPlay = onPlay
      el.classList.add('kbd')
      el.style.height = `${height}px`
      this.keys = {}
      const whites = []
      for (let m = from; m <= to; m++) if (!isBlack(m)) whites.push(m)
      const w = 100 / whites.length
      let wi = 0
      for (let m = from; m <= to; m++) {
        const k = document.createElement('div')
        k.className = `key ${isBlack(m) ? 'black' : 'white'}`
        k.dataset.m = m
        const octave = Math.floor(m / 12) - 1
        k.dataset.octave = octave
        k.style.setProperty('--octave-color', ['var(--yellow)', 'var(--blue)', 'var(--coral)', 'var(--green)'][(octave - 3 + 4) % 4])
        if (isBlack(m)) {
          k.style.left = `calc(${wi * w}% - ${w * 0.3}%)`
          k.style.width = `${w * 0.6}%`
        } else {
          k.style.left = `${wi * w}%`
          k.style.width = `${w}%`
          wi++
        }
        k.innerHTML = '<span class="lab"></span><span class="tag"></span>'
        el.appendChild(k)
        this.keys[m] = k
      }
      this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      this.svg.classList.add('arcs')
      el.appendChild(this.svg)
      this.relabel()
      let down = false
      el.addEventListener('pointerdown', (e) => {
        const k = e.target.closest('.key')
        if (!k) return
        down = true
        this.hit(+k.dataset.m)
      })
      el.addEventListener('pointerover', (e) => {
        const k = e.target.closest('.key')
        if (down && k && e.buttons) this.hit(+k.dataset.m)
      })
      addEventListener('pointerup', () => (down = false))
      keyboards.add(this)
    }
    hit(m, sound = true) {
      if (sound) play(m)
      this.flash(m)
      if (this.onPlay) this.onPlay(m)
    }
    flash(m) {
      const k = this.keys[m]
      if (!k) return
      k.classList.remove('pressed')
      void k.offsetWidth
      k.classList.add('pressed')
      clearTimeout(k._t)
      k._t = setTimeout(() => k.classList.remove('pressed'), 380)
    }
    relabel() {
      for (const [m, k] of Object.entries(this.keys)) {
        k.querySelector('.lab').textContent = isBlack(+m) ? `${name(+m)}\n${name(+m, true)}` : name(+m)
      }
    }
    mark(ms, cls) {
      this.clear(cls)
      ms.forEach((m) => this.keys[m] && this.keys[m].classList.add(cls))
    }
    clear(cls) {
      const all = cls ? [cls] : ['root', 'chord', 'scale', 'hl', 'dim']
      Object.values(this.keys).forEach((k) => k.classList.remove(...all))
    }
    tag(m, text) {
      if (this.keys[m]) this.keys[m].querySelector('.tag').textContent = text
    }
    clearTags() {
      Object.values(this.keys).forEach((k) => (k.querySelector('.tag').textContent = ''))
    }
    cx(m) {
      const k = this.keys[m]
      return k.offsetLeft + k.offsetWidth / 2
    }
    // Arcs above the keys between consecutive notes, each with a label such as "+4".
    arcs(pairs, color = 'var(--ink)', animate = true) {
      const W = this.el.offsetWidth
      this.svg.setAttribute('viewBox', `0 -110 ${W} 110`)
      this.svg.innerHTML = ''
      pairs.forEach(([a, b, label], i) => {
        if (!this.keys[a] || !this.keys[b]) return
        const x1 = this.cx(a)
        const x2 = this.cx(b)
        const h = Math.min(90, 26 + Math.abs(x2 - x1) * 0.35)
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        p.setAttribute('d', `M${x1},-6 Q${(x1 + x2) / 2},${-h * 2 + 6} ${x2},-6`)
        p.setAttribute('fill', 'none')
        p.setAttribute('stroke', color)
        p.setAttribute('stroke-width', '3')
        p.setAttribute('stroke-linecap', 'round')
        const len = Math.abs(x2 - x1) * 1.6 + 60
        p.style.strokeDasharray = len
        p.style.strokeDashoffset = animate ? len : 0
        p.style.transition = animate ? `stroke-dashoffset .45s ease ${i * 0.28}s` : 'none'
        this.svg.appendChild(p)
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        t.setAttribute('x', (x1 + x2) / 2)
        t.setAttribute('y', -h - 4)
        t.setAttribute('text-anchor', 'middle')
        t.setAttribute('class', 'arclab')
        t.textContent = label
        t.style.opacity = animate ? 0 : 1
        t.style.transition = animate ? `opacity .3s ease ${i * 0.28 + 0.25}s` : 'none'
        this.svg.appendChild(t)
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            p.style.strokeDashoffset = 0
            t.style.opacity = 1
          }),
        )
      })
    }
    clearArcs() {
      this.svg.innerHTML = ''
    }
  }

  addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
    const s = Deck.current
    if (!s || !s.hasAttribute('data-piano')) return
    const i = LETTERS.indexOf(e.key.toLowerCase())
    if (i < 0) return
    for (const kb of keyboards) if (s.contains(kb.el)) kb.hit(kb.base + i)
  })

  function setSolfege(on) {
    solfege = on
    keyboards.forEach((k) => k.relabel())
    document.querySelectorAll('[data-solf-toggle] button').forEach((b) => b.classList.toggle('on', (b.dataset.v === 'solf') === on))
    document.dispatchEvent(new Event('names-changed'))
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  // A token that cancels a running animation when the slide changes step.
  function runner() {
    let token = 0
    return {
      start() {
        return ++token
      },
      alive(t) {
        return t === token
      },
      stop() {
        token++
      },
    }
  }

  return { play, chord, seq, createBand, Keyboard, name, keyName, pc, isBlack, MAJOR, MINOR, scale, triad, setSolfege, sleep, runner, get solfege() { return solfege } }
})()

// Name toggles (C D E / Do Ré Mi) anywhere in the deck.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-solf-toggle] button')
  if (b) Music.setSolfege(b.dataset.v === 'solf')
})

// ---------------- slide controllers ----------------
;(() => {
  const M = Music
  const q = (s, sel) => s.querySelector(sel)

  // Title slide of part 1.
  Deck.register('music-title', {
    init(s) {
      new M.Keyboard(q(s, '.kbd-host'), { from: 48, to: 76, height: 200 })
    },
  })

  // Twelve notes.
  Deck.register('notes12', {
    init(s) {
      this.kb = new M.Keyboard(q(s, '.kbd-host'), { from: 48, to: 72, height: 260 })
      this.run = M.runner()
      this.counter = q(s, '.counter')
    },
    async step(s, n) {
      const kb = this.kb
      const t = this.run.start()
      kb.clear()
      kb.clearTags()
      this.counter.textContent = ''
      if (n === 1) {
        for (let i = 0; i < 12; i++) {
          if (!this.run.alive(t)) return
          kb.keys[48 + i].classList.add('scale')
          kb.tag(48 + i, String(i + 1))
          kb.hit(48 + i)
          this.counter.textContent = i + 1
          await M.sleep(200)
        }
        if (!this.run.alive(t)) return
        kb.mark([48, 60], 'root')
        kb.hit(60)
        this.counter.textContent = '12, then C again -> Octave'
      }
      if (n === 2) {
        const whites = [48, 50, 52, 53, 55, 57, 59]
        kb.mark(whites, 'hl')
        for (const m of whites) {
          if (!this.run.alive(t)) return
          kb.hit(m)
          await M.sleep(260)
        }
      }
      if (n === 3) {
        kb.mark([49, 51, 54, 56, 58, 61, 63, 66, 68, 70], 'hl')
        for (const m of [49, 51, 54, 56, 58]) {
          if (!this.run.alive(t)) return
          kb.hit(m)
          await M.sleep(240)
        }
      }
    },
    leave() {
      this.run.stop()
    },
  })

  // Semitones: reveal the three interval drawings in order.
  Deck.register('semis', {
    init(s) {
      this.kb = new M.Keyboard(q(s, '.kbd-host'), { from: 48, to: 72, height: 240 })
    },
    step(s, n) {
      const kb = this.kb
      const intervals = [
        [48, 49, '1 semitone'],
        [52, 53, '1 semitone'],
        [60, 62, '1 tone'],
      ].slice(0, n + 1)
      kb.clear()
      kb.mark(intervals.map(([a]) => a), 'root')
      kb.mark(intervals.map(([, b]) => b), 'chord')
      kb.arcs(intervals, 'var(--ink)', false)
    },
  })

  // Chords: compare C, F, and D major with their minor equivalents.
  Deck.register('chords', {
    init(s) {
      this.out = q(s, '.readout')
      this.kb = new M.Keyboard(q(s, '.kbd-host'), { from: 48, to: 76, height: 240 })
      this.run = M.runner()
      document.addEventListener('names-changed', () => this.show(this.root, this.minor, this.intervals, false))
    },
    async show(root, minor, intervals, sound) {
      this.root = root
      this.minor = minor
      this.intervals = intervals
      const token = this.run.start()
      const kb = this.kb
      const notes = M.triad(root, minor)
      const [a, b, c] = notes
      kb.clear()
      kb.clearArcs()
      kb.mark([b, c], 'chord')
      kb.mark([a], 'root')
      if (intervals) {
        kb.arcs([
          [a, b, `+${b - a}`],
          [b, c, `+${c - b}`],
        ])
      }
      const flat = minor ? [3, 8, 10, 5, 0, 7, 2].includes(M.pc(a)) : [5, 10, 3, 8, 1].includes(M.pc(a))
      this.out.innerHTML = `<b>${M.name(a, flat)} ${minor ? 'minor' : 'major'}</b> = ${notes.map(m => M.name(m, flat)).join(' · ')}`
      if (!sound) return
      for (const m of notes) {
        if (!this.run.alive(token)) return
        kb.flash(m)
        M.play(m, { dur: 0.9 })
        await M.sleep(220)
      }
      await M.sleep(100)
      if (!this.run.alive(token)) return
      notes.forEach(m => kb.flash(m))
      M.chord(notes, { dur: 2 })
    },
    step(s, n) {
      const examples = [
        [48, false],
        [48, false],
        [53, false],
        [62, false],
        [48, true],
        [53, true],
        [62, true],
      ]
      const [root, minor] = examples[n]
      this.show(root, minor, n >= 1, n !== 1)
    },
    leave() {
      this.run.stop()
    },
  })

  // Scales: one formula, then the minor scale from the same white keys.
  Deck.register('scale', {
    init(s) {
      this.out = q(s, '.readout')
      this.minor = false
      this.root = 60
      this.run = M.runner()
      this.kb = new M.Keyboard(q(s, '.kbd-host'), {
        from: 48,
        to: 84,
        height: 230,
        onPlay: (m) => {
          if (Deck.step >= 3 && m <= 72) this.show(m, true)
        },
      })
      s.querySelectorAll('[data-q] button').forEach((b) =>
        b.addEventListener('click', () => {
          this.minor = b.dataset.v === 'minor'
          this.show(this.root, true)
        }),
      )
    },
    async show(root, sound) {
      this.root = root
      const t = this.run.start()
      const kb = this.kb
      const steps = this.minor ? M.MINOR : M.MAJOR
      const notes = M.scale(root, steps)
      Deck.current.querySelectorAll('[data-q] button').forEach((x) => x.classList.toggle('on', (x.dataset.v === 'minor') === this.minor))
      const flat = this.minor ? [3, 8, 10, 5, 0, 7, 2].includes(M.pc(root)) : [5, 10, 3, 8, 1].includes(M.pc(root))
      this.out.innerHTML = `<b>${M.name(root, flat)} ${this.minor ? 'minor' : 'major'}</b>: ${notes
        .slice(0, 7)
        .map((m) => M.name(m, flat))
        .join(' ')}`
      kb.clear()
      kb.clearArcs()
      kb.keys[root].classList.add('root')
      const pairs = notes.slice(1).map((m, i) => [notes[i], m, String(steps[i])])
      kb.arcs(pairs, 'var(--ink-soft)')
      for (let i = 0; i < notes.length; i++) {
        if (!this.run.alive(t)) return
        kb.keys[notes[i]].classList.add(i === 0 || i === 7 ? 'root' : 'scale')
        if (sound) M.play(notes[i], { dur: 0.9 })
        kb.flash(notes[i])
        await M.sleep(280)
      }
    },
    step(s, n) {
      if (n === 0) {
        this.minor = false
        this.show(60, true)
      }
      if (n === 1) {
        this.minor = false
        this.show(55, true)
      }
      if (n === 2) {
        this.minor = true
        this.show(57, true)
      }
      if (n === 3) {
        this.minor = true
        this.show(55, true)
      }
    },
    leave() {
      this.run.stop()
    },
  })

  // Chords inside the key: take one, skip one.
  const DEG = [
    { r: 0, q: '', roman: 'I' },
    { r: 2, q: 'm', roman: 'ii' },
    { r: 4, q: 'm', roman: 'iii' },
    { r: 5, q: '', roman: 'IV' },
    { r: 7, q: '', roman: 'V' },
    { r: 9, q: 'm', roman: 'vi' },
    { r: 11, q: '°', roman: 'vii°' },
  ]
  const white = (i) => {
    const s = M.scale(48, M.MAJOR).slice(0, 7)
    return s[i % 7] + 12 * Math.floor(i / 7)
  }
  const degTriad = (i) => [white(i), white(i + 2), white(i + 4)]

  Deck.register('diatonic', {
    init(s) {
      this.kb = new M.Keyboard(q(s, '.kbd-host'), { from: 48, to: 77, height: 220 })
      this.cards = [...s.querySelectorAll('.dcard')]
      this.run = M.runner()
      this.cards.forEach((c, i) => c.addEventListener('click', () => this.light(i, true)))
    },
    light(i, sound) {
      const kb = this.kb
      const tri = degTriad(i)
      kb.clear()
      kb.mark(tri.slice(1), 'chord')
      kb.keys[tri[0]].classList.add('root')
      kb.arcs([
        [tri[0], tri[1], `+${tri[1] - tri[0]}`],
        [tri[1], tri[2], `+${tri[2] - tri[1]}`],
      ])
      this.cards.forEach((c, k) => c.classList.toggle('lit', k === i))
      if (sound) M.chord(tri, { dur: 1.6 })
    },
    async step(s, n) {
      const t = this.run.start()
      this.cards.forEach((c) => c.classList.remove('shown', 'lit', 'reveal'))
      this.kb.clear()
      this.kb.clearArcs()
      if (n === 0) return
      const delay = document.documentElement.classList.contains('shot') ? 0 : 1500
      for (let i = 0; i < this.cards.length; i++) {
        if (!this.run.alive(t)) return
        this.cards[i].classList.add('shown')
        this.light(i, true)
        await M.sleep(delay)
      }
    },
    leave() {
      this.run.stop()
    },
  })

  // Jam: sustained piano chords, quiet pads, and soft drums below the melody.
  Deck.register('jam', {
    init(s) {
      this.kb = new M.Keyboard(q(s, '.kbd-host'), { from: 48, to: 84, height: 230, base: 60 })
      this.cards = [...s.querySelectorAll('.jcard')]
      this.key = 0
      this.bpm = 108
      this.playing = false
      this.bar = 0
      this.visualTimers = new Set()
      this.btn = q(s, '[data-act=play]')
      this.btn.onclick = () => (this.playing ? this.stop() : this.start())
      s.querySelectorAll('[data-key] button').forEach(b => b.addEventListener('click', () => {
        this.key = +b.dataset.v
        s.querySelectorAll('[data-key] button').forEach(x => x.classList.toggle('on', x === b))
        this.paint()
      }))
      const tempo = q(s, 'input[type=range]')
      tempo.addEventListener('input', () => (this.bpm = +tempo.value))
      this.paint()
    },
    prog() {
      const root = 48 + this.key
      return [
        { root, minor: false },
        { root: root + 7, minor: false },
        { root: root + 9, minor: true },
        { root: root + 5, minor: false },
      ]
    },
    voicing(chord) {
      // Inversions keep every accompaniment note inside C3–B3.
      return M.triad(chord.root, chord.minor).map(note => 48 + M.pc(note)).sort((a, b) => a - b)
    },
    paint() {
      this.kb.clear()
      const flat = [5, 10, 3, 8, 1].includes(M.pc(this.key))
      this.prog().forEach((chord, i) => {
        this.cards[i].querySelector('.nm').textContent = M.name(chord.root, flat) + (chord.minor ? 'm' : '')
      })
    },
    at(time, action) {
      const timer = setTimeout(() => {
        this.visualTimers.delete(timer)
        if (this.playing) action()
      }, Math.max(0, (time - this.band.now) * 1000))
      this.visualTimers.add(timer)
    },
    tick() {
      if (!this.playing) return
      if (this.nextBeat < this.band.now - 0.1) this.nextBeat = this.band.now + 0.02
      // Schedule against the audio clock so timer jitter does not shift each beat.
      while (this.nextBeat < this.band.now + 0.12) {
        const beat = this.pulse % 4
        const bar = Math.floor(this.pulse / 4)
        const i = bar % 4
        const notes = this.voicing(this.prog()[i])
        const duration = 60 / this.bpm
        const time = this.nextBeat
        const sustain = this.band.beat(notes, beat, time, duration)
        if (sustain) {
          const highlight = this.pulse
          this.at(time, () => {
            this.activeHighlight = highlight
            this.bar = bar
            this.kb.mark(notes, 'chord')
            this.cards.forEach((card, k) => card.classList.toggle('lit', k === i))
          })
          this.at(time + sustain, () => {
            if (this.activeHighlight === highlight) this.kb.clear('chord')
          })
        }
        this.nextBeat += duration
        this.pulse++
      }
      this.timer = setTimeout(() => this.tick(), 25)
    },
    start() {
      if (Deck.muted || this.playing) return
      this.band = M.createBand()
      if (!this.band) return
      this.playing = true
      this.bar = 0
      this.pulse = 0
      this.nextBeat = this.band.now + 0.04
      this.btn.textContent = 'Stop Jam'
      this.btn.classList.add('primary')
      this.tick()
    },
    stop() {
      this.playing = false
      clearTimeout(this.timer)
      this.visualTimers.forEach(timer => clearTimeout(timer))
      this.visualTimers.clear()
      if (this.band) this.band.stop()
      this.band = null
      this.btn.textContent = 'Start Jam'
      this.btn.classList.remove('primary')
      this.cards.forEach(card => card.classList.remove('lit'))
      this.paint()
    },
    leave() {
      this.stop()
    },
  })
})()
