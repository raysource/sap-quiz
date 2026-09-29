"use strict";
/* SAP SD 認定試験 過去問クイズ — 学生版 / 老师版 共用引擎
   学生版(index.html)：只作答，作答过程中不显示对错；提交后生成答题总结与分数。
   老师版(teacher.html)：密码进入，答完即批改，显示正解与解说，可一键显示答案。
   数据来自 ../data.js（由 tools/parse_quiz.py 从原 Excel 生成）。 */
const MODE = document.body.dataset.mode === "teacher" ? "teacher" : "student";
const TEACHER = MODE === "teacher";
const SHEETS = (window.QUIZ.sheets || []).filter(s => s.groups && s.groups.length);
const LS = "sdq." + MODE + ".v1";
let store = {};
try { store = JSON.parse(localStorage.getItem(LS) || "{}") || {}; } catch (e) { store = {}; }
const persist = () => { try { localStorage.setItem(LS, JSON.stringify(store)); } catch (e) {} };

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
// FNV-1a（老师版口令校验；纯前端静态站的校验只能防误入，不能防破解）
const fnv = s => {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
};
const byName = n => SHEETS.find(s => s.name === n);
const stmts = s => s.groups.reduce((a, g) => a + g.opts.length, 0);
const rec = name => store[name] || { items: {}, meta: {} };
const itemsOf = name => { const r = store[name] || (store[name] = { items: {}, meta: {} }); return r; };
const fmtMs = ms => {
  const m = Math.floor(ms / 60000), s = Math.round(ms % 60000 / 1000);
  return (m ? m + " 分 " : "") + s + " 秒";
};
const fmtTime = ts => new Date(ts).toLocaleString("ja-JP", { hour12: false });
const band = p => p >= 90 ? ["★★★★ 优秀", "ok"] : p >= 75 ? ["★★★ 合格", "ok"]
  : p >= 60 ? ["★★ 待加强", "mid"] : ["★ 需重做", "low"];

/* 按原表答案算分：未作答（判断题没选、选择题整题没动）一律算错 */
function scoreSheet(s, items) {
  let okS = 0, nS = 0, okG = 0, answered = 0;
  s.groups.forEach((g, i) => {
    const it = items[i] || {};
    const picks = it.picks || null;
    const touched = picks ? (g.type === "judge" ? picks.some(v => v != null) : it.set === true) : false;
    let gok = true;
    g.opts.forEach((o, k) => {
      nS++;
      const p = picks ? picks[k] : null;
      const judged = g.type === "judge" ? p != null : touched;   // 判断题逐条判；选择题整题作答后才判
      if (judged && (o.ans === true) === (p === true)) okS++; else gok = false;
    });
    if (gok) okG++;
    if (picks && (g.type === "judge" ? picks.every(v => v != null) : it.set === true)) answered++;
  });
  return { pct: Math.round(okS / nS * 100), okS, nS, okG, nG: s.groups.length, answered };
}
const stmtOk = (x, i) => {
  const p = x.picks[i];
  if (x.type === "judge") return p != null && (x.opts[i].ans === true) === p;
  return x.set === true && (x.opts[i].ans === true) === (p === true);
};

