# -*- coding: utf-8 -*-
"""解析 pdftotext 提取的题库文本为结构化 JSON。

题型与格式（每题以 `数字、【题型】` 开头）：
- 单选题/多选题: `• A、xxx • B、xxx ...` + `正确答案：X` / `ABC`
- 判断题: `• A、正确 • B、错误` + `正确答案：A/B`
- 填空题: 文本答案，位于 `正确答案：` 与 `所答答案：`(或 `易错率：`)之间
公共尾部: `易错率：x.xx% 知识点：a|b`
"""
import json
import re
import sys

TYPE_MAP = {"单选题": "single", "多选题": "multiple", "判断题": "judge", "填空题": "blank"}

# 切分每道题：捕获 题号 与 题型
SPLIT_RE = re.compile(r"(?=(?:^|\s)(\d+)、【(单选题|多选题|判断题|填空题)】)")
HEAD_RE = re.compile(r"^(\d+)、【(单选题|多选题|判断题|填空题)】\s*(.*)$", re.S)


def collapse(text):
    """把块内连续空白（含换行）压成单个空格。中文不依赖空格分词，安全。"""
    return re.sub(r"\s+", " ", text).strip()


# 两个 CJK 字符之间的空格来自 PDF 换行，应删除；保留 ASCII/数字旁的空格
_CJK = r"一-鿿　-〿＀-￯"
_CJK_SPACE_RE = re.compile(rf"(?<=[{_CJK}]) +(?=[{_CJK}])")


def clean_cjk(text):
    """删除中文字符之间因换行产生的空格，保留 '2019 年' 这类数字/字母间距。"""
    if not text:
        return text
    prev = None
    # 反复执行以处理连续三字以上的情形（A 空格 B 空格 C）
    while prev != text:
        prev = text
        text = _CJK_SPACE_RE.sub("", text)
    return text.strip()


def parse_tail(text):
    """从尾部提取 易错率 与 知识点，返回 (error_rate, points, text_before_tail)。"""
    error_rate, points = None, []
    m_kp = re.search(r"知识点：\s*(.+)$", text)
    if m_kp:
        points = [p.strip() for p in m_kp.group(1).split("|") if p.strip()]
        text = text[: m_kp.start()]
    m_er = re.search(r"易错率：\s*([\d.]+%)", text)
    if m_er:
        error_rate = m_er.group(1)
        text = text[: m_er.start()]
    return error_rate, points, text


OPT_RE = re.compile(r"([A-Z])、\s*(.*?)(?=\s*•?\s*[A-Z]、|$)")


def parse_options(seg):
    """解析选项为 [{key,text}]。兼容带 • 与不带 • 两种格式。

    用前瞻 `(?=•?[A-Z]、|$)` 切到下一个选项标签或结尾，
    这样 `A、xxx B、yyy` 与 `• A、xxx • B、yyy` 都能正确分割。
    """
    seg = seg.replace("•", " ")
    options = []
    for m in OPT_RE.finditer(seg):
        text = m.group(2).strip()
        options.append({"key": m.group(1), "text": text})
    return options


def parse_block(num, qtype, body):
    body = collapse(body)
    idx = body.find("正确答案：")
    if idx == -1:
        return None
    pre = body[:idx].strip()
    tail = body[idx + len("正确答案："):].strip()

    error_rate, points, _ = parse_tail(body)

    q = {
        "id": int(num),
        "type": TYPE_MAP[qtype],
        "errorRate": error_rate,
        "points": points,
    }

    if qtype == "填空题":
        # 答案 = 正确答案： 与 所答答案：(或易错率/知识点) 之间
        ans_region = tail
        for stop in ["所答答案：", "易错率：", "知识点："]:
            j = ans_region.find(stop)
            if j != -1:
                ans_region = ans_region[:j]
        q["question"] = clean_cjk(pre)
        q["answer"] = clean_cjk(collapse(ans_region))
        if not q["answer"]:
            return None
    else:
        # 题干与选项分界：第一个选项标签（• A、 或 A、）
        m_opt = re.search(r"•?\s*A、", pre)
        if not m_opt:
            return None
        opt_start = m_opt.start()
        q["question"] = clean_cjk(pre[:opt_start].strip())
        q["options"] = parse_options(pre[opt_start:])
        for o in q["options"]:
            o["text"] = clean_cjk(o["text"])
        m_ans = re.match(r"^([A-Z]+)", tail)
        if not m_ans or not q["options"]:
            return None
        q["answer"] = m_ans.group(1)

    return q


def main():
    raw_path = sys.argv[1] if len(sys.argv) > 1 else "data/raw.txt"
    out_path = sys.argv[2] if len(sys.argv) > 2 else "data/questions.json"
    with open(raw_path, "r", encoding="utf-8") as f:
        text = f.read()

    # 找到所有题目起点
    starts = [(m.start(), m.group(1), m.group(2)) for m in SPLIT_RE.finditer(text)]
    questions = []
    skipped = 0
    for i, (pos, num, qtype) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(text)
        block = text[pos:end]
        hm = HEAD_RE.match(collapse(block))
        body = hm.group(3) if hm else block
        q = parse_block(num, qtype, body)
        if q:
            questions.append(q)
        else:
            skipped += 1

    # 统计
    from collections import Counter
    counts = Counter(q["type"] for q in questions)
    print(f"解析成功: {len(questions)} 题, 跳过: {skipped}")
    print(f"题型分布: {dict(counts)}")

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(questions, f, ensure_ascii=False, indent=1)
    print(f"已写入: {out_path}")


if __name__ == "__main__":
    main()
