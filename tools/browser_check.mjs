// 浏览器端 E2E：学生版(index.html) 与 老师版(teacher.html) 的真实点击验收（Node >= 22，零依赖）
// 运行：node tools/browser_check.mjs   （任何 FAIL 退出码 1）
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = path.join(ROOT, 'work', 'shots');
mkdirSync(SHOTS, { recursive: true });
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8793, CDP_PORT = 9334;
const PW = process.env.TEACHER_PW || 'teacher';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : '  <- ' + detail}`);
  ok ? pass++ : fail++;
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  try {
    const u = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    const buf = await readFile(path.join(ROOT, u === '/' ? '/index.html' : u));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(PORT, r));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=/tmp/cdp-quiz-${Date.now()}`, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; ; i++) {
  try { if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) break; } catch {}
  if (i > 60) { console.error('Chrome CDP 未就绪'); process.exit(2); }
  await sleep(250);
}

const target = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?url=about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0; const pending = new Map(); const consoleErrors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(JSON.stringify(m.params.args.map((a) => a.value)));
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('EXC: ' + (m.params.exceptionDetails.exception?.description || ''));
});
const send = (method, params = {}) => {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    pending.set(id, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
    setTimeout(() => { if (pending.delete(id)) rej(new Error(method + ' timeout')); }, 20000);
  });
};
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'JS exception');
  return r.result.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
};
await send('Page.enable'); await send('Runtime.enable');

