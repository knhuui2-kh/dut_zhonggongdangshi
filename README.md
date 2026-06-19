# 中共党史刷题

一个纯静态的党史题库刷题网站，使用 GitHub Pages 托管。无后端，答题进度与错题本保存在浏览器本地（localStorage）。

## 功能

- **四种题型**：单选题、多选题、判断题、填空题
- **即时判分**：提交后立即显示对错、正确答案、易错率与知识点
- **进度本地保存**：刷新或重开浏览器不丢失
- **错题本**：自动收集做错的题，可单独练习
- **顺序 / 随机** 两种刷题模式
- 按题型筛选、题号跳转、键盘 ← → 切题

## 目录结构

```
index.html          入口页面
css/style.css       样式
js/app.js           逻辑（题库加载、判分、存储）
data/demo.json      25 题演示题库（当前启用）
data/questions.json 全量题库（解析自 PDF，1486 题）
scripts/            题库解析脚本（开发用，不影响网站运行）
```

## 切换到全量题库

编辑 `js/app.js` 顶部：

```js
var DATA_FILE = "data/demo.json";   // 改为 "data/questions.json"
```

## 本地预览

由于使用 `fetch` 加载 JSON，需通过本地服务器访问（不能直接双击打开 html）：

```bash
python -m http.server 8000
# 浏览器打开 http://localhost:8000
```

## 重新生成题库

```bash
pdftotext -enc UTF-8 "中共党史409页题库.pdf" data/raw.txt
python scripts/parse_questions.py data/raw.txt data/questions.json
python scripts/make_demo.py
```

## 说明

- 填空题答案为自由文本，判分时会忽略空格与标点；若你的答案与标准答案语义相同但判为错误，可对照标准答案自行核对。
- 题库由 PDF 自动解析，少数填空题因 PDF 排版换行可能存在文字顺序问题，已在 demo 中筛除。
