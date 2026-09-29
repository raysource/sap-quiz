#!/usr/bin/env python3
"""01_SD認定試験過去問題_日別問題試験.xls -> work/quiz.json

Per sheet, column positions vary -> detected from the header row (問題 / 選択肢 / 元(回答?) / 備考).
One sheet = one 套题; one 問題 group = topic + several 選択肢.

Question types (derived from the marks, not guessed):
  judge  = every statement carries ○/×  -> the learner judges each statement
  select = only the correct statements are marked ○, the rest are blank
           -> the learner picks the correct statements (実力テスト)
"""
import json, os, re, sys, unicodedata
import xlrd

SRC = "01_SD認定試験過去問題_日別問題試験.xls"
OUT = "work/quiz.json"
JUNK = {"同じ問題が出題", "類題が出題", "他者の問題で出題", "正誤自動表示", "問題削除"}
# 表格结束标记：其后是正解数统计与「出題キーワード」笔记区，不是题目
STOP = {"同じ問題が出題", "類題が出題", "他者の問題で出題", "★その他出題キーワード"}

def norm(s):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", str(s))).strip()

def cell(sh, r, c):
    return "" if c is None or not (0 <= c < sh.ncols) else str(sh.cell_value(r, c))

def parse_sheet(sh):
    qcol = ocol = acol = ncol = hrow = None
    for r in range(min(sh.nrows, 8)):
        cells = [norm(sh.cell_value(r, c)) for c in range(sh.ncols)]
        if "問題" in cells and "選択肢" in cells:
            hrow = r
            qcol, ocol = cells.index("問題"), cells.index("選択肢")
            for c, v in enumerate(cells):
                if c > ocol and acol is None and ("回答" in v or v == "元"):
                    acol = c
                if v == "備考":
                    ncol = c
            break
    if hrow is None:
        return []

    groups, cur = [], None
    for r in range(hrow + 1, sh.nrows):
        if any(norm(sh.cell_value(r, c)) in STOP for c in range(sh.ncols)):
            break
        q, o = norm(cell(sh, r, qcol)), norm(cell(sh, r, ocol))
        if q and not re.fullmatch(r"[\d.。．]+", q) and q not in JUNK:
            cat = ""
            for c in range(qcol - 1, max(qcol - 5, -1), -1):
                v = norm(cell(sh, r, c))
                if v and v not in JUNK and not re.fullmatch(r"[\d.。．]+", v):
                    cat = v
                    break
            cur = {"topic": q, "cat": cat, "opts": []}
            groups.append(cur)
        if o and cur is not None and o not in JUNK and not re.fullmatch(r"[\d.]+", o):
            mark = norm(cell(sh, r, acol))
            cur["opts"].append({"text": o,
                                "ans": {"○": True, "×": False}.get(mark),
                                "mark": mark,
                                "note": norm(cell(sh, r, ncol))})

    out = []
    for g in groups:
        marks = [o["mark"] for o in g["opts"]]
        if not any(m in "○×" for m in marks):
            continue                                  # nothing to grade
        # a group with a × is a ○× set; only-○-with-blanks is the 実力テスト "pick the correct ones" type
        g["type"] = "judge" if ("×" in marks or "" not in marks) else "select"
        if g["type"] == "judge":
            g["opts"] = [o for o in g["opts"] if o["ans"] is not None]   # '?' rows are ungradable
        if g["opts"]:
            out.append(g)
    return out

def check_model(sheets):
    """不变量：题组非空、判断题每条都有○/×、选择题只有被选中的条目（没有 ×）、无空文本。"""
    bad = []
    for s in sheets:
        for gi, g in enumerate(s["groups"]):
            tag = f"{s['name']}#{gi}"
            if not g["opts"]:
                bad.append(tag + " 空题组")
            if g["type"] == "judge" and any(o["ans"] is None for o in g["opts"]):
                bad.append(tag + " 判断题有未标注条目")
            if g["type"] == "select" and (not any(o["ans"] for o in g["opts"]) or any(o["ans"] is False for o in g["opts"])):
                bad.append(tag + " 选择题答案集异常")
            if not g["topic"]:
                bad.append(tag + " 缺标题")
            if any(not o["text"] for o in g["opts"]):
                bad.append(tag + " 空陈述")
    assert not bad, "模型自检失败: " + "; ".join(bad[:10])
    n = sum(len(g["opts"]) for s in sheets for g in s["groups"])
    j = sum(len(g["opts"]) for s in sheets for g in s["groups"] if g["type"] == "judge")
    return n, j

def main():
    wb = xlrd.open_workbook(SRC)
    sheets, blank = [], 0
    for sh in wb.sheets():
        gs = parse_sheet(sh)
        if not gs:
            print("WARN no questions in", sh.name, file=sys.stderr)
        sheets.append({"name": sh.name, "groups": gs})

    for s in sheets:
        n = sum(len(g["opts"]) for g in s["groups"])
        t = sum(1 for g in s["groups"] if g["type"] == "judge")
        blank += sum(1 for g in s["groups"] for o in g["opts"] if o["ans"] is None)
        print(f"{s['name']:<12} 题组 {len(s['groups']):>3}  (判断 {t:>3} / 选择 {len(s['groups'])-t:>3})  陈述 {n:>4}")

    n_opt, n_judge = check_model(sheets)
    print(f"自检通过：{n_opt} 条陈述（判断题 {n_judge} 条 / 选择题 {n_opt-n_judge} 条）")

    os.makedirs("work", exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"source": SRC, "sheets": sheets}, f, ensure_ascii=False, separators=(",", ":"))
    # the site loads this with <script>, so it works from file:// (fetch() of .json does not)
    with open("data.js", "w", encoding="utf-8") as f:
        f.write("window.QUIZ=")
        json.dump({"source": SRC, "sheets": sheets}, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    tot = sum(len(s["groups"]) for s in sheets)
    print(f"total 题组 {tot} / 陈述 {sum(len(s['groups']) and sum(len(g['opts']) for g in s['groups']) or 0 for s in sheets)}"
          f" / 无答案陈述 {blank} -> {OUT} ({os.path.getsize(OUT)//1024} KB)")

if __name__ == "__main__":
    main()
