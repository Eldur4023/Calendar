// Pruebas de la lógica sin DOM de la ventana (desktop/app/public/logic.js):
//   node desktop/tests/logic.test.js
// Se ejecuta con TZ=Europe/Madrid para que los cambios de hora sean los reales.
process.env.TZ = "Europe/Madrid";
const assert = require("assert");
const L = require("../app/public/logic.js");

let n = 0;
function test(name, fn) { fn(); n++; console.log("  ok   ", name); }

test("la semana empieza en lunes", () => {
  assert.strictEqual(L.ymd(L.startOfWeek(new Date(2026, 9, 11))), "2026-10-05");   // domingo
  assert.strictEqual(L.ymd(L.startOfWeek(new Date(2026, 9, 5))), "2026-10-05");    // lunes
  assert.strictEqual(L.weekday(new Date(2026, 9, 11)), 6);
});

test("addDays conserva la hora de pared al cambiar el horario", () => {
  const d = L.addDays(new Date(2026, 9, 24, 10, 0), 1);   // el 25-oct se retrasa una hora
  assert.strictEqual(L.hm(d), "10:00");
  assert.strictEqual(L.ymd(L.addDays(new Date(2026, 2, 28, 10, 0), 2)), "2026-03-30");
});

test("addMonths recorta fin de mes", () => {
  assert.strictEqual(L.ymd(L.addMonths(new Date(2026, 0, 31), 1)), "2026-02-28");
  assert.strictEqual(L.ymd(L.addMonths(new Date(2026, 11, 15), 1)), "2027-01-15");
  assert.strictEqual(L.ymd(L.addMonths(new Date(2026, 0, 15), -1)), "2025-12-15");
});

test("rangeFor: mes (42 días desde el lunes), semana, día, agenda", () => {
  const m = L.rangeFor("month", new Date(2026, 9, 15));
  assert.strictEqual(L.ymd(m.from), "2026-09-28");
  assert.strictEqual(Math.round((m.to - m.from) / L.DAY), 42);   // 42 días (con el cambio de hora de por medio son 42 días menos una hora)
  assert.strictEqual(L.ymd(m.to), "2026-11-09");
  const w = L.rangeFor("week", new Date(2026, 9, 15));
  assert.strictEqual(L.ymd(w.from), "2026-10-12"); assert.strictEqual(L.ymd(w.to), "2026-10-19");
  assert.strictEqual(L.ymd(L.rangeFor("day", new Date(2026, 9, 15, 17, 30)).to), "2026-10-16");
  assert.strictEqual(L.ymd(L.rangeFor("agenda", new Date(2026, 9, 15)).to), "2026-11-14");
});

test("shiftDate avanza y retrocede por vista", () => {
  const d = new Date(2026, 9, 31);
  assert.strictEqual(L.ymd(L.shiftDate("month", d, 1)), "2026-11-30");
  assert.strictEqual(L.ymd(L.shiftDate("week", d, -1)), "2026-10-24");
  assert.strictEqual(L.ymd(L.shiftDate("day", d, 1)), "2026-11-01");
});

test("todo el día: medianoche UTC <-> día local", () => {
  const ms = L.utcMidnight(new Date(2026, 9, 12, 15, 0));
  assert.strictEqual(new Date(ms).toISOString(), "2026-10-12T00:00:00.000Z");
  assert.strictEqual(L.ymd(L.localDayOfUtc(ms)), "2026-10-12");
  const n = L.norm({ all_day: true, start: ms, end: ms + L.DAY, title: "x" }, "#fff");
  assert.strictEqual(L.ymd(n.start), "2026-10-12"); assert.strictEqual(L.ymd(n.end), "2026-10-13");
  assert.ok(L.touchesDay(n, new Date(2026, 9, 12)));
  assert.ok(!L.touchesDay(n, new Date(2026, 9, 13)));
});

test("touchesDay: eventos que cruzan la medianoche y de duración cero", () => {
  const e = L.norm({ start: new Date(2026, 9, 12, 23, 0).getTime(), end: new Date(2026, 9, 13, 1, 0).getTime() }, "#fff");
  assert.ok(L.touchesDay(e, new Date(2026, 9, 12))); assert.ok(L.touchesDay(e, new Date(2026, 9, 13)));
  assert.ok(!L.touchesDay(e, new Date(2026, 9, 14)));
  const z = L.norm({ start: new Date(2026, 9, 12, 9, 0).getTime(), end: new Date(2026, 9, 12, 9, 0).getTime() }, "#fff");
  assert.ok(L.touchesDay(z, new Date(2026, 9, 12))); assert.ok(!L.touchesDay(z, new Date(2026, 9, 13)));
  // Justo a medianoche acaba el día anterior, no toca el siguiente.
  const m = L.norm({ start: new Date(2026, 9, 12, 22, 0).getTime(), end: new Date(2026, 9, 13, 0, 0).getTime() }, "#fff");
  assert.ok(!L.touchesDay(m, new Date(2026, 9, 13)));
});

