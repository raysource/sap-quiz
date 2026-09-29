#!/usr/bin/env python3
"""设置老师版口令：python3 tools/set_password.py 新口令

把 FNV-1a 校验值写进 teacher.html 的 PW_HASH（明文不落盘）。与 assets/app.js 的 fnv() 同一算法。
注意：纯前端静态站的口令只能防误入，防不住翻看源码的人 —— 要真权限就得放到有服务端的系统里。
"""
import re, sys, pathlib

def fnv(s):
    h = 0x811c9dc5
    for ch in s:
        h = ((h ^ ord(ch)) * 0x01000193) & 0xffffffff
    return f"{h:08x}"

def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    pw = sys.argv[1]
    assert pw.strip(), "口令不能为空"
    p = pathlib.Path(__file__).resolve().parent.parent / "teacher.html"
    src = p.read_text(encoding="utf-8")
    new, n = re.subn(r'(const PW_HASH = ")[0-9a-f]{8}(";)', r"\g<1>" + fnv(pw) + r"\g<2>", src)
    assert n == 1, f"teacher.html 里没找到 PW_HASH 行（找到 {n} 处）"
    p.write_text(new, encoding="utf-8")
    print(f"已更新 {p}：PW_HASH = {fnv(pw)}（口令长度 {len(pw)}）")

if __name__ == "__main__":
    main()