// PDF 校验：页数 / 解压内容流里的文字（Chrome 用 FlateDecode）
const countPages = buf => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
const pdfText = buf => {
  const s = buf.toString('latin1'); const re = /stream\r?\n/g; let out = '', m;
  while ((m = re.exec(s))) {
    const end = s.indexOf('endstream', m.index); if (end < 0) break;
    try { out += zlib.inflateSync(Buffer.from(s.slice(m.index + m[0].length, end), 'latin1')).toString('latin1'); } catch {}
  }
  return out;
};
const go = async (page, hash = '') => { await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${page}${hash}` }); await sleep(1200); };
const STUDENT = 'index.html', TEACHER = 'teacher.html';
await go(STUDENT);
await evalJs(`localStorage.clear(); sessionStorage.clear();`);
// 按源数据作答：sheet 的第 gi 题组，correct=true 选正确答案，false 全选错
const answerGroup = (sheet, gi, correct) => evalJs(`(() => {
  const S = window.QUIZ.sheets.find(s => s.name === ${JSON.stringify(sheet)});
  const g = S.groups[${gi}];
  const card = document.querySelectorAll('#quiz .q')[${gi}];
  const lis = card.querySelectorAll('ul.stmts > li');
  [...lis].forEach((li, i) => {
    const right = g.opts[i].ans === true;
    const want = ${correct} ? right : !right;
    if (g.type === 'judge') { li.querySelectorAll('button')[want ? 1 : 0].click(); }
    else if (want) { li.querySelector('button').click(); }
  });
  if (g.type === 'select') { card.querySelector('.acts button.primary')?.click(); }
  return { type: g.type, stmts: lis.length };
})()`);

/* ════════ 学生版 ════════ */
await go(STUDENT);
check('学生版首页标题', /学生版/.test(await evalJs('document.title')));
const home = await evalJs(`(() => ({
  sets: document.querySelectorAll('#home .set').length,
  stat: document.querySelector('#home .stat').innerText.replace(/\\n/g, ' '),
  groups: window.QUIZ.sheets.reduce((a, s) => a + s.groups.length, 0)
}))()`);
check('学生版首页列出 15 套题且统计数 = 数据源', home.sets === 15 && new RegExp(String(home.groups)).test(home.stat) && home.groups === 442, JSON.stringify(home));
await shot('01-student-home');

await go(STUDENT, '#/s/' + encodeURIComponent('4日目'));
const tools0 = await evalJs(`[...document.querySelectorAll('#quiz .qhead .tools button')].map(b => b.textContent)`);
check('学生版工具条：只有 重做/提交，没有 批改/显示答案', tools0.length === 2 && /提交并生成总结/.test(tools0.join()) && !/批改|答案/.test(tools0.join()), JSON.stringify(tools0));
const a0 = await answerGroup('4日目', 0, true);
const mid = await evalJs(`(() => {
  const c = document.querySelectorAll('#quiz .q')[0];
  return { right: document.querySelectorAll('#quiz li.right').length,
           wrong: document.querySelectorAll('#quiz li.wrong').length,
           solShown: [...document.querySelectorAll('#quiz .sol')].filter(e => getComputedStyle(e).display !== 'none').length,
           cnt: document.querySelector('#quiz .qhead .k').textContent,
           verdict: c.querySelector('.verdict').className };
})()`);
check('作答中不显示对错/正解（无标色、无解说、无判定）',
  mid.right === 0 && mid.wrong === 0 && mid.solShown === 0 && !/show/.test(mid.verdict) && /已作答 1 \/ 20/.test(mid.cnt),
  JSON.stringify({ a0, mid }));
check('未提交不显示分数', !/分/.test(mid.cnt), mid.cnt);
await shot('02-student-answering');

// 提交（先测「取消不提交」，再确认提交）
await evalJs(`window.confirm = () => false;
  [...document.querySelectorAll('#quiz .qhead .tools button')].find(b => /提交/.test(b.textContent)).click();`);
check('有未作答题时提交会先确认，取消则不提交', !/已提交/.test(await evalJs(`document.querySelector('#quiz .qhead .k').textContent`)));
await evalJs(`window.confirm = () => true;
  [...document.querySelectorAll('#quiz .qhead .tools button')].find(b => /提交/.test(b.textContent)).click();`);
await sleep(400);
const sum = await evalJs(`(() => {
  const S = window.QUIZ.sheets.find(s => s.name === '4日目');
  const n0 = S.groups[0].opts.length, total = S.groups.reduce((a, g) => a + g.opts.length, 0);
  const res = JSON.parse(localStorage.getItem('sdq.student.v1'))['4日目'].meta.result;
  const h2 = [...document.querySelectorAll('#quiz .summary h2')].map(h => h.textContent);
  return { expect: Math.round(n0 / total * 100), shown: document.querySelector('#quiz .summary .score b').textContent,
           band: document.querySelector('#quiz .summary .score .band').textContent,
           res, h2, rows: document.querySelectorAll('#quiz .summary table.tbl tr').length,
           wrongItems: document.querySelectorAll('#quiz .summary .wrongitem').length,
           mine: [...document.querySelectorAll('#quiz .summary .mine')].slice(0, 2).map(e => e.textContent.trim()),
           n0, total, cnt: document.querySelector('#quiz .qhead .k').textContent };
})()`);
check('提交后生成答题总结并给出分数（分数 = 独立算出的期望值）',
  sum.shown === String(sum.expect) && sum.res.pct === sum.expect && /答题报告/.test(sum.h2[0]) && /逐题结果/.test(sum.h2[1]),
  JSON.stringify({ expect: sum.expect, shown: sum.shown, res: sum.res, h2: sum.h2 }));
check('总结：正确陈述/全对题组/用时/错题清单齐全',
  sum.res.okS === sum.n0 && sum.res.nS === sum.total && sum.res.okG === 1 && sum.res.nG === 20 && sum.res.ms >= 0
  && sum.rows === 21 && sum.wrongItems === 19 && sum.h2.some(h => /错题与解说（19 题）/.test(h)),
  JSON.stringify({ res: sum.res, rows: sum.rows, wrongItems: sum.wrongItems }));
check('错题标出「你的答案：未作答」', sum.mine.every(t => /未作答/.test(t)) && sum.mine.length > 0, JSON.stringify(sum.mine));
check('提交后计数显示本次得分', /已提交 · 本次得分 \d+ 分/.test(sum.cnt), sum.cnt);
await shot('03-student-summary');

/* ---- 导出 PDF 报告（打印媒体 + Page.printToPDF） ---- */
await evalJs(`(() => { const i = document.querySelector('#quiz .summary .nameinput');
  i.value = 'Jason #07'; i.dispatchEvent(new Event('input')); })()`);
const rpt = await evalJs(`(() => ({
  kv: [...document.querySelectorAll('#quiz .summary .kvrow')].map(r => r.innerText.replace(/\s+/g, ' ')),
  hasName: !!document.querySelector('#quiz .summary .nameinput'),
  saved: localStorage.getItem('sdq.name'),
  foot: (document.querySelector('#quiz .summary .rptfoot') || {}).textContent || ''
}))()`);
check('报告抬头：套题/姓名/正确陈述/全对题组/已作答/用时/提交时间',
  rpt.kv.length === 7 && /4日目/.test(rpt.kv[0]) && rpt.hasName && rpt.saved === 'Jason #07'
  && rpt.kv.some(r => /正确陈述/.test(r)) && rpt.kv.some(r => /用时/.test(r)) && /github\.com\/raysource\/sap-quiz/.test(rpt.foot),
  JSON.stringify(rpt));

await send('Emulation.setEmulatedMedia', { media: 'print' });
const pm = await evalJs(`(() => {
  const txt = document.querySelector('#quiz .summary').innerText;
  return {
    card: getComputedStyle(document.querySelector('#quiz .q')).display,
    head: getComputedStyle(document.querySelector('header.site')).display,
    qhead: getComputedStyle(document.querySelector('.qhead')).display,
    acts: getComputedStyle(document.querySelector('#quiz .summary .acts')).display,
    report: getComputedStyle(document.querySelector('#quiz .summary .kv')).display,
    nameBorder: getComputedStyle(document.querySelector('.nameinput')).borderTopWidth,
    name: document.querySelector('.nameinput').value,
    hasStats: /正确陈述/.test(txt) && /答题报告/.test(txt) && /错题与解说/.test(txt),
    hasFoot: /github\\.com\\/raysource\\/sap-quiz/.test(txt)
  };
})()`);
check('打印媒体：题目卡片/页头/工具条/按钮隐藏，只剩报告正文（姓名框无边框、含统计与页脚）',
  pm.card === 'none' && pm.head === 'none' && pm.qhead === 'none' && pm.acts === 'none' && pm.report !== 'none'
  && pm.nameBorder === '0px' && pm.name === 'Jason #07' && pm.hasStats && pm.hasFoot,
  JSON.stringify(pm));

const pdf = await send('Page.printToPDF', { printBackground: true });
const buf = Buffer.from(pdf.data, 'base64');
const PDF_PATH = path.join(SHOTS, 'report-4日目.pdf');
writeFileSync(PDF_PATH, buf);
// Chrome 把文字按字体子集 CID 编码写进内容流，字节里搜不到明文；改为：页数双读一致 + 每页有大量文字绘制指令
const pages = countPages(buf);
const ops = (pdfText(buf).match(/Tj|TJ/g) || []).length;
let mdlsPages = NaN;      // mdls 是加分项：/tmp 之类没被 Spotlight 索引的目录会读出 (null)，那时跳过这一读
try {
  const m = /kMDItemNumberOfPages = (\d+)/.exec(execSync(`mdls -name kMDItemNumberOfPages "${PDF_PATH}"`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString());
  if (m) mdlsPages = Number(m[1]);
} catch {}
check('导出的 PDF 报告：签名有效、页数合理（mdls 可读时双读一致）、正文有文字绘制指令',
  buf.slice(0, 5).toString() === '%PDF-' && pages >= 2 && pages <= 12
  && (!Number.isFinite(mdlsPages) || mdlsPages === pages) && ops > 300 && buf.length > 6000,
  JSON.stringify({ pages, mdlsPages: Number.isFinite(mdlsPages) ? mdlsPages : 'n/a(未索引)', ops, bytes: buf.length }));
await send('Emulation.setEmulatedMedia', { media: '' });
await shot('09-report-print');

const locked = await evalJs(`(() => {
  const before = JSON.parse(localStorage.getItem('sdq.student.v1'))['4日目'].items[5].picks;
  const li = document.querySelectorAll('#quiz .q')[5].querySelectorAll('ul.stmts > li');
  li[0].querySelectorAll('button')[1].click();
  const after = JSON.parse(localStorage.getItem('sdq.student.v1'))['4日目'].items[5].picks;
  return { before, after, locked: JSON.stringify(before) === JSON.stringify(after) };
})()`);
check('提交后答案锁定，不可再改', locked.locked, JSON.stringify(locked));

await go(STUDENT);
const homeAfter = await evalJs(`(() => { const c = [...document.querySelectorAll('#home .set')].find(x => x.querySelector('h3').textContent === '4日目');
  return { text: c.innerText.replace(/\\n/g, ' '), stat: document.querySelector('#home .stat').innerText.replace(/\\n/g, ' ') }; })()`);
check('返回首页显示该套得分、提交时间与已交卷数',
  new RegExp(String(sum.expect) + " 分").test(homeAfter.text) && /\d{4}\/\d+\/\d+/.test(homeAfter.text)
  && /1 \/ 15 已交卷/.test(homeAfter.stat), JSON.stringify(homeAfter));
await shot('04-student-home-score');

/* ════════ 老师版（口令） ════════ */
await evalJs(`sessionStorage.clear()`);
await go(TEACHER);
const gated = await evalJs(`(() => ({ gate: !document.getElementById('gate').classList.contains('hide'),
  homeEmpty: document.getElementById('home').children.length === 0,
  gateAttr: document.body.hasAttribute('data-gate') }))()`);
check('未登录：停在登录页且后台内容未渲染', gated.gate && gated.homeEmpty && gated.gateAttr, JSON.stringify(gated));
check('未登录时看不到答案数据（#quiz 为空）', (await evalJs(`document.getElementById('quiz').children.length`)) === 0);
await shot('05-teacher-gate');

const badPw = await evalJs(`(() => {
  const f = document.getElementById('gate-form');
  document.getElementById('gate-pw').value = ${JSON.stringify(PW + '-wrong')};
  f.dispatchEvent(new Event('submit', { cancelable: true }));
  return { err: document.getElementById('gate-err').textContent,
           gate: !document.getElementById('gate').classList.contains('hide') };
})()`);
check('口令错误：提示且不进入', /错误/.test(badPw.err) && badPw.gate, JSON.stringify(badPw));

const okPw = await evalJs(`(() => {
  document.getElementById('gate-pw').value = ${JSON.stringify(PW)};
  document.getElementById('gate-form').dispatchEvent(new Event('submit', { cancelable: true }));
  return { hidden: document.getElementById('gate').classList.contains('hide'),
           sets: document.querySelectorAll('#home .set').length,
           title: document.querySelector('#home h1').textContent,
           cred: sessionStorage.getItem('sdq_teacher') };
})()`);
check('口令正确：进入且渲染老师版首页', okPw.hidden && okPw.sets === 15 && /老师版/.test(okPw.title) && okPw.cred === '1', JSON.stringify(okPw));
await shot('06-teacher-home');

await go(TEACHER, '#/s/' + encodeURIComponent('2日目'));
const tools1 = await evalJs(`[...document.querySelectorAll('#quiz .qhead .tools button')].map(b => b.textContent)`);
check('老师版工具条：只练错题/重做本套/全部批改/显示本套答案',
  /只练错题/.test(tools1.join()) && /全部批改/.test(tools1.join()) && /显示本套答案/.test(tools1.join()), JSON.stringify(tools1));
const graded = await answerGroup('2日目', 0, true);
const gv = await evalJs(`(() => { const c = document.querySelectorAll('#quiz .q')[0];
  return { verdict: c.querySelector('.verdict').textContent.trim(),
           right: c.querySelectorAll('li.right').length,
           sol: [...c.querySelectorAll('.sol')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.textContent.trim()).slice(0, 3),
           cnt: document.querySelector('#quiz .qhead .k').textContent }; })()`);
check('老师版答完即批改并显示正解与解说',
  /正确/.test(gv.verdict) && gv.right === graded.stmts && gv.sol.length === graded.stmts && gv.sol.every(t => /正解/.test(t)),
  JSON.stringify(gv));
const reveal = await evalJs(`(() => {
  [...document.querySelectorAll('#quiz .qhead .tools button')].find(b => b.textContent === '显示本套答案').click();
  return { revealed: document.querySelectorAll('#quiz .q.reveal').length,
           sol: [...document.querySelectorAll('#quiz .q.reveal .sol')].filter(e => getComputedStyle(e).display !== 'none').length };
})()`);
check('「显示本套答案」把全部题组的正解摊开', reveal.revealed > 10 && reveal.sol > 10, JSON.stringify(reveal));
await shot('07-teacher-answers');

await answerGroup('2日目', 1, false);                        // 故意答错 1 组
const wrongOnly = await evalJs(`(() => {
  [...document.querySelectorAll('#quiz .qhead .tools button')].find(b => b.textContent === '只练错题').click();
  return { name: document.querySelector('#quiz .qhead .name').textContent, cards: document.querySelectorAll('#quiz .q').length };
})()`);
check('老师版「只练错题」只留下答错的题组', /错题重做/.test(wrongOnly.name) && wrongOnly.cards === 1, JSON.stringify(wrongOnly));

await send('Emulation.setEmulatedMedia', { media: 'print' });
const tpm = await evalJs(`({ card: getComputedStyle(document.querySelector('#quiz .q')).display,
  head: getComputedStyle(document.querySelector('header.site')).display })`);
check('老师版打印保留题目卡片（学生版才隐藏）', tpm.card !== 'none' && tpm.head === 'none', JSON.stringify(tpm));
await send('Emulation.setEmulatedMedia', { media: '' });

/* ════════ 扫掠 + 收尾 ════════ */
const sweep = [];
for (const page of [STUDENT, TEACHER]) {
  for (const nm of await evalJs(`window.QUIZ.sheets.map(s => s.name)`)) {
    await go(page, '#/s/' + encodeURIComponent(nm));
    const r = await evalJs(`(() => { const s = window.QUIZ.sheets.find(x => x.name === ${JSON.stringify(nm)});
      return { want: s.groups.length, cards: document.querySelectorAll('#quiz .q').length,
               stmts: document.querySelectorAll('#quiz .q ul.stmts > li').length,
               wantStmts: s.groups.reduce((a, g) => a + g.opts.length, 0), mode: document.body.dataset.mode }; })()`);
    if (!(r.cards === r.want && r.stmts === r.wantStmts)) sweep.push({ page, nm, ...r });
  }
}
check('15 套题 × 两版本 全部渲染出正确的题组/陈述数', sweep.length === 0, JSON.stringify(sweep));
await shot('08-sweep-last');

console.log('\nconsole errors: ' + (consoleErrors.length ? consoleErrors.slice(0, 5).join(' || ') : 'none'));
check('全流程无 console 错误', consoleErrors.length === 0, String(consoleErrors.length));
console.log(`\n=== browser E2E: PASS ${pass} / FAIL ${fail} ===`);
ws.close(); chrome.kill(); server.close();
process.exit(fail ? 1 : 0);
