// ChromaBoost – webbplatsen. Före/efter-spelaren ritar samma video två gånger i WebGL: vänster om linjen med
// ChromaBoosts mättnad (samma matte som appen: luminans enligt Rec. 709), höger som originalet. En video, en ruta –
// så sidorna är alltid i exakt samma bild.
(() => {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), canvas = $('canvas'), video = $('video'), poster = $('poster');
  const handle = $('handle'), divider = $('divider'), slider = $('strength');
  const output = $('strengthValue'), tagValue = $('tagValue');

  let split = 0.5;          // 0–1, var linjen står
  let saturation = 2.2;     // 1 = original
  let visible = true;

  // ---------------------------------------------------------------- WebGL
  const gl = canvas.getContext('webgl', { premultipliedAlpha: false, antialias: false });
  let program, uSat, uSplit, texture;

  if (gl) {
    const vs = `attribute vec2 p; varying vec2 uv;
      void main() { uv = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p, 0., 1.); }`;
    const fs = `precision mediump float; varying vec2 uv; uniform sampler2D t; uniform float sat; uniform float split;
      void main() {
        vec3 c = texture2D(t, uv).rgb;
        float l = dot(c, vec3(.2126, .7152, .0722));
        vec3 boosted = clamp(mix(vec3(l), c, sat), 0., 1.);
        gl_FragColor = vec4(uv.x < split ? boosted : c, 1.);
      }`;
    const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(program);
    gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const p = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(p);
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
    uSat = gl.getUniformLocation(program, 'sat');
    uSplit = gl.getUniformLocation(program, 'split');
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  } else {
    // Ingen WebGL: visa videon själv med CSS-mättnad (utan delning).
    canvas.hidden = true;
    video.hidden = false;
    divider.hidden = true;
  }

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(stage.clientWidth * dpr), h = Math.round(stage.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  function draw() {
    if (!gl || video.readyState < 2) return;
    resize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
    gl.uniform1f(uSat, saturation);
    gl.uniform1f(uSplit, split);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    stage.classList.add('ready');
  }

  // Varje ny videoruta ritas (requestVideoFrameCallback där det finns, annars varje skärmuppdatering).
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const onFrame = () => { if (visible) draw(); video.requestVideoFrameCallback(onFrame); };
    video.requestVideoFrameCallback(onFrame);
  } else {
    const loop = () => { if (visible && !video.paused) draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  // Spela bara när spelaren syns (sparar batteri och data).
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) video.play().catch(() => {}); else video.pause();
  }, { threshold: 0.1 }).observe(stage);

  // ---------------------------------------------------------------- Klipp
  function loadClip(name, animate) {
    const go = () => {
      poster.style.backgroundImage = stage.style.backgroundImage = `url(media/${name}.jpg)`;
      stage.classList.remove('ready');
      video.src = `media/${name}.mp4`;
      video.play().catch(() => {});
      video.addEventListener('loadeddata', () => { draw(); stage.classList.remove('switching'); }, { once: true });
    };
    if (animate && !reduceMotion) { stage.classList.add('switching'); setTimeout(go, 280); } else go();
  }

  document.querySelectorAll('.clip').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-pressed') === 'true') return;
      document.querySelectorAll('.clip').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      loadClip(button.dataset.clip, true);
    });
  });

  // ---------------------------------------------------------------- Styrka
  function setStrength(percent) {
    saturation = percent / 100;
    output.firstChild.nodeValue = String(percent);
    tagValue.textContent = `${percent} %`;
    slider.style.setProperty('--pos', `${(percent / 300) * 100}%`);
    // Ljuset på sidan följer styrkan, som siffran i appen som lyser mer ju högre mättnad.
    document.documentElement.style.setProperty('--heat', Math.max(0, Math.min(1, (percent - 100) / 200)).toFixed(3));
    if (!gl) video.style.filter = `saturate(${saturation})`;
    draw();
  }
  slider.addEventListener('input', () => setStrength(Number(slider.value)));
  setStrength(Number(slider.value));

  // ---------------------------------------------------------------- Linjen
  function setSplit(value) {
    split = Math.max(0, Math.min(1, value));
    divider.style.left = `${split * 100}%`;
    handle.setAttribute('aria-valuenow', String(Math.round(split * 100)));
    draw();
  }

  let dragging = false;
  const fromEvent = (e) => { const r = stage.getBoundingClientRect(); return (e.clientX - r.left) / r.width; };
  stage.addEventListener('pointerdown', (e) => {
    dragging = true;
    stage.classList.add('dragging', 'touched');
    stage.setPointerCapture(e.pointerId);
    setSplit(fromEvent(e));
  });
  stage.addEventListener('pointermove', (e) => { if (dragging) setSplit(fromEvent(e)); });
  const stop = () => { dragging = false; stage.classList.remove('dragging'); };
  stage.addEventListener('pointerup', stop);
  stage.addEventListener('pointercancel', stop);
  handle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowLeft') { setSplit(split - step); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setSplit(split + step); e.preventDefault(); }
    if (e.key === 'Home') { setSplit(0); e.preventDefault(); }
    if (e.key === 'End') { setSplit(1); e.preventDefault(); }
    stage.classList.add('touched');
  });

  // Första gången spelaren syns: linjen sveper en gång över bilden och stannar i mitten.
  if (!reduceMotion) {
    let swept = false;
    new IntersectionObserver(([entry], observer) => {
      if (!entry.isIntersecting || swept) return;
      swept = true;
      observer.disconnect();
      const start = performance.now() + 1500, duration = 2200;
      const ease = (t) => 1 - Math.pow(1 - t, 3);
      const tick = (now) => {
        if (stage.classList.contains('touched')) return;
        const t = Math.max(0, Math.min(1, (now - start) / duration));
        // 0,5 → 0,82 → 0,18 → 0,5
        const path = t < 0.3 ? 0.5 + 0.32 * ease(t / 0.3)
          : t < 0.7 ? 0.82 - 0.64 * ease((t - 0.3) / 0.4)
          : 0.18 + 0.32 * ease((t - 0.7) / 0.3);
        setSplit(path);
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.6 }).observe(stage);
  }

  addEventListener('resize', draw);
  loadClip('clip2', false);

  // ---------------------------------------------------------------- Sidan
  const nav = $('nav');
  addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 8), { passive: true });

  const reveal = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); reveal.unobserve(e.target); } });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.reveal').forEach((el) => reveal.observe(el));

  // Ljuset i funktionskorten följer musen.
  document.querySelectorAll('.feature').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  });

  $('downloadButton').addEventListener('click', (e) => {
    if ($('downloadButton').getAttribute('aria-disabled') === 'true') e.preventDefault();
  });
})();