/* ---------- 首页 ---------- */
function renderHome() {
  const home = document.getElementById("home");
  home.innerHTML = "";
  const tot = SHEETS.reduce((a, s) => a + s.groups.length, 0);
  const ts = SHEETS.reduce((a, s) => a + stmts(s), 0);

  home.append(el("h1", null, TEACHER ? "SAP SD 認定試験 過去問クイズ（老师版）" : "SAP SD 認定試験 過去問クイズ"));
  home.append(el("p", "lead", TEACHER
    ? "按原表分册（日目 / 実力テスト）讲解用：答完即批改，显示原表正解与解说；点「显示本套答案」可直接看答案。"
    : "按原表分册（日目 / 実力テスト）练习：○×判断题为每条陈述判对错，「選択」类按原表答案勾选。"
      + "作答过程中不显示对错，答完点「提交并生成总结」后给出分数与逐题批改。"));

  const st = el("div", "stat");
  const cards = el("div", "grid");
  if (TEACHER) {
    let dn = 0, rt = 0;
    SHEETS.forEach(s => { const p = rec(s.name).items; s.groups.forEach((g, i) => { if (p[i] && p[i].ok != null) { dn++; if (p[i].ok) rt++; } }); });
    [["套题", SHEETS.length], ["题组", tot], ["陈述", ts], ["已批改", dn + " / " + tot], ["正确率", dn ? Math.round(rt / dn * 100) + "%" : "—"]]
      .forEach(([k, v]) => { const d = el("div"); d.append(el("b", null, String(v)), el("span", null, k)); st.append(d); });
  } else {
    const scores = SHEETS.map(s => rec(s.name).meta.result).filter(Boolean).map(r => r.pct);
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    [["套题", SHEETS.length], ["题组", tot], ["陈述", ts], ["已交卷", scores.length + " / " + SHEETS.length], ["平均分", scores.length ? avg : "—"]]
      .forEach(([k, v]) => { const d = el("div"); d.append(el("b", null, String(v)), el("span", null, k)); st.append(d); });
  }
  home.append(st, el("h2", null, "选择套题"));

  SHEETS.forEach(s => {
    const r = rec(s.name);
    const sc = scoreSheet(s, r.items);
    const c = el("div", "card set");
    c.append(el("h3", null, s.name));
    const kinds = new Set(s.groups.map(g => g.type));
    c.append(el("div", "n", s.groups.length + " 题组 · " + stmts(s) + " 陈述 · "
      + (kinds.has("judge") && kinds.has("select") ? "○×判断＋選択" : kinds.has("judge") ? "○×判断" : "選択")));
    const bar = el("div", "bar"), i = el("i");
    bar.append(i);
    const note = el("div", "n");
    if (r.meta.result) {
      const [txt, cls] = band(r.meta.result.pct);
      const b = el("b", null, r.meta.result.pct + " 分");
      note.append(b, document.createTextNode(" " + txt + " · " + fmtTime(r.meta.result.at)));
      i.style.width = r.meta.result.pct + "%";
      i.style.background = cls === "low" ? "var(--ng)" : cls === "mid" ? "#f0a500" : "var(--ok)";
    } else if (TEACHER) {
      const dn = s.groups.filter((g, k) => r.items[k] && r.items[k].ok != null).length;
      note.textContent = dn ? "已批改 " + dn + " / " + s.groups.length : "未批改";
      i.style.width = (dn / s.groups.length * 100) + "%";
    } else {
      note.textContent = sc.answered ? "已作答 " + sc.answered + " / " + s.groups.length + "（未提交）" : "未开始";
      i.style.width = (sc.answered / s.groups.length * 100) + "%";
      i.style.background = "#9aa7b8";
    }
    c.append(bar, note);
    c.onclick = () => { location.hash = "#/s/" + encodeURIComponent(s.name); };
    cards.append(c);
  });
  home.append(cards);
  document.getElementById("topbar").innerHTML = "";
}

/* ---------- 会话 ---------- */
let sess = null;
function startSheet(name, onlyWrong, fromRoute) {
  const s = byName(name);
  if (!s) return renderHome();
  if (fromRoute && sess && sess.name === name && sess.onlyWrong === !!onlyWrong) return;
  const r = itemsOf(name), prev = r.items;
  if (!r.meta.t0 && !r.meta.result) r.meta.t0 = Date.now();      // 学生版计时起点
  let groups = s.groups.map((g, i) => ({ g, i, type: g.type, opts: g.opts }));
  if (TEACHER && onlyWrong) {
    const wrong = groups.filter(x => prev[x.i] && prev[x.i].ok === false);
    if (wrong.length) groups = wrong;
  }
  sess = { sheet: s, groups, name, onlyWrong: !!(TEACHER && onlyWrong), all: s.groups.length };
  groups.forEach(x => {
    const p = prev[x.i];
    if (p && p.picks) {
      x.picks = p.picks.slice();
      x.set = p.set !== false;
      x.confirmed = p.confirmed !== false;
      x.submitted = !!p.submitted;
    } else {
      x.picks = new Array(x.opts.length).fill(x.type === "select" ? false : null);
      x.set = false; x.confirmed = false; x.submitted = false;
    }
  });
  if (!fromRoute) location.hash = "#/s/" + encodeURIComponent(name) + (onlyWrong ? "?wrong" : "");
  renderQuiz();
}

