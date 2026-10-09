// Recurring events (RFC 5545 RRULE) expanded in the event's own time zone.
//
//   rrule.check(rule)                                   "" if valid, else why not
//   rrule.expand(rule, start, tzid, exdates, from, to[, limit])
//       -> List<int>: the UTC start (ms) of every occurrence in [from, to)
//
// `start` is the first occurrence (DTSTART) as a UTC instant; the rule is applied
// to its wall-clock reading in `tzid` ("Europe/Madrid", DST included; "" is UTC),
// so a meeting at 10:00 stays at 10:00 across a clock change. A local time that
// does not exist (the spring-forward gap) is moved forward by the gap, as RFC 5545
// says; an ambiguous one (autumn) takes its first instance.
//
// Supported: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, COUNT, UNTIL, BYDAY (with
// an ordinal in MONTHLY/YEARLY: 1MO, -1FR), BYMONTHDAY (negatives count from the
// end), BYMONTH, WKST. Anything else is rejected by check() rather than ignored:
// silently dropping a part would show the wrong dates. As in the RFC, a day that
// does not exist in a month (the 31st, Feb 29) is skipped, not clamped.
// In YEARLY, BYDAY/BYMONTHDAY apply inside the month(s) of BYMONTH (default: the
// month of DTSTART), not the whole year.
//
// COUNT counts every occurrence the rule generates, EXDATEs included, as the RFC
// says. `exdates` are UTC instants compared for equality with the generated starts.
#include <lux_script/builtin_module.hpp>
#include <lux_script/tz.hpp>

#include <algorithm>
#include <chrono>
#include <cctype>
#include <string>
#include <vector>

