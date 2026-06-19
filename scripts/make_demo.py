# -*- coding: utf-8 -*-
"""从 questions.json 抽取 25 题混合 demo（4 种题型）。

填空题优先选括号位置正常（未被 PDF 换行打散）的题目。
"""
import json
import re

qs = json.load(open("data/questions.json", encoding="utf-8"))
by_type = {t: [q for q in qs if q["type"] == t] for t in ["single", "multiple", "judge", "blank"]}


def blank_is_clean(q):
    """括号内只含空白、且题干没有明显乱序（结尾不是孤立残字）。"""
    txt = q["question"]
    # 括号内应基本为空
    m = re.search(r"（([^）]*)）", txt)
    if not m or m.group(1).strip():
        return False
    # 结尾出现 '、发' '挥' 等残片视为乱序
    if re.search(r"）[、，]?[一-鿿]{1,2}$", txt):
        return False
    return True


clean_blanks = [q for q in by_type["blank"] if blank_is_clean(q)]

plan = [("single", 8), ("multiple", 7), ("judge", 5)]
demo = []
for t, n in plan:
    demo.extend(by_type[t][:n])
demo.extend(clean_blanks[:5])

# 重新编号便于 demo 展示（保留原 id 到 origId）
for i, q in enumerate(demo, 1):
    q["origId"] = q["id"]
    q["id"] = i

json.dump(demo, open("data/demo.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"demo 题数: {len(demo)}")
from collections import Counter
print("题型分布:", dict(Counter(q["type"] for q in demo)))
print(f"可用干净填空题总数: {len(clean_blanks)}")
for q in demo:
    if q["type"] == "blank":
        print(f"  填空#{q['id']}(orig {q['origId']}): {q['question']} => {q['answer']}")