// 老师版：答完（判断题每条都选了 / 选择题已确认）立刻批改，返回 true/false，未达条件返回 null
function grade(x) {
  if (x.type === "judge") { if (x.picks.some(v => v == null)) return null; }
  else if (!x.confirmed) return null;
  return x.opts.every((o, i) => stmtOk(x, i));
}
// 学生的答案在提交前一律不显示对错
const shown = x => TEACHER ? grade(x) != null : x.submitted;

/* ---------- 答题页 ---------- */
function renderQuiz() {
  const quiz = document.getElementById("quiz");
  document.getElementById("home").hidden = true;
  quiz.hidden = false;
  quiz.innerHTML = "";
  const { sheet, groups } = sess;
  const allSubmitted = () => groups.length > 0 && groups.every(x => x.submitted);
  const theResult = () => rec(sheet.name).meta.result;
  let submitBtn = null;

  const head = el("div", "qhead");
  const back = el("button", null, "← 返回目录");
  back.onclick = () => { location.hash = "#/"; };
  head.append(back, el("span", "name", sheet.name + (sess.onlyWrong ? "（错题重做）" : "")));
  const cnt = el("span", "k", "");
  head.append(cnt);
  const tools = el("div", "tools");
  if (TEACHER) {
    const bWrong = el("button", null, "只练错题"), bReset = el("button", null, "重做本套"),
      bAll = el("button", null, "全部批改"), bShow = el("button", null, "显示本套答案");
    bWrong.onclick = () => startSheet(sheet.name, true);
    bReset.onclick = () => { delete store[sheet.name]; persist(); startSheet(sheet.name, false); };
    bAll.onclick = () => {
      groups.forEach(x => {
        const ready = x.type === "judge" ? !x.picks.some(v => v == null) : x.set;
        if (ready) { x.confirmed = true; commit(x); }
      });
      refresh();
    };
    bShow.onclick = () => { groups.forEach(x => { x.revealed = true; }); refresh(); };
    tools.append(bWrong, bReset, bAll, bShow);
  } else {
    const bReset = el("button", null, "重做本套");
    bReset.onclick = () => {
      if (!confirm("重做将清空本套已作答内容与成绩，确认？")) return;
      delete store[sheet.name]; persist(); startSheet(sheet.name, false);
    };
    submitBtn = el("button", "primary", "提交并生成总结");
    submitBtn.onclick = () => submitSheet();
    tools.append(bReset, submitBtn);
  }
  head.append(tools);
  quiz.append(head);

  const list = el("div");
  quiz.append(list);
  const sum = el("div", "summary");
  quiz.append(sum);
  groups.forEach((x, n) => list.append(renderQ(x, n)));
  refresh();

  function paint() {
    if (TEACHER) {
      const done = groups.filter(x => grade(x) != null);
      cnt.textContent = "已批改 " + done.length + " / " + groups.length
        + (done.length ? " · 正确 " + done.filter(x => grade(x)).length
          + " · 正确率 " + Math.round(done.filter(x => grade(x)).length / done.length * 100) + "%" : "");
    } else {
      const answered = groups.filter(x => x.type === "judge" ? !x.picks.some(v => v == null) : x.set).length;
      cnt.textContent = allSubmitted()
        ? "已提交 · 本次得分 " + (theResult() ? theResult().pct : "") + " 分"
        : "已作答 " + answered + " / " + groups.length + " 题（未提交不显示对错）";
      if (submitBtn) {
        submitBtn.disabled = allSubmitted();
        submitBtn.textContent = allSubmitted() ? "已提交（可重做本套）" : "提交并生成总结";
      }
    }
  }

  function renderQ(x, n) {
    const type = x.type;
    const q = el("article", "q");
    const meta = el("div", "meta");
    if (x.g.cat) meta.append(el("span", "tag", x.g.cat));
    meta.append(el("span", "tag kind", type === "judge" ? "○×判断" : "選択（勾选原表答案）"));
    meta.append(el("span", null, "第 " + (n + 1) + " / " + groups.length + " 问"));
    q.append(meta);
    q.append(el("h3", null, x.g.topic || "（无标题）"));

    const ul = el("ul", "stmts");
    x.opts.forEach((o, i) => {
      const li = el("li");
      const txt = el("div", "txt");
      txt.append(el("div", null, o.text));
      const sol = el("div", "sol");
      if (type === "judge") {
        sol.append(el("b", o.ans === true ? "ok" : "ng", o.ans === true ? "正解 ○" : "正解 ×"));
      } else if (o.ans === true) {
        sol.append(el("b", "ok", "原表の答案"));   // 選択題の ○ は「選ばれた答え」なので断定しない
      }
      if (o.note) sol.append(document.createTextNode("　" + o.note));
      txt.append(sol);
      li.append(txt);

      const lock = () => shown(x) || x.submitted;
      const sel = el("div", type === "judge" ? "sel" : "pickbox");
      const mk = val => {
        const b = el("button", null, val === true ? "○" : "×");
        b.setAttribute("aria-pressed", String(x.picks[i] === val));
        b.onclick = () => {
          if (lock()) return;
          x.picks[i] = x.picks[i] === val ? null : val;
          x.set = true;
          commit(x);
          refresh();
        };
        return b;
      };
      if (type === "judge") {
        sel.append(mk(false), mk(true));
      } else {
        const b = el("button", null, "选中");
        b.setAttribute("aria-pressed", String(x.picks[i] === true));
        b.onclick = () => {
          if (lock()) return;
          x.picks[i] = !x.picks[i];
          x.set = true;
          commit(x);
          refresh();
        };
        sel.append(b);
      }
      li.append(sel);
      ul.append(li);
    });
    q.append(ul);

    if (TEACHER) {
      const acts = el("div", "acts");
      const check = el("button", "primary", "确认答案");
      check.onclick = () => {
        if (x.type === "judge" && x.picks.some(v => v == null)) { alert("还有未作答的陈述（判断题每条都要选 ○ 或 ×）。"); return; }
        x.confirmed = true; commit(x); refresh();
      };
      const redo = el("button", null, "重做本题");
      redo.onclick = () => {
        x.picks = new Array(x.opts.length).fill(x.type === "select" ? false : null);
        x.set = false; x.confirmed = false; x.revealed = false;
        delete itemsOf(sess.name).items[x.i];
        persist(); refresh();
      };
      acts.append(check, redo);
      q.append(acts);
    }
    const v = el("div", "verdict");
    q.append(v);
    q.__x = x; q.__v = v; q.__ul = ul;
    return q;
  }

  function commit(x) {
    const p = itemsOf(sess.name).items;
    if (TEACHER) {
      const ok = grade(x);
      if (ok == null) { delete p[x.i]; persist(); return; }     // 没批改完就不留记录
      p[x.i] = { ok, picks: x.picks.slice(), set: x.set !== false, confirmed: true };
    } else {
      p[x.i] = { picks: x.picks.slice(), set: x.set === true, submitted: x.submitted === true };
    }
    persist();
  }

  function refresh() {
    Array.prototype.forEach.call(list.children, (q, n) => {
      const x = groups[n], ul = q.__ul, v = q.__v;
      if (!x || !ul) return;
      const done = shown(x);
      q.classList.toggle("reveal", x.revealed === true && !done);
      q.classList.toggle("locked", x.submitted === true && !TEACHER);   // 提交后答案已定，按钮画灰
      Array.prototype.forEach.call(ul.children, (li, i) => {
        li.classList.toggle("pick", x.picks[i] === true);
        li.querySelectorAll("button").forEach(b => {
          const val = b.textContent === "选中" ? true : b.textContent === "○";
          b.setAttribute("aria-pressed", String(x.picks[i] === val));
        });
        const ok = done && stmtOk(x, i);
        li.classList.toggle("right", !!ok);
        li.classList.toggle("wrong", !!done && !ok);
        const note = li.querySelector(".note-mine");
        if (note) note.remove();
        if (x.submitted && !stmtOk(x, i)) {                  // 学生版：标出自己选的是什么
          const mine = x.type === "judge"
            ? (x.picks[i] == null ? "未作答" : (x.picks[i] ? "○" : "×"))
            : (x.picks[i] === true ? "选中" : "未选中");
          const n2 = el("span", "note-mine", "　你的答案：" + mine);
          n2.style.color = "var(--ng)";
          li.querySelector(".txt").append(n2);
        }
      });
      if (done) {
        const ok = TEACHER ? grade(x) : groups[n].opts.every((o, i) => stmtOk(x, i));
        v.className = "verdict show " + (ok ? "ok" : "ng");
        v.innerHTML = "";
        if (TEACHER) {
          v.append(document.createTextNode(ok ? "○ 正确" : "× 有误"));
          if (x.type === "select") {
            v.append(el("div", "why", "原表答案：" + x.opts.map((o, i) => o.ans === true ? "第" + (i + 1) + "条" : null)
              .filter(Boolean).join("、") + "。"));
          }
        } else {
          const bad = x.opts.filter((o, i) => !stmtOk(x, i)).length;
          v.append(document.createTextNode(bad ? "× 错 " + bad + " 条" : "○ 全对"));
        }
      } else {
        v.className = "verdict";
      }
    });
    paint();
    if (sum.__render) sum.__render();
  }

  /* ---------- 学生版：提交 -> 总结 ---------- */
  function submitSheet() {
    const unanswered = groups.filter(x => x.type === "judge" ? x.picks.some(v => v == null) : !x.set).length;
    if (unanswered && !confirm("还有 " + unanswered + " 题未作答，未作答的陈述按错误计分。确认提交？")) return;
    const r = itemsOf(sheet.name), now = Date.now();
    groups.forEach(x => { x.submitted = true; commit(x); });
    const sc = scoreSheet(sheet, r.items);
    r.meta.result = { ...sc, at: now, ms: now - (r.meta.t0 || now) };
    persist();
    refresh();
    sum.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderSummary() {
    const r = rec(sheet.name), res = r.meta.result;
    sum.innerHTML = "";
    if (!res || !allSubmitted()) return;
    const [txt, cls] = band(res.pct);
    sum.append(el("h2", null, "答题报告 — " + sheet.name));
    const sc = el("div", "score");
    sc.append(el("b", null, String(res.pct)), el("span", "u", "分 / 100"), el("span", "band " + (cls === "ok" ? "" : cls), txt));
    sum.append(sc);
    // 报告抬头（导出 PDF 时题目卡片会被隐藏，这里就是报告封面信息）
    const name = el("input", "nameinput");
    name.type = "text";
    name.placeholder = "姓名 / 学号（会印在报告上）";
    name.value = localStorage.getItem("sdq.name") || "";
    name.oninput = () => localStorage.setItem("sdq.name", name.value);
    const kv = el("div", "kv");
    const kvrow = (k, v) => { const d = el("div", "kvrow"); d.append(el("span", "k", k), typeof v === "string" ? el("span", "v", v) : v); return d; };
    kv.append(kvrow("套题", sheet.name), kvrow("姓名 / 学号", name),
      kvrow("正确陈述", res.okS + " / " + res.nS), kvrow("全对题组", res.okG + " / " + res.nG),
      kvrow("已作答", res.answered + " / " + res.nG), kvrow("用时", fmtMs(res.ms)),
      kvrow("提交时间", fmtTime(res.at)));
    sum.append(kv);
    sum.append(el("p", "hint", "未作答按错误计分；分数 = 正确陈述 ÷ 总陈述 × 100。"));

    const tbl = el("table", "tbl");
    tbl.innerHTML = "<tr><th>#</th><th>要点</th><th>类型</th><th>结果</th></tr>";
    sheet.groups.forEach((g, i) => {
      const it = r.items[i] || {};
      const picks = it.picks;
      const touched = picks ? (g.type === "judge" ? picks.some(v => v != null) : it.set === true) : false;
      const bad = g.opts.filter((o, k) => {
        const p = picks ? picks[k] : null;
        const judged = g.type === "judge" ? p != null : touched;
        return !(judged && (o.ans === true) === (p === true));
      }).length;
      const tr = el("tr");
      tr.append(el("td", null, String(i + 1)), el("td", null, g.topic || g.cat || ""),
        el("td", null, g.type === "judge" ? "○×判断" : "選択"));
      const td = el("td", null, bad ? "× 错 " + bad + " 条" : "○ 全对");
      td.style.color = bad ? "var(--ng)" : "var(--ok)";
      tr.append(td); tbl.append(tr);
    });
    sum.append(el("h2", null, "逐题结果"), tbl);

    const wrong = sheet.groups.map((g, i) => [g, i]).filter(([g, i]) => {
      const it = r.items[i] || {}, picks = it.picks;
      const touched = picks ? (g.type === "judge" ? picks.some(v => v != null) : it.set === true) : false;
      return g.opts.some((o, k) => {
        const p = picks ? picks[k] : null;
        const judged = g.type === "judge" ? p != null : touched;
        return !(judged && (o.ans === true) === (p === true));
      });
    });
    sum.append(el("h2", null, "错题与解说（" + wrong.length + " 题）"));
    if (!wrong.length) sum.append(el("p", "hint", "全部正确。"));
    wrong.forEach(([g, i]) => {
      const picks = (r.items[i] || {}).picks;
      const box = el("div", "wrongitem");
      box.append(el("div", "stem", "第 " + (i + 1) + " 题 · " + (g.topic || g.cat || "") + "（" + (g.type === "judge" ? "○×判断" : "選択") + "）"));
      const touched = picks ? (g.type === "judge" ? picks.some(v => v != null) : (r.items[i] || {}).set === true) : false;
      g.opts.forEach((o, k) => {
        const mine = picks === null || picks === undefined ? null : picks[k];
        const judged = g.type === "judge" ? mine != null : touched;
        const mineOk = judged && (o.ans === true) === (mine === true);
        const d = el("div");
        d.append(el("div", null, o.text));
        const line = el("div");
        const mineTxt = g.type === "judge" ? (mine == null ? "未作答" : mine ? "○" : "×")
          : (mine === true ? "选中" : "未选中");
        const realTxt = g.type === "judge" ? (o.ans === true ? "○" : "×") : (o.ans === true ? "选中" : "未选中");
        const m = el("span", mineOk ? "real" : "mine", "你的答案：" + mineTxt + "　");
        const t = el("span", "real", "正解：" + realTxt);
        line.append(m, t);
        if (o.note) line.append(el("div", "note", o.note));
        d.append(line);
        if (!mineOk) box.append(d);
      });
      sum.append(box);
    });

    const pr = el("button", "primary no-print", "导出 PDF 报告");
    pr.onclick = () => window.print();      // 浏览器打印对话框里选「存储为 PDF」；打印媒体下只留本报告
    const back2 = el("button", "no-print", "返回目录");
    back2.onclick = () => { location.hash = "#/"; };
    const acts = el("div", "acts no-print");
    acts.append(pr, back2);
    sum.append(acts);
    sum.append(el("p", "rptfoot", "报告生成 " + fmtTime(Date.now()) + " · SD 認定試験 過去問クイズ · https://github.com/raysource/sap-quiz"));
  }
  sum.__render = renderSummary;
  renderSummary();
}

/* ---------- 路由 ---------- */
function route() {
  const h = decodeURIComponent(location.hash || "#/");
  const m = h.match(/^#\/s\/(.+?)(\?wrong)?$/);
  if (m) return startSheet(m[1], !!m[2], true);
  sess = null;
  document.getElementById("quiz").hidden = true;
  document.getElementById("home").hidden = false;
  renderHome();
}
document.getElementById("src").textContent = window.QUIZ.source || "";
window.addEventListener("hashchange", route);
window.SDQ = { boot: route, fnv };
if (!document.body.hasAttribute("data-gate")) route();     // 老师版登录后再 boot