namespace lux_script {

namespace {

namespace ch = std::chrono;
using ms = ch::milliseconds;

enum class Freq { None, Daily, Weekly, Monthly, Yearly };

struct Rule {
    Freq freq = Freq::None;
    int interval = 1;
    long long count = -1;
    // UNTIL: an instant (Z), a local wall clock (no Z) or a whole local day.
    enum class Until { None, Utc, Local, Day } until_kind = Until::None;
    long long until_ms = 0;               // Utc: the instant; Local/Day: wall clock as if UTC
    std::vector<std::pair<int, int>> byday;   // (ordinal, weekday 0 = Monday .. 6 = Sunday)
    std::vector<int> bymonthday;
    std::vector<int> bymonth;
    int wkst = 0;
};

std::vector<std::string> split(const std::string& s, char sep) {
    std::vector<std::string> out;
    size_t at = 0;
    for (;;) {
        const size_t i = s.find(sep, at);
        out.push_back(s.substr(at, i == std::string::npos ? i : i - at));
        if (i == std::string::npos) return out;
        at = i + 1;
    }
}

bool to_int(const std::string& s, int& out) {
    if (s.empty() || s.size() > 6) return false;
    size_t i = (s[0] == '-' || s[0] == '+') ? 1 : 0;
    if (i == s.size()) return false;
    for (size_t k = i; k < s.size(); ++k) if (!std::isdigit(static_cast<unsigned char>(s[k]))) return false;
    out = std::stoi(s);
    return true;
}

int weekday_code(const std::string& s) {
    static const char* names[] = {"MO", "TU", "WE", "TH", "FR", "SA", "SU"};
    for (int i = 0; i < 7; ++i) if (s == names[i]) return i;
    return -1;
}

// 20261231 or 20261231T235959[Z] -> milliseconds since the epoch as if UTC.
bool parse_stamp(const std::string& s, long long& out, bool& has_time, bool& zulu) {
    has_time = s.size() > 8;
    zulu = !s.empty() && s.back() == 'Z';
    const std::string d = zulu ? s.substr(0, s.size() - 1) : s;
    if (d.size() != 8 && d.size() != 15) return false;
    if (d.size() == 15 && d[8] != 'T') return false;
    for (size_t i = 0; i < d.size(); ++i) if (i != 8 && !std::isdigit(static_cast<unsigned char>(d[i]))) return false;
    const int y = std::stoi(d.substr(0, 4)), m = std::stoi(d.substr(4, 2)), dd = std::stoi(d.substr(6, 2));
    int hh = 0, mi = 0, ss = 0;
    if (d.size() == 15) { hh = std::stoi(d.substr(9, 2)); mi = std::stoi(d.substr(11, 2)); ss = std::stoi(d.substr(13, 2)); }
    const ch::year_month_day ymd{ch::year{y}, ch::month{static_cast<unsigned>(m)}, ch::day{static_cast<unsigned>(dd)}};
    if (!ymd.ok() || hh > 23 || mi > 59 || ss > 60) return false;
    out = ch::duration_cast<ms>(ch::sys_days{ymd}.time_since_epoch()).count() + ((hh * 60LL + mi) * 60 + ss) * 1000;
    return true;
}

bool parse_rule(const std::string& text, Rule& r, std::string& err) {
    if (text.empty()) { err = "rrule: empty rule"; return false; }
    for (const std::string& part : split(text, ';')) {
        if (part.empty()) continue;
        const size_t eq = part.find('=');
        if (eq == std::string::npos) { err = "rrule: '" + part + "' is not NAME=VALUE"; return false; }
        std::string k = part.substr(0, eq);
        for (char& c : k) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
        std::string v = part.substr(eq + 1);
        for (char& c : v) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
        if (k == "FREQ") {
            if (v == "DAILY") r.freq = Freq::Daily;
            else if (v == "WEEKLY") r.freq = Freq::Weekly;
            else if (v == "MONTHLY") r.freq = Freq::Monthly;
            else if (v == "YEARLY") r.freq = Freq::Yearly;
            else { err = "rrule: FREQ=" + v + " is not supported (DAILY, WEEKLY, MONTHLY, YEARLY)"; return false; }
        } else if (k == "INTERVAL") {
            if (!to_int(v, r.interval) || r.interval < 1 || r.interval > 1000) { err = "rrule: INTERVAL must be 1..1000"; return false; }
        } else if (k == "COUNT") {
            int n;
            if (!to_int(v, n) || n < 1) { err = "rrule: COUNT must be a positive integer"; return false; }
            r.count = n;
        } else if (k == "UNTIL") {
            bool has_time, zulu;
            if (!parse_stamp(v, r.until_ms, has_time, zulu)) { err = "rrule: UNTIL '" + v + "' is not YYYYMMDD or YYYYMMDDTHHMMSS[Z]"; return false; }
            r.until_kind = !has_time ? Rule::Until::Day : zulu ? Rule::Until::Utc : Rule::Until::Local;
        } else if (k == "BYDAY") {
            for (const std::string& item : split(v, ',')) {
                if (item.size() < 2) { err = "rrule: bad BYDAY '" + item + "'"; return false; }
                const int wd = weekday_code(item.substr(item.size() - 2));
                int ord = 0;
                const std::string o = item.substr(0, item.size() - 2);
                if (wd < 0 || (!o.empty() && (!to_int(o, ord) || ord == 0 || ord < -53 || ord > 53))) { err = "rrule: bad BYDAY '" + item + "'"; return false; }
                r.byday.push_back({ord, wd});
            }
        } else if (k == "BYMONTHDAY") {
            for (const std::string& item : split(v, ',')) {
                int n;
                if (!to_int(item, n) || n == 0 || n < -31 || n > 31) { err = "rrule: BYMONTHDAY must be 1..31 or -31..-1"; return false; }
                r.bymonthday.push_back(n);
            }
        } else if (k == "BYMONTH") {
            for (const std::string& item : split(v, ',')) {
                int n;
                if (!to_int(item, n) || n < 1 || n > 12) { err = "rrule: BYMONTH must be 1..12"; return false; }
                r.bymonth.push_back(n);
            }
        } else if (k == "WKST") {
            r.wkst = weekday_code(v);
            if (r.wkst < 0) { err = "rrule: bad WKST '" + v + "'"; return false; }
        } else {
            err = "rrule: " + k + " is not supported";
            return false;
        }
    }
    if (r.freq == Freq::None) { err = "rrule: FREQ is required"; return false; }
    if (r.count > 0 && r.until_kind != Rule::Until::None) { err = "rrule: COUNT and UNTIL are mutually exclusive"; return false; }
    const bool ordinals = std::any_of(r.byday.begin(), r.byday.end(), [](auto& p) { return p.first != 0; });
    if (ordinals && r.freq != Freq::Monthly && r.freq != Freq::Yearly) { err = "rrule: an ordinal BYDAY (1MO, -1FR) needs FREQ=MONTHLY or YEARLY"; return false; }
    if (!r.bymonthday.empty() && (r.freq == Freq::Weekly)) { err = "rrule: BYMONTHDAY is not valid with FREQ=WEEKLY"; return false; }
    return true;
}

// Monday = 0 .. Sunday = 6
int wd_index(ch::sys_days d) { return static_cast<int>((ch::weekday{d}.c_encoding() + 6) % 7); }

int days_in_month(ch::year y, ch::month m) {
    return static_cast<int>(unsigned((ch::year_month_day_last{y, ch::month_day_last{m}}).day()));
}

const lux_tz::time_zone* find_zone(const std::string& id) {
    try { return lux_tz::locate(id.empty() ? "UTC" : id); }
    catch (const std::exception&) { return nullptr; }
}

// The UTC instant of a wall-clock reading (see the header comment for gaps / overlaps).
// `first` is the offset in force before the transition for a nonexistent time and the
// earlier of the two instances for an ambiguous one -- both what the RFC asks for --
// and the only one there is otherwise. (to_sys() is no use here: libstdc++ does not throw
// for a nonexistent time but returns the end of the gap.)
long long to_utc_ms(const lux_tz::time_zone* tz, lux_tz::local_time<ms> lt) {
    const lux_tz::local_info li = tz->get_info(lt);
    return lt.time_since_epoch().count() - ch::duration_cast<ms>(li.first.offset).count();
}

// Days of month `ym` that a BYDAY / BYMONTHDAY set selects (or the single default day).
void month_days(const Rule& r, ch::year_month ym, int default_day, std::vector<unsigned>& out) {
    const int n = days_in_month(ym.year(), ym.month());
    const ch::sys_days first{ch::year_month_day{ym.year(), ym.month(), ch::day{1}}};
    auto md_selected = [&](int day) {
        for (int md : r.bymonthday) if ((md > 0 ? md : n + md + 1) == day) return true;
        return false;
    };
    if (!r.byday.empty()) {
        for (auto [ord, wd] : r.byday) {
            std::vector<int> hits;
            for (int day = 1; day <= n; ++day) if (wd_index(first + ch::days{day - 1}) == wd) hits.push_back(day);
            if (ord == 0) { for (int day : hits) out.push_back(day); }
            else {
                const int idx = ord > 0 ? ord - 1 : static_cast<int>(hits.size()) + ord;
                if (idx >= 0 && idx < static_cast<int>(hits.size())) out.push_back(hits[idx]);
            }
        }
        if (!r.bymonthday.empty())
            out.erase(std::remove_if(out.begin(), out.end(), [&](unsigned d) { return !md_selected(static_cast<int>(d)); }), out.end());
    } else if (!r.bymonthday.empty()) {
        for (int md : r.bymonthday) {
            const int day = md > 0 ? md : n + md + 1;
            if (day >= 1 && day <= n) out.push_back(day);
        }
    } else if (default_day <= n) {
        out.push_back(default_day);   // the 31st / Feb 29 simply do not exist this month
    }
    std::sort(out.begin(), out.end());
    out.erase(std::unique(out.begin(), out.end()), out.end());
}

bool in_set(const std::vector<int>& set, int v) { return set.empty() || std::find(set.begin(), set.end(), v) != set.end(); }

Value fn_check(NativeCtx&, std::vector<Value>& a, std::string&) {
    Rule r;
    std::string err;
    return Value::str(parse_rule(a[0].as_str(), r, err) ? "" : err);
}

Value fn_expand(NativeCtx&, std::vector<Value>& a, std::string& error) {
    Rule r;
    if (!parse_rule(a[0].as_str(), r, error)) return Value::null();
    const lux_tz::time_zone* tz = find_zone(a[2].as_str());
    if (!tz) { error = "rrule.expand(): unknown time zone '" + a[2].as_str() + "'"; return Value::null(); }
    const long long start = a[1].as_int(), from = a[4].as_int(), to = a[5].as_int();
    const long long limit = a.size() > 6 ? std::clamp<long long>(a[6].as_int(), 1, 10000) : 1000;
    std::vector<long long> ex;
    for (const Value& v : a[3].as_list()) if (v.is_int()) ex.push_back(v.as_int());

    // DTSTART's wall clock in the event's zone.
    const lux_tz::local_time<ms> lt0 = lux_tz::to_local<ms>(tz, ch::sys_time<ms>(ms(start)));
    const ch::sys_days start_d{ch::floor<ch::days>(lt0).time_since_epoch()};
    const ms tod = lt0 - ch::floor<ch::days>(lt0);
    const ch::year_month_day sym{start_d};

    // UNTIL as a UTC instant. A bare date is inclusive: the whole local day.
    long long until = -1;
    if (r.until_kind == Rule::Until::Utc) until = r.until_ms;
    else if (r.until_kind == Rule::Until::Local) until = to_utc_ms(tz, lux_tz::local_time<ms>(ms(r.until_ms)));
    else if (r.until_kind == Rule::Until::Day) until = to_utc_ms(tz, lux_tz::local_time<ms>(ms(r.until_ms + 86'400'000 - 1)));

    Value::List out;
    long long generated = 0;
    // Returns false when generation is over.
    auto emit = [&](ch::sys_days day) -> bool {
        const long long utc = to_utc_ms(tz, lux_tz::local_time<ms>(day.time_since_epoch() + tod));
        if (utc < start) return true;
        if ((until >= 0 && utc > until) || utc >= to) return false;
        if (r.count > 0 && generated >= r.count) return false;
        ++generated;
        if (utc >= from && std::find(ex.begin(), ex.end(), utc) == ex.end()) {
            out.push_back(Value::integer(utc));
            if (static_cast<long long>(out.size()) >= limit) return false;
        }
        return true;
    };

    // A rule with no matching day at all (BYMONTHDAY=31 + BYMONTH=2) would loop for
    // ever: stop after this many periods, and past `horizon` (300 years after DTSTART).
    constexpr int kMaxPeriods = 20000;
    int periods = 0;
    const ch::sys_days horizon = ch::sys_days{ch::year_month_day{sym.year() + ch::years{300}, sym.month(), ch::day{1}}};

    switch (r.freq) {
    case Freq::Daily:
        for (long long k = 0; ++periods <= kMaxPeriods * 10; ++k) {
            const ch::sys_days d = start_d + ch::days{k * r.interval};
            if (d > horizon) break;
            const ch::year_month_day ymd{d};
            const int n = days_in_month(ymd.year(), ymd.month());
            bool ok = in_set(r.bymonth, static_cast<int>(unsigned(ymd.month())));
            if (ok && !r.bymonthday.empty()) {
                ok = false;
                for (int md : r.bymonthday) if ((md > 0 ? md : n + md + 1) == static_cast<int>(unsigned(ymd.day()))) ok = true;
            }
            if (ok && !r.byday.empty()) {
                ok = false;
                for (auto& p : r.byday) if (p.second == wd_index(d)) ok = true;
            }
            if (ok && !emit(d)) goto done;
        }
        break;
    case Freq::Weekly: {
        const ch::sys_days week0 = start_d - ch::days{(wd_index(start_d) - r.wkst + 7) % 7};
        for (long long k = 0; ++periods <= kMaxPeriods; ++k) {
            const ch::sys_days ws = week0 + ch::days{7 * k * r.interval};
            if (ws > horizon) break;
            for (int i = 0; i < 7; ++i) {
                const ch::sys_days d = ws + ch::days{i};
                if (d < start_d) continue;
                const int wd = (r.wkst + i) % 7;
                bool ok = false;
                if (r.byday.empty()) ok = wd == wd_index(start_d);
                else for (auto& p : r.byday) if (p.second == wd) ok = true;
                if (ok && !in_set(r.bymonth, static_cast<int>(unsigned(ch::year_month_day{d}.month())))) ok = false;
                if (ok && !emit(d)) goto done;
            }
        }
        break;
    }
    case Freq::Monthly:
    case Freq::Yearly: {
        const bool yearly = r.freq == Freq::Yearly;
        for (long long k = 0; ++periods <= kMaxPeriods; ++k) {
            std::vector<ch::year_month> yms;
            if (!yearly) {
                const ch::year_month ym = ch::year_month{sym.year(), sym.month()} + ch::months{k * r.interval};
                if (in_set(r.bymonth, static_cast<int>(unsigned(ym.month())))) yms.push_back(ym);
            } else {
                const ch::year y = sym.year() + ch::years{k * r.interval};
                if (r.bymonth.empty()) yms.push_back({y, sym.month()});
                else {
                    std::vector<int> months = r.bymonth;
                    std::sort(months.begin(), months.end());
                    for (int m : months) yms.push_back({y, ch::month{static_cast<unsigned>(m)}});
                }
            }
            for (const ch::year_month& ym : yms) {
                if (ch::sys_days{ch::year_month_day{ym.year(), ym.month(), ch::day{1}}} > horizon) goto done;
                std::vector<unsigned> days;
                month_days(r, ym, static_cast<int>(unsigned(sym.day())), days);
                for (unsigned day : days) {
                    const ch::sys_days d{ch::year_month_day{ym.year(), ym.month(), ch::day{day}}};
                    if (d < start_d) continue;
                    if (!emit(d)) goto done;
                }
            }
        }
        break;
    }
    case Freq::None: break;
    }
done:
    return Value::list(std::move(out));
}

} // namespace

LUX_MODULE(rrule, {
    {"check",  "s>s",       fn_check},
    {"expand", "sislii|i>l", fn_expand},
})

} // namespace lux_script
