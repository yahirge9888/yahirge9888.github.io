(() => {
  const NS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);
  const svg = $("map");
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    if (parent) parent.appendChild(n);
    return n;
  };

  let activeCat = "all";
  let selected = null;

  // ---------- Dibujo del croquis ----------
  const VB = { w: 1024, h: 580 };
  const viewport = el("g", { id: "viewport" }, svg);

  // Patrón rayado para estacionamientos
  const defs = el("defs", {}, svg);
  const pat = el("pattern", { id: "hatch", width: 8, height: 8, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
  el("line", { x1: 0, y1: 0, x2: 0, y2: 8, class: "hatch-line" }, pat);

  el("rect", { x: -400, y: -300, width: VB.w + 800, height: VB.h + 600, class: "ground" }, viewport);

  // Zonas de estacionamiento (rayadas)
  ["0,130 118,130 112,360 0,360", "752,128 884,160 884,205 752,170"].forEach((pts) =>
    el("polygon", { points: pts, fill: "url(#hatch)", class: "parking-zone" }, viewport));

  // Calles (trazos gruesos)
  const road = (d, w, cls = "road") => el("path", { d, class: cls, "stroke-width": w }, viewport);
  road("M -40,62 L 230,68 C 450,72 650,95 760,150 C 850,195 905,240 912,320 L 918,560", 26);
  road("M -40,542 C 200,534 500,540 940,528", 22);
  road("M 152,60 L 95,540", 22);
  road("M 235,60 L 190,540", 22);
  road("M 300,345 L 287,532", 9);
  road("M 690,100 L 745,150", 10);

  // Nombres de calles
  [[128, 300], [213, 300]].forEach(([x, y]) => {
    const t = el("text", { x, y, class: "road-name", transform: `rotate(-84 ${x} ${y})` }, viewport);
    t.textContent = "Universidad";
  });

  // Edificios de contexto
  BG_BUILDINGS.forEach((pts) => el("polygon", { points: pts, class: "bg-building" }, viewport));

  const routeLayer = el("g", {}, viewport);
  const buildingEls = {};

  const addLabel = (parent, text, x, y, cls, anchor = "middle") => {
    const t = el("text", { x, y, class: cls, "text-anchor": anchor }, parent);
    text.split("\n").forEach((line, i) => {
      const s = el("tspan", { x, dy: i === 0 ? 0 : 15 }, t);
      s.textContent = line;
    });
  };

  PLACES.forEach((p) => {
    const color = CATEGORIES[p.cat].color;
    const g = el("g", { class: "building", style: `--c:${color}`, tabindex: 0, role: "button", "aria-label": p.name }, viewport);
    if (p.kind === "poly") {
      el("polygon", { points: p.points, class: "shape", fill: color, stroke: color }, g);
      addLabel(g, p.label, p.labelPos[0], p.labelPos[1], "lbl");
    } else {
      const [x, y] = p.door;
      el("circle", { cx: x, cy: y, r: 11, class: "shape pin", fill: color, stroke: color }, g);
      el("text", { x, y: y + 4, class: "pin-icon" }, g).textContent = p.cat === "estacionamiento" ? "P" : (p.id === "biblioteca" ? "B" : "★");
      const off = p.labelOffset || [18, 4];
      addLabel(g, p.label, x + off[0], y + off[1], "lbl pin-lbl", p.anchor || "start");
    }
    g.addEventListener("click", (e) => { e.stopPropagation(); select(p.id); });
    g.addEventListener("keydown", (e) => { if (e.key === "Enter") select(p.id); });
    buildingEls[p.id] = g;
  });

  const [ex, ey] = NODES[ENTRANCE.link];
  const ent = el("g", { class: "entrance" }, viewport);
  el("circle", { cx: ex, cy: ey, r: 8 }, ent);
  el("circle", { cx: ex, cy: ey, r: 8, class: "pulse" }, ent);
  el("text", { x: ex + 14, y: ey + 4, "text-anchor": "start" }, ent).textContent = "Entrada";

  // ---------- Pan y zoom ----------
  let view = { x: 0, y: 0, k: 1 };
  const applyView = () => viewport.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.k})`);
  const zoomAt = (factor, cx = 512, cy = 290) => {
    const k = Math.min(3, Math.max(0.6, view.k * factor));
    view.x = cx - ((cx - view.x) / view.k) * k;
    view.y = cy - ((cy - view.y) / view.k) * k;
    view.k = k;
    applyView();
  };
  $("zoom-in").onclick = () => zoomAt(1.25);
  $("zoom-out").onclick = () => zoomAt(0.8);
  $("zoom-reset").onclick = () => { view = { x: 0, y: 0, k: 1 }; applyView(); };

  const toSvg = (e) => {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  };
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const p = toSvg(e);
    zoomAt(e.deltaY < 0 ? 1.12 : 0.89, p.x, p.y);
  }, { passive: false });

  // Punteros activos (mouse o dedos) para arrastrar con 1 y pellizcar con 2
  const pointers = new Map();
  let drag = null, pinch = null, moved = false;
  const pinchInfo = () => {
    const [a, b] = [...pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  };
  svg.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    if (pointers.size === 1) {
      drag = { p: toSvg(e), x: view.x, y: view.y, sx: e.clientX, sy: e.clientY };
      svg.classList.add("dragging");
    } else if (pointers.size === 2) {
      drag = null;
      const i = pinchInfo();
      pinch = { d: i.d, k: view.k };
    }
  });
  window.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const i = pinchInfo();
      const c = toSvg({ clientX: i.cx, clientY: i.cy });
      const target = Math.min(3, Math.max(0.6, pinch.k * (i.d / pinch.d)));
      zoomAt(target / view.k, c.x, c.y);
      moved = true;
      return;
    }
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) moved = true;
    if (!moved) return;
    const p = toSvg(e);
    view.x = drag.x + (p.x - drag.p.x);
    view.y = drag.y + (p.y - drag.p.y);
    applyView();
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) { drag = null; svg.classList.remove("dragging"); }
    else if (pointers.size === 1) {
      const [only] = pointers.values();
      drag = { p: toSvg({ clientX: only.x, clientY: only.y }), x: view.x, y: view.y, sx: only.x, sy: only.y };
    }
  };
  window.addEventListener("pointerup", endPointer);
  window.addEventListener("pointercancel", endPointer);
  // Si hubo arrastre, no abrir el lugar sobre el que terminó el gesto
  svg.addEventListener("click", (e) => { if (moved) { e.stopPropagation(); moved = false; } }, true);

  // ---------- Filtros y lista ----------
  const filters = $("filters");
  const addChip = (key, label, color) => {
    const b = document.createElement("button");
    b.className = "chip" + (key === activeCat ? " active" : "");
    b.innerHTML = (color ? `<i style="background:${color}"></i>` : "") + label;
    b.onclick = () => { activeCat = key; render(); };
    b.dataset.key = key;
    filters.appendChild(b);
  };
  addChip("all", "Todos");
  Object.entries(CATEGORIES).forEach(([k, c]) => addChip(k, c.label, c.color));

  function render() {
    filters.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.key === activeCat));
    const list = $("place-list");
    list.innerHTML = "";
    PLACES.forEach((p) => {
      const visible = activeCat === "all" || p.cat === activeCat;
      buildingEls[p.id].classList.toggle("dim", !visible);
      buildingEls[p.id].classList.toggle("active", selected === p.id);
      if (!visible) return;
      const li = document.createElement("li");
      li.className = "place-item" + (selected === p.id ? " active" : "");
      li.innerHTML = `<i class="place-dot" style="background:${CATEGORIES[p.cat].color}"></i>
        <div><strong>${p.name}</strong><span>${CATEGORIES[p.cat].label} · ${p.hours}</span></div>`;
      li.onclick = () => select(p.id);
      list.appendChild(li);
    });
  }

  // ---------- Selección e info ----------
  function select(id) {
    closeDrawer();
    selected = id;
    const p = PLACES.find((x) => x.id === id);
    const cat = CATEGORIES[p.cat];
    $("info-tag").textContent = cat.label;
    $("info-tag").style.background = cat.color;
    $("info-name").textContent = p.name;
    $("info-desc").textContent = p.desc;
    $("info-hours").textContent = p.hours;
    $("info-includes").textContent = p.includes;
    $("route-note").hidden = true;
    $("info-card").hidden = false;
    routeLayer.innerHTML = "";
    render();
  }
  $("info-close").onclick = () => { selected = null; $("info-card").hidden = true; routeLayer.innerHTML = ""; render(); };

  // ---------- Ruta ----------
  const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function shortestPath(from, to) {
    const adj = {};
    Object.keys(NODES).forEach((n) => (adj[n] = []));
    EDGES.forEach(([a, b]) => { const d = dist2(NODES[a], NODES[b]); adj[a].push([b, d]); adj[b].push([a, d]); });
    const D = {}, prev = {}, todo = new Set(Object.keys(NODES));
    Object.keys(NODES).forEach((n) => (D[n] = Infinity));
    D[from] = 0;
    while (todo.size) {
      let u = null;
      todo.forEach((n) => { if (u === null || D[n] < D[u]) u = n; });
      todo.delete(u);
      if (u === to) break;
      adj[u].forEach(([v, d]) => { if (D[u] + d < D[v]) { D[v] = D[u] + d; prev[v] = u; } });
    }
    const path = [];
    for (let n = to; n; n = prev[n]) path.unshift(n);
    return path;
  }

  $("route-btn").onclick = () => {
    const p = PLACES.find((x) => x.id === selected);
    const nodes = shortestPath(ENTRANCE.link, p.link);
    const pts = [];
    if (userPos) {
      // Desde la ubicación actual: nodo de calle más cercano a la persona
      const start = Object.keys(NODES).reduce((a, b) => (dist2(NODES[a], userPos) < dist2(NODES[b], userPos) ? a : b));
      pts.push(userPos, ...shortestPath(start, p.link).map((n) => NODES[n]));
    } else {
      pts.push(...nodes.map((n) => NODES[n]));
    }
    pts.push(p.door);
    routeLayer.innerHTML = "";
    el("polyline", { points: pts.map((q) => q.join(",")).join(" "), class: "route" }, routeLayer);
    const px = pts.slice(1).reduce((s, q, i) => s + dist2(q, pts[i]), 0);
    const meters = Math.round(px * 0.36); // escala aprox.: 20 m ≈ 55 px
    const note = $("route-note");
    note.hidden = false;
    note.textContent = `≈ ${meters} m · ${Math.max(1, Math.round(meters / 80))} min caminando (estimado)`;
  };

  // ---------- Panel de lugares en móvil (cajón inferior) ----------
  const sidebar = $("sidebar"), listToggle = $("list-toggle");
  function closeDrawer() { sidebar.classList.remove("open"); listToggle.setAttribute("aria-expanded", "false"); }
  listToggle.onclick = () => {
    const open = sidebar.classList.toggle("open");
    listToggle.setAttribute("aria-expanded", String(open));
  };
  $("drawer-close").onclick = closeDrawer;

  // ---------- Mi ubicación (Geolocation API) ----------
  let userPos = null, watchId = null, centered = false;
  const userLayer = el("g", { class: "user-layer" }, viewport);
  const locateBtn = $("locate-btn"), toast = $("toast");
  const simParam = new URLSearchParams(location.search).get("sim"); // ?sim=lat,lon para pruebas

  function showToast(msg, ms = 4000) {
    toast.textContent = msg; toast.hidden = false;
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => (toast.hidden = true), ms);
  }
  function geoToMap(lat, lon) {
    const mLat = (lat - GEO.lat0) * 111320;
    const mLon = (lon - GEO.lon0) * 111320 * Math.cos((GEO.lat0 * Math.PI) / 180);
    return [GEO.x0 + mLon / GEO.mPerPx, GEO.y0 - mLat / GEO.mPerPx];
  }
  function updateRouteLabel() {
    $("route-btn").textContent = userPos ? "Cómo llegar desde mi ubicación" : "Cómo llegar desde la entrada";
  }
  function onPosition(pos) {
    const [x, y] = geoToMap(pos.coords.latitude, pos.coords.longitude);
    const acc = pos.coords.accuracy || 0;
    userLayer.innerHTML = "";
    const inside = x > -150 && x < VB.w + 150 && y > -100 && y < VB.h + 100;
    if (!inside) {
      userPos = null;
      updateRouteLabel();
      showToast("Parece que estás fuera del campus: no se puede mostrar tu ubicación en el croquis.");
      return;
    }
    userPos = [x, y];
    updateRouteLabel();
    if (acc > 0) el("circle", { cx: x, cy: y, r: Math.max(acc / GEO.mPerPx, 8), class: "user-acc" }, userLayer);
    el("circle", { cx: x, cy: y, r: 9, class: "user-halo" }, userLayer);
    el("circle", { cx: x, cy: y, r: 6, class: "user-dot" }, userLayer);
    if (!centered) {
      centered = true;
      view.k = 1.4; view.x = 512 - x * view.k; view.y = 290 - y * view.k; applyView();
      showToast(`Ubicación encontrada (±${Math.round(acc)} m)`);
    }
  }
  function onGeoError(err) {
    const msgs = {
      1: "Permiso de ubicación denegado. Actívalo en tu navegador para usar esta función.",
      2: "No se pudo determinar tu ubicación.",
      3: "Se agotó el tiempo esperando tu ubicación."
    };
    stopLocating();
    showToast(msgs[err.code] || "Error al obtener la ubicación.", 5000);
  }
  function stopLocating() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null; userPos = null; centered = false;
    userLayer.innerHTML = "";
    locateBtn.classList.remove("active");
    updateRouteLabel();
  }
  locateBtn.onclick = () => {
    if (locateBtn.classList.contains("active")) { stopLocating(); showToast("Ubicación desactivada", 2000); return; }
    locateBtn.classList.add("active");
    if (simParam) {
      const [lat, lon] = simParam.split(",").map(Number);
      onPosition({ coords: { latitude: lat, longitude: lon, accuracy: 12 } });
      return;
    }
    if (!navigator.geolocation) { stopLocating(); showToast("Tu navegador no soporta geolocalización."); return; }
    showToast("Buscando tu ubicación…", 2500);
    watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  };

  // ---------- Buscador ----------
  const input = $("search-input"), results = $("search-results");
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    results.innerHTML = "";
    if (!q) { results.hidden = true; return; }
    const hits = PLACES.filter((p) => (p.name + " " + p.includes).toLowerCase().includes(q));
    hits.forEach((p) => {
      const li = document.createElement("li");
      li.innerHTML = `${p.name}<small>${CATEGORIES[p.cat].label}</small>`;
      li.onclick = () => { select(p.id); input.value = ""; results.hidden = true; };
      results.appendChild(li);
    });
    if (!hits.length) results.innerHTML = "<li><small>Sin resultados</small></li>";
    results.hidden = false;
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".search")) results.hidden = true; });

  render();
})();
