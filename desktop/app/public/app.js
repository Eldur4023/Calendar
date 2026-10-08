/* Calendar — la interfaz de la ventana. Habla con la API local del servicio (../../app.lux) y
   pinta todo desde ahí; la lógica sin DOM (fechas, repeticiones, maquetación) está en logic.js. */
(function () {
  "use strict";
  const L = CalLogic;
  const $ = (id) => document.getElementById(id);
  const TZ = (Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC";
  const COLORS = ["#d97757", "#60a5fa", "#10b981", "#ec4899", "#f5c86a", "#a78bfa", "#ef4444", "#94a3b8"];
  const REMINDERS = [[0, "A la hora"], [5, "5 min antes"], [10, "10 min"], [15, "15 min"], [30, "30 min"], [60, "1 hora"], [1440, "1 día"]];
  const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const DOW = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
  const DOW_LETTER = ["L", "M", "X", "J", "V", "S", "D"];
  const f = {
    monthYear: new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }),
    dayLong: new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    dayMonth: new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" }),
    weekday: new Intl.DateTimeFormat("es-ES", { weekday: "long" }),
    dateTime: new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
  };

  /* ── estado ──────────────────────────────────────────────────────────────── */
  const store = {
    get(k, d) { try { const v = localStorage.getItem("cal." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("cal." + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento: no pasa nada */ } },
  };
  const S = {
    view: store.get("view", "month"), date: new Date(), cals: [], occ: [], items: [], byKey: {}, hidden: store.get("hidden", {}),
    status: null, sel: null, loadSeq: 0, scrollTo: true, edit: null, lastCal: store.get("lastCal", ""),
    alertSince: Date.now(), alertMax: 0, creatingDefault: false, syncing: false,
  };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/-/g, ""); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function api(method, path, body) {
    const opt = { method: method, headers: {} };
    if (body !== undefined) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(
      (r) => r.text().then((t) => { let b = null; try { b = t ? JSON.parse(t) : null; } catch (e) { b = { detail: t }; } return { ok: r.ok, status: r.status, body: b }; }),
      (e) => ({ ok: false, status: 0, body: { detail: String(e) } }));
  }
  function toast(title, text, kind) {
    const t = document.createElement("div");
    t.className = "toast" + (kind ? " " + kind : "");
    t.innerHTML = "<b>" + esc(title) + "</b>" + (text ? esc(text) : "");
    $("toasts").appendChild(t);
    setTimeout(() => t.remove(), 8000);
  }

  /* ── datos ───────────────────────────────────────────────────────────────── */
  const calOf = (id) => S.cals.find((c) => c.id === id);
  function visible(o) { return !S.hidden[o.calendar_id]; }

  function load() {
    const r = L.rangeFor(S.view, S.date), seq = ++S.loadSeq;
    return api("GET", "/api/data?after=" + r.from.getTime() + "&before=" + r.to.getTime()).then((res) => {
      if (seq !== S.loadSeq) return;
      if (!res.ok) { showBanner(res.body && res.body.detail ? res.body.detail : "No se pudo leer el calendario.", true); return; }
      S.status = res.body.status; S.cals = res.body.calendars; S.occ = res.body.occurrences;
      if (S.sel && !S.occ.some((o) => keyOf(o) === S.sel)) S.sel = null;
      ensureDefaultCalendar();
      render();
    });
  }
  const keyOf = (o) => o.id + "@" + o.instance;

  // Un calendario por defecto, una vez hecha la primera sincronización y si el servidor no tiene ninguno.
  function ensureDefaultCalendar() {
    const st = S.status;
    if (!st || !st.configured || S.cals.length || S.creatingDefault || !st.last_sync) return;
    S.creatingDefault = true;
    sendOps([{ op: "cal.put", id: uuid(), name: "Personal", color: COLORS[0], position: 0 }]).then(() => { S.creatingDefault = false; load(); });
  }
  function sendOps(ops) { return api("POST", "/api/ops", { ops: ops }); }

  /* ── pintado ─────────────────────────────────────────────────────────────── */
  function render() {
    const st = S.status;
    const configured = !!(st && st.configured);
    $("onboarding").hidden = configured || !st;
    $("layout").hidden = !configured;
    for (const id of ["nav", "views", "btn-sync", "btn-search", "btn-log"]) $(id).hidden = !configured;
    document.querySelectorAll("#views button").forEach((b) => b.classList.toggle("on", b.dataset.view === S.view));
    renderConn();
    if (!configured) { $("title").textContent = ""; return; }
    $("title").textContent = titleText();
    S.items = S.occ.filter(visible).map((o) => L.norm(o, (calOf(o.calendar_id) || {}).color || COLORS[0])).sort(L.cmpEvents);
    S.byKey = {}; S.items.forEach((n) => { S.byKey[keyOf(n.o)] = n; });
    renderSide();
    const stage = $("stage"), keepTop = stage.scrollTop;
    if (S.view === "month") stage.innerHTML = monthHtml();
    else if (S.view === "week" || S.view === "day") stage.innerHTML = gridHtml(S.view === "week" ? 7 : 1);
    else stage.innerHTML = agendaHtml();
    if (S.view === "week" || S.view === "day") {
      if (S.scrollTo) { const h = L.startOfDay(new Date()).getTime() === L.startOfDay(S.date).getTime() ? Math.max(0, new Date().getHours() - 2) : 7; stage.scrollTop = h * hourPx(); S.scrollTo = false; }
      else stage.scrollTop = keepTop;
    } else if (S.scrollTo) { stage.scrollTop = 0; S.scrollTo = false; }
  }
  const hourPx = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hour")) || 52;

  function titleText() {
    const r = L.rangeFor(S.view, S.date);
    if (S.view === "month") return cap(f.monthYear.format(S.date));
    if (S.view === "day") return cap(f.dayLong.format(S.date));
    if (S.view === "week") {
      const a = r.from, b = L.addDays(r.to, -1);
      return a.getFullYear() === b.getFullYear() ? (a.getDate() + (a.getMonth() === b.getMonth() ? "" : " " + MONTHS_SHORT[a.getMonth()]) + " – " + b.getDate() + " " + MONTHS_SHORT[b.getMonth()] + " " + b.getFullYear())
        : (a.getDate() + " " + MONTHS_SHORT[a.getMonth()] + " " + a.getFullYear() + " – " + b.getDate() + " " + MONTHS_SHORT[b.getMonth()] + " " + b.getFullYear());
    }
    return "Próximos 30 días";
  }

  function renderConn() {
    const st = S.status, el = $("conn");
    if (!st || !st.configured) { el.innerHTML = ""; hideBanner(); return; }
    let cls = st.online ? "on" : "off", txt;
    if (S.syncing) txt = "Sincronizando…";
    else if (!st.online && st.last_error) txt = "Sin conexión" + (st.pending ? " · " + st.pending + " sin enviar" : "");
    else if (st.pending) txt = st.pending + " sin enviar";
    else if (st.last_sync) txt = "Sincronizado " + ago(st.last_sync);
    else txt = "Sin sincronizar aún";
    el.innerHTML = '<span class="dot ' + cls + '"></span><span>' + esc(txt) + "</span>";
    $("btn-sync").classList.toggle("spin", S.syncing);
    if (!st.online && st.last_error) showBanner("No se puede sincronizar: " + st.last_error + ". Los cambios se guardan aquí y se envían al volver la conexión.", false, true);
    else hideBanner();
  }
  // 90 -> "1 h 30 min", 1440 -> "1 día"
  function minutesText(m) {
    if (m < 60) return m + " min";
    if (m < 1440) return Math.floor(m / 60) + " h" + (m % 60 ? " " + (m % 60) + " min" : "");
    return Math.floor(m / 1440) + (m >= 2880 ? " días" : " día") + (m % 1440 ? " " + minutesText(m % 1440) : "");
  }
  function ago(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 45) return "ahora mismo";
    if (s < 3600) return "hace " + Math.round(s / 60) + " min";
    if (s < 86400) return "hace " + Math.round(s / 3600) + " h";
    return "hace " + Math.round(s / 86400) + " d";
  }
  function showBanner(text, isErr, retry) {
    const b = $("banner");
    b.className = "banner" + (isErr ? " err" : "");
    b.innerHTML = esc(text) + (retry ? ' <button id="banner-retry">Reintentar</button>' : "");
    b.hidden = false;
    const r = $("banner-retry"); if (r) r.onclick = syncNow;
  }
  function hideBanner() { $("banner").hidden = true; }

  /* barra lateral: mini-calendario y calendarios */
  function renderSide() {
    const first = new Date(S.date.getFullYear(), S.date.getMonth(), 1), start = L.startOfWeek(first), today = new Date();
    const wk = L.rangeFor("week", S.date);
    let h = '<div class="mh"><span>' + esc(cap(f.monthYear.format(first))) + '</span><span><button class="ghost icon sm" data-mini="-1" title="Mes anterior"><svg class="ico"><use href="#i-prev"/></svg></button><button class="ghost icon sm" data-mini="1" title="Mes siguiente"><svg class="ico"><use href="#i-next"/></svg></button></span></div><table><tr>';
    DOW_LETTER.forEach((d) => { h += "<th>" + d + "</th>"; });
    h += "</tr>";
    for (let w = 0; w < 6; w++) {
      h += "<tr>";
      for (let d = 0; d < 7; d++) {
        const day = L.addDays(start, w * 7 + d);
        const cls = [day.getMonth() !== first.getMonth() ? "out" : "", L.sameDay(day, today) ? "today" : "", L.sameDay(day, S.date) ? "sel" : "",
          S.view === "week" && day >= wk.from && day < wk.to ? "week" : ""].join(" ");
        h += '<td class="' + cls + '"><span data-go="' + L.ymd(day) + '">' + day.getDate() + "</span></td>";
      }
      h += "</tr>";
    }
    $("mini").innerHTML = h + "</table>";
    $("cals").innerHTML = S.cals.length ? S.cals.map((c) =>
      '<li data-cal="' + esc(c.id) + '" class="' + (S.hidden[c.id] ? "off" : "") + '" style="--c:' + esc(c.color) + '"><span class="sw"></span><span class="nm">' + esc(c.name) +
      '</span><button class="ghost icon sm ed" data-editcal="' + esc(c.id) + '" title="Editar"><svg class="ico"><use href="#i-edit"/></svg></button></li>').join("")
      : '<li class="empty">Aún no hay calendarios</li>';
  }

  /* chips (mes, todo el día, agenda) */
  function chip(n) {
    const o = n.o, k = keyOf(o);
    const cls = "chip " + (n.allDay ? "allday" : "timed") + (S.sel === k ? " sel" : "") + (o.dirty ? " dirty" : "");
    return '<div class="' + cls + '" data-k="' + esc(k) + '" style="--c:' + esc(n.color) + '" title="' + esc(tip(n)) + '">' +
      (n.allDay ? "" : '<span class="t">' + L.hm(n.start) + "</span>") + '<span class="n">' + esc(o.title || "(sin título)") + "</span></div>";
  }
  function tip(n) {
    const o = n.o;
    return (o.title || "(sin título)") + "\n" + (n.allDay ? "Todo el día" : L.hm(n.start) + " – " + L.hm(n.end)) + (o.location ? "\n" + o.location : "") + (o.recurring || o.master_id ? "\nPeriódico" : "");
  }

  function monthHtml() {
    const r = L.rangeFor("month", S.date), today = new Date();
    let h = '<div class="month"><div class="dow">';
    DOW.forEach((d) => { h += "<div>" + d + "</div>"; });
    h += '</div><div class="grid">';
    for (let i = 0; i < 42; i++) {
      const day = L.addDays(r.from, i), list = S.items.filter((n) => L.touchesDay(n, day));
      const cls = "cell" + (day.getMonth() !== S.date.getMonth() ? " out" : "") + (L.sameDay(day, today) ? " today" : "");
      h += '<div class="' + cls + '" data-d="' + L.ymd(day) + '"><span class="dn" data-day="' + L.ymd(day) + '">' + (day.getDate() === 1 ? day.getDate() + " " + MONTHS_SHORT[day.getMonth()] : day.getDate()) + "</span>";
      list.slice(0, 3).forEach((n) => { h += chip(n); });
      if (list.length > 3) h += '<div class="more" data-day="' + L.ymd(day) + '">+' + (list.length - 3) + " más</div>";
      h += "</div>";
    }
    return h + "</div></div>";
  }

  function gridHtml(cols) {
    const r = L.rangeFor(S.view, S.date), today = new Date(), px = hourPx();
    const days = []; for (let i = 0; i < cols; i++) days.push(L.addDays(r.from, i));
    let h = '<div class="tg" style="--cols:' + cols + '"><div class="tg-head"><div class="tg-row tg-days"><div></div>';
    days.forEach((d) => {
      h += '<div class="' + (L.sameDay(d, today) ? "today" : "") + '" data-day="' + L.ymd(d) + '"><div class="dw">' + DOW[L.weekday(d)] + '</div><div class="dd">' + d.getDate() + "</div></div>";
    });
    h += '</div><div class="tg-row tg-allday"><div class="lbl">todo el día</div>';
    days.forEach((d) => { h += "<div>" + S.items.filter((n) => n.allDay && L.touchesDay(n, d)).map(chip).join("") + "</div>"; });
    h += '</div></div><div class="tg-body"><div class="tg-hours">';
    for (let i = 0; i < 24; i++) h += "<div>" + L.pad(i) + ":00</div>";
    h += "</div>";
    days.forEach((d) => {
      const isToday = L.sameDay(d, today);
      h += '<div class="tg-col' + (isToday ? " today" : "") + '" data-d="' + L.ymd(d) + '">';
      L.layoutDay(S.items.filter((n) => !n.allDay && L.touchesDay(n, d)), d, px).forEach((s) => {
        const o = s.n.o, k = keyOf(o), w = 100 / s.cols;
        h += '<div class="ev' + (S.sel === k ? " sel" : "") + (o.dirty ? " dirty" : "") + '" data-k="' + esc(k) + '" style="--c:' + esc(s.n.color) + ";top:" + s.top + "px;height:" + s.height + "px;left:calc(" + (s.col * w) + "% + 2px);width:calc(" + w + '% - 4px)" title="' + esc(tip(s.n)) + '">' +
          "<b>" + esc(o.title || "(sin título)") + '</b><span class="t">' + L.hm(s.n.start) + (s.height > 36 ? " – " + L.hm(s.n.end) : "") + "</span></div>";
      });
      if (isToday) h += '<div class="now" style="top:' + ((today.getHours() * 60 + today.getMinutes()) / 60 * px) + 'px"></div>';
      h += "</div>";
    });
    return h + "</div></div>";
  }

  function agendaHtml() {
    const r = L.rangeFor("agenda", S.date), today = new Date();
    let h = '<div class="agenda">', any = false;
    for (let i = 0; i < 30; i++) {
      const day = L.addDays(r.from, i), list = S.items.filter((n) => L.touchesDay(n, day));
      if (!list.length) continue;
      any = true;
      h += '<div class="day' + (L.sameDay(day, today) ? " today" : "") + '"><div class="when"><b>' + day.getDate() + "</b>" + esc(f.weekday.format(day) + ", " + MONTHS_SHORT[day.getMonth()]) + "</div><div>";
      list.forEach((n) => {
        const o = n.o, k = keyOf(o);
        h += '<div class="item' + (o.dirty ? " dirty" : "") + '" data-k="' + esc(k) + '" style="--c:' + esc(n.color) + '"><span class="t">' + (n.allDay ? "Todo el día" : L.hm(n.start) + " – " + L.hm(n.end)) + '</span><span class="n">' + esc(o.title || "(sin título)") + "</span>" + (o.location ? '<span class="l">' + esc(o.location) + "</span>" : "") + "</div>";
      });
      h += "</div></div>";
    }
    return h + (any ? "" : '<div class="empty-state">No hay eventos en los próximos 30 días.<br><br><button id="agenda-new" class="primary">Nuevo evento</button></div>') + "</div>";
  }

  /* ── navegación ──────────────────────────────────────────────────────────── */
  function go(date, view) {
    S.date = date; if (view) { S.view = view; store.set("view", view); }
    S.scrollTo = true; load();
  }
  function setView(v) { if (v !== S.view) go(S.date, v); }
  function step(dir) { go(L.shiftDate(S.view, S.date, dir)); }

  $("btn-today").onclick = () => go(new Date());
  $("btn-prev").onclick = () => step(-1);
  $("btn-next").onclick = () => step(1);
  document.querySelectorAll("#views button").forEach((b) => { b.onclick = () => setView(b.dataset.view); });

  /* clics de la barra lateral y del escenario (por delegación: se repinta a menudo) */
  $("side").addEventListener("click", (e) => {
    const t = e.target.closest("[data-mini],[data-go],[data-editcal],[data-cal]");
    if (!t) return;
    if (t.dataset.mini) { go(L.addMonths(S.date, +t.dataset.mini)); return; }
    if (t.dataset.go) { S.date = L.parseYmd(t.dataset.go); S.scrollTo = S.view !== "month"; load(); return; }
    if (t.dataset.editcal) { e.stopPropagation(); openCal(calOf(t.dataset.editcal)); return; }
    if (t.dataset.cal) { S.hidden[t.dataset.cal] = !S.hidden[t.dataset.cal]; store.set("hidden", S.hidden); render(); }
  });
  $("btn-new").onclick = () => openEditor(null, defaultStart());
  $("btn-newcal").onclick = () => openCal(null);

  $("stage").addEventListener("click", (e) => {
    const k = e.target.closest("[data-k]");
    if (k) { S.sel = k.dataset.k; const n = S.byKey[S.sel]; if (n) openEditor(n, null); render(); return; }
    if (e.target.id === "agenda-new") { openEditor(null, defaultStart()); return; }
    const more = e.target.closest(".more,.dn,.tg-days [data-day]");
    if (more) { go(L.parseYmd(more.dataset.day), "day"); return; }
    const col = e.target.closest(".tg-col");
    if (col) {
      const y = e.clientY - col.getBoundingClientRect().top, mins = Math.floor(y / hourPx() * 2) * 30;
      const d = L.parseYmd(col.dataset.d); d.setHours(0, mins);
      openEditor(null, d); return;
    }
    const cell = e.target.closest(".cell");
    if (cell) { const d = L.parseYmd(cell.dataset.d); d.setHours(9, 0); openEditor(null, d); }
  });
  function defaultStart() {
    const d = new Date(), base = L.sameDay(S.date, d) || S.view === "agenda" ? d : S.date;
    const r = new Date(base.getFullYear(), base.getMonth(), base.getDate(), L.sameDay(base, d) ? d.getHours() : 9, 0);
    if (L.sameDay(base, d)) r.setHours(d.getHours() + 1, 0);
    return r;
  }

  /* ── diálogos genéricos ──────────────────────────────────────────────────── */
  // Pregunta con hasta dos acciones. Resuelve "a", "b" o null (cancelado).
  function ask(o) {
    return new Promise((resolve) => {
      const dlg = $("dlg-scope"), a = $("scope-this"), b = $("scope-all"), c = $("scope-cancel");
      $("scope-title").textContent = o.title; $("scope-text").textContent = o.text || "";
      a.textContent = o.a; a.className = o.danger ? "danger" : "primary";
      b.hidden = !o.b; b.textContent = o.b || ""; b.className = o.danger ? "danger" : "";
      let out = null;
      a.onclick = () => { out = "a"; dlg.close(); }; b.onclick = () => { out = "b"; dlg.close(); }; c.onclick = () => dlg.close();
      dlg.onclose = () => resolve(out);
      dlg.showModal();
    });
  }
  document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));
  for (const [btn, dlg] of [["search-close", "dlg-search"], ["log-close", "dlg-log"], ["help-close", "dlg-help"], ["acct-close", "dlg-settings"], ["ev-cancel", "dlg-event"], ["cal-cancel", "dlg-cal"]]) $(btn).onclick = () => $(dlg).close();

  /* ── editor de eventos ───────────────────────────────────────────────────── */
  function buildEditorStatics() {
    $("ev-weekdays").innerHTML = DOW_LETTER.map((l, i) => '<label title="' + DOW[i] + '"><input type="checkbox" value="' + i + '">' + l + "</label>").join("");
    $("ev-reminders").innerHTML = REMINDERS.map((r) => '<label><input type="checkbox" value="' + r[0] + '">' + esc(r[1]) + "</label>").join("");
  }
  buildEditorStatics();

  function monthModes(d) {
    const nth = L.nthOfMonth(d), wd = f.weekday.format(d);
    const ord = ["", "primer", "segundo", "tercer", "cuarto", "quinto"][nth.n];
    const opts = [["day", "el día " + d.getDate() + " de cada mes" + (d.getDate() > 28 ? " (los meses sin ese día se saltan)" : "")], ["nth", "el " + ord + " " + wd + " de cada mes"]];
    if (nth.last) opts.push(["last", "el último " + wd + " de cada mes"]);
    opts.push(["lastday", "el último día de cada mes"]);
    return opts;
  }
  function refreshRepeatUi() {
    const freq = $("ev-freq").value, custom = S.edit && S.edit.customRule && !S.edit.ruleTouched;
    $("ev-interval-box").hidden = !freq || custom; $("ev-custom").hidden = !custom;
    $("ev-weekdays").hidden = freq !== "WEEKLY" || custom;
    $("ev-monthly").hidden = freq !== "MONTHLY" || custom;
    $("ev-end-box").hidden = !freq || custom;
    $("ev-interval-unit").textContent = { DAILY: "días", WEEKLY: "semanas", MONTHLY: "meses", YEARLY: "años" }[freq] || "";
    const m = $("ev-endmode").value; $("ev-until").hidden = m !== "until"; $("ev-count-box").hidden = m !== "count";
    if (freq === "MONTHLY") {
      const cur = $("ev-monthmode").value, d = L.at($("ev-sd").value, $("ev-st").value);
      $("ev-monthmode").innerHTML = monthModes(d).map((o) => '<option value="' + o[0] + '">' + esc(o[1]) + "</option>").join("");
      if (monthModes(d).some((o) => o[0] === cur)) $("ev-monthmode").value = cur;
    }
  }
  ["ev-freq", "ev-interval", "ev-endmode", "ev-count", "ev-until", "ev-monthmode"].forEach((id) => $(id).addEventListener("input", () => { if (S.edit) S.edit.ruleTouched = true; refreshRepeatUi(); }));
  $("ev-weekdays").addEventListener("input", () => { if (S.edit) S.edit.ruleTouched = true; });
  $("ev-sd").addEventListener("input", () => { refreshRepeatUi(); if ($("ev-ed").value < $("ev-sd").value) $("ev-ed").value = $("ev-sd").value; });
  $("ev-allday").addEventListener("input", () => { const a = $("ev-allday").checked; $("ev-st").hidden = a; $("ev-et").hidden = a; $("ev-st").required = !a; $("ev-et").required = !a; });

  // `src`: una aparición normalizada (editar) o null (nuevo, con `start` como fecha inicial).
  function openEditor(src, start) {
    const isNew = !src, o = src && src.o;
    S.edit = { isNew: isNew, o: o, master: null, customRule: false, ruleTouched: false };
    $("ev-error").hidden = true;
    $("ev-heading").textContent = isNew ? "Nuevo evento" : "Editar evento";
    $("ev-delete").hidden = isNew;
    $("ev-cal").innerHTML = S.cals.map((c) => '<option value="' + esc(c.id) + '">' + esc(c.name) + "</option>").join("");
    if (!S.cals.length) { toast("Sin calendarios", "Crea un calendario antes de añadir eventos.", "warn"); return; }
    let s, e, allDay = false;
    if (isNew) { s = start; e = new Date(s.getTime() + 3600000); }
    else { s = src.start; allDay = src.allDay; e = allDay ? L.addDays(src.end, -1) : src.end; }
    $("ev-title").value = isNew ? "" : o.title;
    $("ev-cal").value = isNew ? (calOf(S.lastCal) ? S.lastCal : S.cals[0].id) : o.calendar_id;
    $("ev-allday").checked = allDay; $("ev-allday").dispatchEvent(new Event("input"));
    $("ev-sd").value = L.ymd(s); $("ev-st").value = L.hm(s); $("ev-ed").value = L.ymd(e); $("ev-et").value = L.hm(e);
    $("ev-loc").value = isNew ? "" : o.location; $("ev-notes").value = isNew ? "" : o.notes;
    const rem = isNew ? [10] : (o.reminders || []);
    document.querySelectorAll("#ev-reminders label.extra").forEach((x) => x.remove());
    rem.forEach((m) => { if (!REMINDERS.some((r) => r[0] === m)) $("ev-reminders").insertAdjacentHTML("beforeend", '<label class="extra"><input type="checkbox" value="' + m + '">' + m + " min</label>"); });
    document.querySelectorAll("#ev-reminders input").forEach((i) => { i.checked = rem.indexOf(+i.value) >= 0; });
    // Repetición: las excepciones de una serie no se repiten.
    const isException = !isNew && !!o.master_id;
    $("ev-repeat-box").hidden = isException;
    setRepeat({ simple: true, freq: "", interval: 1, byday: [], monthMode: "day", endMode: "never", until: "", count: 10 });
    $("dlg-event").showModal();
    $("ev-title").focus();
    if (!isNew && o.recurring) {
      api("GET", "/api/events/" + encodeURIComponent(o.id)).then((r) => {
        if (!r.ok || !S.edit || S.edit.o !== o) return;
        S.edit.master = r.body;
        const ms = r.body.all_day ? L.localDayOfUtc(r.body.start) : new Date(r.body.start);
        const rule = L.parseRule(r.body.rrule || "", ms);
        S.edit.customRule = !rule.simple; S.edit.rawRule = r.body.rrule || "";
        setRepeat(rule.simple ? rule : Object.assign(rule, { freq: (/FREQ=(\w+)/.exec(S.edit.rawRule) || [])[1] || "" }));
        if (!rule.simple) $("ev-freq").value = (/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/.exec(S.edit.rawRule) || [])[1] || "";
        refreshRepeatUi();
      });
    }
  }
  function setRepeat(r) {
    $("ev-freq").value = r.freq || ""; $("ev-interval").value = r.interval || 1;
    document.querySelectorAll("#ev-weekdays input").forEach((i) => { i.checked = r.byday.indexOf(+i.value) >= 0; });
    $("ev-endmode").value = r.endMode; $("ev-until").value = r.until || ""; $("ev-count").value = r.count || 10;
    refreshRepeatUi();
    if (r.freq === "MONTHLY") $("ev-monthmode").value = r.monthMode;
  }

  // Lee el formulario. Devuelve {error} o los campos del evento (la hora, en la zona local).
  function readForm() {
    const allDay = $("ev-allday").checked, sd = $("ev-sd").value, ed = $("ev-ed").value;
    if (!sd || !ed) return { error: "Indica las fechas." };
    const out = { title: $("ev-title").value.trim(), calendar_id: $("ev-cal").value, all_day: allDay, location: $("ev-loc").value.trim(), notes: $("ev-notes").value,
      reminders: Array.from(document.querySelectorAll("#ev-reminders input:checked")).map((i) => +i.value).sort((a, b) => a - b) };
    if (allDay) {
      if (ed < sd) return { error: "El evento no puede acabar antes de empezar." };
      out.start = L.utcMidnight(L.parseYmd(sd)); out.end = L.utcMidnight(L.parseYmd(ed)) + L.DAY; out.tzid = "UTC";
      out.startLocal = L.parseYmd(sd);
    } else {
      const s = L.at(sd, $("ev-st").value), e = L.at(ed, $("ev-et").value);
      if (e < s) return { error: "El evento no puede acabar antes de empezar." };
      out.start = s.getTime(); out.end = e.getTime(); out.tzid = TZ; out.startLocal = s;
    }
    return out;
  }
  function ruleFromForm(startLocal) {
    if (S.edit.customRule && !S.edit.ruleTouched) return S.edit.rawRule;
    return L.buildRule({
      freq: $("ev-freq").value, interval: $("ev-interval").value, monthMode: $("ev-monthmode").value || "day", endMode: $("ev-endmode").value,
      until: $("ev-until").value, count: $("ev-count").value, start: startLocal,
      byday: Array.from(document.querySelectorAll("#ev-weekdays input:checked")).map((i) => +i.value),
    });
  }
  function eventOp(id, v, rule, exdates, masterId) {
    const op = { op: "event.put", id: id, calendar_id: v.calendar_id, title: v.title, location: v.location, notes: v.notes, start: v.start, end: v.end,
      all_day: v.all_day, tzid: v.tzid, rrule: rule || "", exdates: exdates || [], reminders: v.reminders };
    if (masterId) op.master_id = masterId;
    return op;
  }
  // Un evento tal como lo devuelve el servicio -> operación para volver a guardarlo.
  function opFromView(m, over) {
    return Object.assign({ op: "event.put", id: m.id, calendar_id: m.calendar_id, title: m.title, location: m.location, notes: m.notes, start: m.start, end: m.end,
      all_day: m.all_day, tzid: m.tzid, rrule: m.rrule || "", exdates: m.exdates || [], reminders: m.reminders || [] }, over || {});
  }

  $("form-event").addEventListener("submit", (e) => { e.preventDefault(); saveEvent(); });
  function fail(msg) { const el = $("ev-error"); el.textContent = msg; el.hidden = false; }

  async function saveEvent() {
    const ed = S.edit, v = readForm();
    if (v.error) { fail(v.error); return; }
    S.lastCal = v.calendar_id; store.set("lastCal", S.lastCal);
    let ops;
    if (ed.isNew) {
      ops = [eventOp(uuid(), v, ruleFromForm(v.startLocal))];
    } else if (ed.o.master_id) {
      ops = [eventOp(ed.o.id, v, "", ed.o.exdates, ed.o.master_id)];
    } else if (!ed.o.recurring) {
      ops = [eventOp(ed.o.id, v, ruleFromForm(v.startLocal), ed.o.exdates)];
    } else {
      if (!ed.master) { fail("Cargando la serie… inténtalo de nuevo."); return; }
      const scope = await ask({ title: "Evento periódico", text: "¿Qué eventos quieres cambiar?", a: "Solo este evento", b: "Todos los eventos de la serie" });
      if (!scope) return;
      const m = ed.master;
      if (scope === "a") {
        // Una excepción propia para esta aparición, y la serie la salta.
        ops = [eventOp(uuid(), v, "", [], m.id), opFromView(m, { exdates: (m.exdates || []).concat([ed.o.instance]) })];
      } else {
        // Se mueve la serie lo mismo que se haya movido esta aparición (en hora de pared local).
        const oldS = ed.o.all_day ? L.localDayOfUtc(ed.o.instance) : new Date(ed.o.instance);
        const dDays = Math.round((Date.UTC(v.startLocal.getFullYear(), v.startLocal.getMonth(), v.startLocal.getDate()) - Date.UTC(oldS.getFullYear(), oldS.getMonth(), oldS.getDate())) / L.DAY);
        const dMin = (v.startLocal.getHours() * 60 + v.startLocal.getMinutes()) - (oldS.getHours() * 60 + oldS.getMinutes());
        const mLocal = m.all_day ? L.localDayOfUtc(m.start) : new Date(m.start);
        const newLocal = new Date(mLocal.getFullYear(), mLocal.getMonth(), mLocal.getDate() + dDays, mLocal.getHours(), mLocal.getMinutes() + dMin);
        const dur = v.end - v.start;
        const mv = Object.assign({}, v);
        mv.start = v.all_day ? L.utcMidnight(newLocal) : newLocal.getTime(); mv.end = mv.start + dur;
        const shift = mv.start - m.start;
        ops = [eventOp(m.id, mv, ruleFromForm(newLocal), (m.exdates || []).map((x) => x + shift), null)];
      }
    }
    const res = await sendOps(ops);
    const bad = res.ok && res.body.results.find((r) => !r.ok);
    if (!res.ok) { fail(res.body && res.body.detail ? res.body.detail : "No se pudo guardar."); return; }
    if (bad) { fail(bad.error || "El servicio no aceptó el cambio."); return; }
    $("dlg-event").close(); load();
  }

  $("ev-delete").onclick = async () => {
    const ed = S.edit, o = ed.o; let ops;
    if (o.master_id) {
      if (await ask({ title: "Eliminar «" + (o.title || "(sin título)") + "»", text: "Se quita solo este evento de la serie.", a: "Eliminar", danger: true }) !== "a") return;
      ops = [{ op: "event.delete", id: o.id }];
    } else if (!o.recurring) {
      if (await ask({ title: "Eliminar «" + (o.title || "(sin título)") + "»", text: "No se puede deshacer.", a: "Eliminar", danger: true }) !== "a") return;
      ops = [{ op: "event.delete", id: o.id }];
    } else {
      const scope = await ask({ title: "Eliminar evento periódico", text: "¿Qué eventos quieres eliminar?", a: "Solo este evento", b: "Todos los eventos de la serie", danger: true });
      if (!scope) return;
      if (scope === "b") ops = [{ op: "event.delete", id: o.id }];
      else if (ed.master) ops = [opFromView(ed.master, { exdates: (ed.master.exdates || []).concat([o.instance]) })];
      else { fail("Cargando la serie… inténtalo de nuevo."); return; }
    }
    const res = await sendOps(ops);
    if (!res.ok) { fail(res.body && res.body.detail ? res.body.detail : "No se pudo eliminar."); return; }
    S.sel = null; $("dlg-event").close(); load();
  };

  /* ── calendarios ─────────────────────────────────────────────────────────── */
  function openCal(c) {
    S.editCal = c || null;
    $("cal-heading").textContent = c ? "Editar calendario" : "Nuevo calendario";
    $("cal-name").value = c ? c.name : "";
    const cur = c ? c.color : COLORS[S.cals.length % COLORS.length];
    const list = COLORS.indexOf(cur) < 0 ? COLORS.concat([cur]) : COLORS;
    $("cal-colors").innerHTML = list.map((col) => '<label style="--c:' + col + '"><input type="radio" name="cal-color" value="' + col + '"' + (col === cur ? " checked" : "") + "></label>").join("");
    $("cal-delete").hidden = !c;
    $("dlg-cal").showModal(); $("cal-name").focus();
  }
  $("form-cal").addEventListener("submit", async (e) => {
    e.preventDefault();
    const color = (document.querySelector("#cal-colors input:checked") || {}).value || COLORS[0], c = S.editCal;
    await sendOps([{ op: "cal.put", id: c ? c.id : uuid(), name: $("cal-name").value.trim(), color: color, position: c ? c.position : S.cals.length }]);
    $("dlg-cal").close(); load();
  });
  $("cal-delete").onclick = async () => {
    const c = S.editCal;
    if (await ask({ title: "Eliminar «" + c.name + "»", text: "Se eliminarán también todos sus eventos. No se puede deshacer.", a: "Eliminar", danger: true }) !== "a") return;
    await sendOps([{ op: "cal.delete", id: c.id }]);
    $("dlg-cal").close(); load();
  };

  /* ── cuenta ──────────────────────────────────────────────────────────────── */
  $("form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("login-error"); err.hidden = true;
    const body = { server_url: $("server_url").value, username: $("username").value, password: $("password").value };
    if (!$("totp-field").hidden) body.totp = $("totp").value;
    const r = await api("POST", "/api/settings", body);
    if (!r.ok) {
      err.textContent = (r.body && (r.body.error || r.body.detail)) || "No se pudo iniciar sesión."; err.hidden = false;
      if (r.body && r.body.totp_required) { $("totp-field").hidden = false; $("totp").focus(); }
      return;
    }
    $("password").value = ""; $("totp").value = ""; $("totp-field").hidden = true;
    S.scrollTo = true; load();
  });
  $("btn-settings").onclick = () => {
    const st = S.status || {};
    $("acct-text").textContent = st.configured ? "Sesión iniciada como " + st.user + " en " + st.server_url + "." : "No hay ninguna sesión iniciada.";
    $("btn-logout").hidden = !st.configured;
    $("dlg-settings").showModal();
  };
  $("btn-logout").onclick = async () => {
    if (await ask({ title: "Cerrar sesión", text: "Se borra la copia local y se revoca el token de este equipo. Lo que no se haya enviado se pierde.", a: "Cerrar sesión", danger: true }) !== "a") return;
    await api("POST", "/api/logout"); $("dlg-settings").close(); load();
  };

  /* ── sincronizar, buscar, registro ───────────────────────────────────────── */
  async function syncNow() {
    if (S.syncing) return;
    S.syncing = true; renderConn();
    const r = await api("POST", "/api/sync");
    S.syncing = false;
    if (r.ok && r.body && !r.body.ok && r.body.error) toast("No se pudo sincronizar", r.body.error, "error");
    load();
  }
  $("btn-sync").onclick = syncNow;

  let searchCache = null, searchTimer = null;
  $("btn-search").onclick = openSearch;
  function openSearch() {
    $("search-q").value = ""; $("search-results").innerHTML = ""; searchCache = null;
    $("dlg-search").showModal(); $("search-q").focus();
    const a = L.addDays(L.startOfDay(new Date()), -183).getTime(), b = L.addDays(L.startOfDay(new Date()), 183).getTime();
    api("GET", "/api/data?after=" + a + "&before=" + b).then((r) => { if (r.ok) { searchCache = r.body.occurrences; runSearch(); } });
  }
  function runSearch() {
    const q = $("search-q").value.trim().toLowerCase(), el = $("search-results");
    if (!q) { el.innerHTML = '<li class="empty">Escribe para buscar entre los eventos de los últimos y próximos 6 meses.</li>'; return; }
    if (!searchCache) { el.innerHTML = '<li class="empty">Cargando…</li>'; return; }
    const hits = searchCache.filter((o) => [o.title, o.location, o.notes].join("\n").toLowerCase().indexOf(q) >= 0).sort((a, b) => a.start - b.start).slice(0, 100);
    el.innerHTML = hits.length ? hits.map((o) => {
      const n = L.norm(o, "#fff");
      return '<li data-go="' + n.start.getTime() + '"><span class="when">' + esc(o.all_day ? L.ymd(n.start) + " · todo el día" : f.dateTime.format(n.start)) + "</span><span>" + esc(o.title || "(sin título)") + (o.location ? ' <span class="muted">· ' + esc(o.location) + "</span>" : "") + "</span></li>";
    }).join("") : '<li class="empty">Sin resultados.</li>';
  }
  $("search-q").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 120); });
  $("search-results").addEventListener("click", (e) => {
    const li = e.target.closest("[data-go]"); if (!li) return;
    $("dlg-search").close(); go(new Date(+li.dataset.go), S.view === "agenda" ? "day" : null);
  });

  $("btn-log").onclick = async () => {
    $("dlg-log").showModal();
    const [lg, al] = await Promise.all([api("GET", "/api/log"), api("GET", "/api/alerts?since=0")]);
    $("alerts-list").innerHTML = al.ok && al.body.alerts.length ? al.body.alerts.map((a) =>
      '<li><span class="when">' + esc(f.dateTime.format(new Date(a.at))) + "</span><span>" + esc(a.title) + ' <span class="muted">· ' + (a.minutes ? minutesText(a.minutes) + " antes" : "a la hora") + "</span></span></li>").join("") : '<li class="empty">Sin avisos recientes.</li>';
    $("log-list").innerHTML = lg.ok && lg.body.log.length ? lg.body.log.map((l) =>
      '<li class="' + esc(l.level) + '"><span class="when">' + esc(f.dateTime.format(new Date(l.ts))) + "</span><span>" + esc(l.message) + "</span></li>").join("") : '<li class="empty">Sin sucesos.</li>';
  };

  /* ── avisos: el servicio ya manda la notificación del escritorio; aquí se avisa dentro ── */
  function pollAlerts() {
    if (!S.status || !S.status.configured) return;
    api("GET", "/api/alerts?since=" + S.alertSince).then((r) => {
      if (!r.ok) return;
      r.body.alerts.slice().reverse().forEach((a) => {
        if (a.id <= S.alertMax) return;
        S.alertMax = Math.max(S.alertMax, a.id); S.alertSince = Math.max(S.alertSince, a.at);
        const left = Math.round((a.start_ms - Date.now()) / 60000);
        toast(a.title, left > 0 ? "Empieza en " + minutesText(left) : "Empieza ahora");
      });
    });
  }

  /* ── actualizaciones (como Drive y Mail) ─────────────────────────────────── */
  function checkUpdate() {
    api("GET", "/api/update").then((r) => {
      if (!r.ok || !r.body.available) return;
      $("update-commits").innerHTML = r.body.commits.map((c) => "<li><span>" + esc(c) + "</span></li>").join("");
      $("dlg-update").showModal();
    });
  }
  $("update-later").onclick = () => $("dlg-update").close();
  $("update-go").onclick = () => {
    const go = $("update-go"), log = $("update-log");
    if (go.dataset.done) { go.disabled = true; api("POST", "/api/restart"); return; }   // un doble clic abría dos ventanas
    go.disabled = true; $("update-later").disabled = true; log.hidden = false; log.textContent = "Empezando…";
    api("POST", "/api/update").then((r) => {
      if (!r.ok) { log.textContent = r.body.error || "No se pudo empezar."; go.disabled = false; $("update-later").disabled = false; return; }
      const poll = setInterval(() => {
        api("GET", "/api/update/log").then((l) => {
          log.textContent = l.body.log || "…"; log.scrollTop = log.scrollHeight;
          if (l.body.state === "running") return;
          clearInterval(poll);
          $("update-later").disabled = false;
          if (l.body.state === "done") {
            go.disabled = false; go.dataset.done = "1"; go.textContent = "Reiniciar Calendar";
            $("update-hint").textContent = "Actualizado. Reinicia la ventana para usar la versión nueva (el servicio de avisos ya corre con ella).";
          } else {
            go.disabled = false; $("update-hint").textContent = "No se pudo actualizar. Abajo está el motivo.";
          }
        });
      }, 1500);
    });
  };

  /* ── teclado ─────────────────────────────────────────────────────────────── */
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector("dialog[open]")) return;
    const t = e.target, tag = t && t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (!S.status || !S.status.configured) return;
    const k = e.key;
    const map = { m: () => setView("month"), w: () => setView("week"), d: () => setView("day"), a: () => setView("agenda"), t: () => go(new Date()),
      j: () => step(1), ArrowRight: () => step(1), k: () => step(-1), ArrowLeft: () => step(-1),
      c: () => openEditor(null, defaultStart()), "/": openSearch, "?": () => $("dlg-help").showModal(),
      Delete: () => { const n = S.sel && S.byKey[S.sel]; if (n) { openEditor(n, null); setTimeout(() => $("ev-delete").click(), 0); } } };
    if (map[k]) { e.preventDefault(); map[k](); }
  });

  /* ── arranque ────────────────────────────────────────────────────────────── */
  setInterval(() => { if (!document.hidden) load(); }, 15000);
  setInterval(pollAlerts, 20000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  api("POST", "/api/chrome");
  load();
  setTimeout(checkUpdate, 4000);
  window.CalApp = { S: S, load: load, openEditor: openEditor };   // para depurar desde la consola
})();