function ev(h1, m1, h2, m2, title) {
  return L.norm({ title: title, start: new Date(2026, 9, 12, h1, m1).getTime(), end: new Date(2026, 9, 12, h2, m2).getTime() }, "#fff");
}
test("layoutDay: sin solapes ocupa todo el ancho", () => {
  const out = L.layoutDay([ev(9, 0, 10, 0, "a"), ev(10, 0, 11, 0, "b")], new Date(2026, 9, 12), 60);
  assert.deepStrictEqual(out.map(o => [o.col, o.cols, o.top, o.height]), [[0, 1, 540, 60], [0, 1, 600, 60]]);
});
test("layoutDay: dos solapados van en dos columnas; el siguiente grupo vuelve a una", () => {
  const out = L.layoutDay([ev(9, 0, 11, 0, "a"), ev(10, 0, 12, 0, "b"), ev(13, 0, 14, 0, "c")], new Date(2026, 9, 12), 60);
  assert.deepStrictEqual(out.map(o => [o.n.o.title, o.col, o.cols]), [["a", 0, 2], ["b", 1, 2], ["c", 0, 1]]);
});
test("layoutDay: tres a la vez y reutiliza columnas libres", () => {
  const out = L.layoutDay([ev(9, 0, 12, 0, "a"), ev(9, 30, 10, 0, "b"), ev(9, 45, 11, 0, "c"), ev(10, 0, 11, 0, "d")], new Date(2026, 9, 12), 60);
  const by = Object.fromEntries(out.map(o => [o.n.o.title, o]));
  assert.strictEqual(by.a.cols, 3); assert.strictEqual(by.a.col, 0);
  assert.strictEqual(by.b.col, 1); assert.strictEqual(by.c.col, 2); assert.strictEqual(by.d.col, 1);   // d entra donde acabó b
});
test("layoutDay: recorta al día, y un evento muy corto no desaparece", () => {
  const night = L.norm({ start: new Date(2026, 9, 12, 23, 0).getTime(), end: new Date(2026, 9, 13, 2, 0).getTime() }, "#fff");
  const a = L.layoutDay([night], new Date(2026, 9, 12), 60)[0];
  assert.strictEqual(a.top, 23 * 60); assert.strictEqual(a.height, 60);
  const b = L.layoutDay([night], new Date(2026, 9, 13), 60)[0];
  assert.strictEqual(b.top, 0); assert.strictEqual(b.height, 120);
  const tiny = L.layoutDay([ev(9, 0, 9, 5, "t")], new Date(2026, 9, 12), 60)[0];
  assert.ok(tiny.height >= 16);
});

const tue = new Date(2026, 9, 13, 9, 0);     // martes, 2.º martes de octubre
const lastFri = new Date(2026, 9, 30, 9, 0); // último viernes
test("buildRule: casos habituales", () => {
  const b = (o) => L.buildRule(Object.assign({ freq: "", interval: 1, byday: [], monthMode: "day", endMode: "never", until: "", count: 10, start: tue }, o));
  assert.strictEqual(b({}), "");
  assert.strictEqual(b({ freq: "DAILY" }), "FREQ=DAILY");
  assert.strictEqual(b({ freq: "DAILY", interval: 3 }), "FREQ=DAILY;INTERVAL=3");
  assert.strictEqual(b({ freq: "WEEKLY", byday: [4, 0, 2] }), "FREQ=WEEKLY;BYDAY=MO,WE,FR");
  assert.strictEqual(b({ freq: "WEEKLY", interval: 2, endMode: "count", count: 6 }), "FREQ=WEEKLY;INTERVAL=2;COUNT=6");
  assert.strictEqual(b({ freq: "MONTHLY", monthMode: "nth" }), "FREQ=MONTHLY;BYDAY=2TU");
  assert.strictEqual(b({ freq: "MONTHLY", monthMode: "last", start: lastFri }), "FREQ=MONTHLY;BYDAY=-1FR");
  assert.strictEqual(b({ freq: "MONTHLY", monthMode: "lastday" }), "FREQ=MONTHLY;BYMONTHDAY=-1");
  assert.strictEqual(b({ freq: "YEARLY", endMode: "until", until: "2030-12-31" }), "FREQ=YEARLY;UNTIL=20301231");
});
test("parseRule invierte buildRule", () => {
  const cases = [
    ["FREQ=DAILY", tue], ["FREQ=DAILY;INTERVAL=3;COUNT=5", tue], ["FREQ=WEEKLY;BYDAY=MO,WE,FR", tue],
    ["FREQ=WEEKLY;INTERVAL=2;UNTIL=20271231", tue], ["FREQ=MONTHLY", tue], ["FREQ=MONTHLY;BYDAY=2TU", tue],
    ["FREQ=MONTHLY;BYDAY=-1FR", lastFri], ["FREQ=MONTHLY;BYMONTHDAY=-1", tue], ["FREQ=YEARLY", tue],
  ];
  cases.forEach(([rule, start]) => {
    const f = L.parseRule(rule, start);
    assert.ok(f.simple, rule);
    assert.strictEqual(L.buildRule(Object.assign({ start: start }, f)), rule);
  });
});
test("parseRule marca lo que el formulario no sabe expresar", () => {
  ["FREQ=MONTHLY;BYMONTH=3,9", "FREQ=WEEKLY;BYDAY=MO;WKST=SU", "FREQ=MONTHLY;BYMONTHDAY=5", "FREQ=DAILY;UNTIL=20261231T000000Z",
   "FREQ=MONTHLY;BYDAY=2MO,3MO", "FREQ=MONTHLY;BYDAY=2MO", "FREQ=SECONDLY"].forEach((rule) => {
    assert.strictEqual(L.parseRule(rule, tue).simple, false, rule);
  });
  assert.strictEqual(L.parseRule("", tue).freq, "");
});

console.log(n + " pruebas pasadas");
