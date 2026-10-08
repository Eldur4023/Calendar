/* Calendar — lógica sin DOM: fechas, repeticiones y maquetación. La usa app.js y la prueba
   desktop/tests/logic.test.js (node). Las semanas empiezan en lunes y los días de la semana
   se numeran 0 = lunes … 6 = domingo, como en el servidor. */
var CalLogic = (function () {
  "use strict";
  var DAY = 86400000;
  var CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  // Suma días en hora de pared: un día de 23 o 25 horas sigue siendo un día.
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds()); }
  function addMonths(d, n) {
    var t = new Date(d.getFullYear(), d.getMonth() + n, 1);
    t.setDate(Math.min(d.getDate(), daysInMonth(t.getFullYear(), t.getMonth())));
    return t;
  }
  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function weekday(d) { return (d.getDay() + 6) % 7; }
  function startOfWeek(d) { return addDays(startOfDay(d), -weekday(d)); }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseYmd(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function hm(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function parseHm(s) { var p = (s || "00:00").split(":"); return { h: +p[0] || 0, m: +p[1] || 0 }; }
  // Fecha + "HH:MM" -> Date local.
  function at(dateStr, timeStr) { var d = parseYmd(dateStr), t = parseHm(timeStr); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), t.h, t.m); }

  /* ── todo el día: se guardan como medianoches UTC; en pantalla son días locales ─ */
  function utcMidnight(d) { return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); }
  function localDayOfUtc(ms) { var u = new Date(ms); return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()); }

  /* ── periodo visible de cada vista: [from, to) en hora local ──────────────── */
  function rangeFor(view, date) {
    var d = startOfDay(date), from, to;
    if (view === "month") { from = startOfWeek(new Date(d.getFullYear(), d.getMonth(), 1)); to = addDays(from, 42); }
    else if (view === "week") { from = startOfWeek(d); to = addDays(from, 7); }
    else if (view === "day") { from = d; to = addDays(d, 1); }
    else { from = d; to = addDays(d, 30); }
    return { from: from, to: to };
  }
  function shiftDate(view, date, dir) {
    if (view === "month") return addMonths(date, dir);
    if (view === "week") return addDays(date, 7 * dir);
    if (view === "day") return addDays(date, dir);
    return addDays(date, 30 * dir);
  }

  /* ── una aparición lista para pintar ─────────────────────────────────────── */
  // `end` es exclusivo; en los de todo el día, medianoche local del día siguiente al último.
  function norm(o, color) {
    var n = { o: o, color: color, allDay: !!o.all_day };
    if (n.allDay) { n.start = localDayOfUtc(o.start); n.end = localDayOfUtc(o.end); }
    else { n.start = new Date(o.start); n.end = new Date(o.end); }
    return n;
  }
  // ¿Toca el día `day` (medianoche local)? Un evento de duración cero cuenta en su día.
  function touchesDay(n, day) {
    var next = addDays(day, 1);
    if (n.end.getTime() <= n.start.getTime()) return n.start >= day && n.start < next;
    return n.start < next && n.end > day;
  }
  function cmpEvents(a, b) {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return a.start - b.start || b.end - a.end || (a.o.title || "").localeCompare(b.o.title || "");
  }

  /* ── semana/día: columnas para eventos que se solapan ───────────────────── */
  // Devuelve [{n, top, height, col, cols}] en píxeles para el día `day`, con `hourPx` por hora.
  function layoutDay(items, day, hourPx) {
    var dayStart = day.getTime(), next = addDays(day, 1).getTime();
    var segs = [];
    items.forEach(function (n) {
      if (n.allDay) return;
      var s = Math.max(n.start.getTime(), dayStart), e = Math.min(n.end.getTime(), next);
      if (e <= s) e = s + 20 * 60000;                       // un evento sin duración ocupa algo visible
      var sm = (s - dayStart) / 60000, em = (e - dayStart) / 60000;
      if (em - sm < 20) em = sm + 20;
      segs.push({ n: n, sm: sm, em: em, col: 0, cols: 1 });
    });
    segs.sort(function (a, b) { return a.sm - b.sm || b.em - a.em; });
    var cluster = [], colEnds = [], clusterEnd = -1;
    function close() { cluster.forEach(function (s) { s.cols = colEnds.length; }); cluster = []; colEnds = []; clusterEnd = -1; }
    segs.forEach(function (s) {
      if (cluster.length && s.sm >= clusterEnd) close();
      var c = 0;
      while (c < colEnds.length && colEnds[c] > s.sm) c++;
      colEnds[c] = s.em; s.col = c;
      clusterEnd = Math.max(clusterEnd, s.em);
      cluster.push(s);
    });
    close();
    return segs.map(function (s) {
      return { n: s.n, top: s.sm / 60 * hourPx, height: Math.max((s.em - s.sm) / 60 * hourPx, 16), col: s.col, cols: s.cols };
    });
  }

  /* ── repeticiones: formulario <-> RRULE ──────────────────────────────────── */
  // Cuántas veces cae el día en su mes (1..5) y si es la última.
  function nthOfMonth(d) {
    return { n: Math.ceil(d.getDate() / 7), last: d.getDate() + 7 > daysInMonth(d.getFullYear(), d.getMonth()) };
  }
  // f = {freq, interval, byday:[0..6], monthMode:'day'|'nth'|'last'|'lastday', endMode:'never'|'until'|'count', until:'YYYY-MM-DD', count, start:Date}
  function buildRule(f) {
    if (!f.freq) return "";
    var p = ["FREQ=" + f.freq];
    var iv = Math.max(1, Math.min(99, parseInt(f.interval, 10) || 1));
    if (iv > 1) p.push("INTERVAL=" + iv);
    if (f.freq === "WEEKLY" && f.byday && f.byday.length) {
      p.push("BYDAY=" + f.byday.slice().sort(function (a, b) { return a - b; }).map(function (i) { return CODES[i]; }).join(","));
    }
    if (f.freq === "MONTHLY") {
      var wd = CODES[weekday(f.start)], nth = nthOfMonth(f.start);
      if (f.monthMode === "nth") p.push("BYDAY=" + nth.n + wd);
      else if (f.monthMode === "last") p.push("BYDAY=-1" + wd);
      else if (f.monthMode === "lastday") p.push("BYMONTHDAY=-1");
    }
    if (f.endMode === "until" && f.until) p.push("UNTIL=" + f.until.replace(/-/g, ""));
    else if (f.endMode === "count" && f.count) p.push("COUNT=" + Math.max(1, Math.min(999, parseInt(f.count, 10) || 1)));
    return p.join(";");
  }
  // Lo inverso, para el formulario. `simple` es false si la regla tiene algo que el formulario
  // no sabe expresar (en ese caso se conserva la regla tal cual mientras no se toque).
  function parseRule(rule, start) {
    var out = { simple: true, freq: "", interval: 1, byday: [], monthMode: "day", endMode: "never", until: "", count: 10 };
    if (!rule) return out;
    rule.split(";").forEach(function (part) {
      var kv = part.split("="), k = kv[0].toUpperCase(), v = (kv[1] || "").toUpperCase();
      if (k === "FREQ") out.freq = v;
      else if (k === "INTERVAL") out.interval = parseInt(v, 10) || 1;
      else if (k === "COUNT") { out.endMode = "count"; out.count = parseInt(v, 10) || 1; }
      else if (k === "UNTIL") {
        if (/^\d{8}$/.test(v)) { out.endMode = "until"; out.until = v.slice(0, 4) + "-" + v.slice(4, 6) + "-" + v.slice(6, 8); }
        else out.simple = false;
      } else if (k === "BYDAY") {
        var items = v.split(",");
        if (out.freq === "MONTHLY" || (!out.freq && /\d/.test(v))) {
          var m = /^(-?\d)([A-Z]{2})$/.exec(items[0]);
          if (items.length !== 1 || !m || CODES.indexOf(m[2]) !== weekday(start)) { out.simple = false; return; }
          out.monthMode = m[1] === "-1" ? "last" : (+m[1] === nthOfMonth(start).n ? "nth" : null);
          if (out.monthMode === null) out.simple = false;
        } else {
          items.forEach(function (c) { var i = CODES.indexOf(c); if (i < 0) out.simple = false; else out.byday.push(i); });
        }
      } else if (k === "BYMONTHDAY") {
        if (v === "-1") out.monthMode = "lastday";
        else if (+v === start.getDate()) out.monthMode = "day";
        else out.simple = false;
      } else out.simple = false;
    });
    if (["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].indexOf(out.freq) < 0) out.simple = false;
    if (out.freq !== "WEEKLY" && out.byday.length) out.simple = false;
    return out;
  }

  var api = {
    DAY: DAY, CODES: CODES, pad: pad, startOfDay: startOfDay, addDays: addDays, addMonths: addMonths, daysInMonth: daysInMonth,
    weekday: weekday, startOfWeek: startOfWeek, sameDay: sameDay, ymd: ymd, parseYmd: parseYmd, hm: hm, parseHm: parseHm, at: at,
    utcMidnight: utcMidnight, localDayOfUtc: localDayOfUtc, rangeFor: rangeFor, shiftDate: shiftDate,
    norm: norm, touchesDay: touchesDay, cmpEvents: cmpEvents, layoutDay: layoutDay,
    nthOfMonth: nthOfMonth, buildRule: buildRule, parseRule: parseRule
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
