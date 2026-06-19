/* 中共党史刷题 — 前端逻辑
 * 纯静态：题库 JSON + localStorage，无后端。
 * 支持单选/多选/判断/填空四种题型，即时判分，错题本，顺序/随机模式。
 */
(function () {
  "use strict";

  // 切换全量题库时改为 "data/questions.json"
  var DATA_FILE = "data/demo.json";
  var STORE_KEY = "zgds_quiz_v1";

  var TYPE_LABEL = { single: "单选题", multiple: "多选题", judge: "判断题", blank: "填空题" };

  var state = {
    all: [],          // 全部题目
    list: [],         // 当前筛选/排序后的题目
    idx: 0,           // 当前题在 list 中的位置
    mode: "seq",      // seq | rand
    filter: "all",
    view: "practice",
    records: {},      // origId -> { answer, correct }
    wrong: {},        // origId -> true
  };

  /* ---------- 持久化 ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var d = JSON.parse(raw);
        state.records = d.records || {};
        state.wrong = d.wrong || {};
        state.mode = d.mode || "seq";
        state.filter = d.filter || "all";
      }
    } catch (e) { /* 忽略损坏数据 */ }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        records: state.records,
        wrong: state.wrong,
        mode: state.mode,
        filter: state.filter,
      }));
    } catch (e) { /* 配额满则忽略 */ }
  }

  /* ---------- 工具 ---------- */
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // 填空题答案归一化：去除空白与常见标点后比较
  function normalize(s) {
    return (s || "")
      .replace(/\s+/g, "")
      .replace(/[，。、；：！？,.;:!?"'""''（）()《》]/g, "")
      .toLowerCase();
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 列表构建 ---------- */
  function buildList() {
    var arr = state.all;
    if (state.filter !== "all") {
      arr = arr.filter(function (q) { return q.type === state.filter; });
    }
    state.list = state.mode === "rand" ? shuffle(arr) : arr.slice();
    state.idx = 0;
  }

  /* ---------- 判分 ---------- */
  function judge(q, userAnswer) {
    if (q.type === "blank") {
      // 多个可接受答案以 / 或 ; 分隔时任一匹配即可
      var accepted = q.answer.split(/[\/;；]/).map(normalize).filter(Boolean);
      var u = normalize(userAnswer);
      return accepted.indexOf(u) !== -1;
    }
    if (q.type === "multiple") {
      // 集合相等
      var a = (userAnswer || "").split("").sort().join("");
      var b = q.answer.split("").sort().join("");
      return a === b && a.length > 0;
    }
    // single / judge
    return userAnswer === q.answer;
  }

  /* ---------- 统计 ---------- */
  function refreshStats() {
    var total = state.list.length;
    var answeredInList = 0, correctInList = 0;
    state.list.forEach(function (q) {
      var r = state.records[q.origId];
      if (r) {
        answeredInList++;
        if (r.correct) correctInList++;
      }
    });
    $("progressText").textContent = (state.idx + 1) + "/" + total;
    $("accuracyText").textContent = answeredInList
      ? Math.round((correctInList / answeredInList) * 100) + "%"
      : "—";
    var pct = total ? ((state.idx + 1) / total) * 100 : 0;
    $("progressFill").style.width = pct + "%";
    $("wrongCount").textContent = Object.keys(state.wrong).length;
  }

  /* ---------- 渲染题卡 ---------- */
  function renderCard() {
    var card = $("card");
    card.innerHTML = "";
    var q = state.list[state.idx];
    if (!q) {
      card.appendChild(el("p", "empty", "该题型下暂无题目。"));
      refreshStats();
      return;
    }
    var rec = state.records[q.origId];

    // 头部
    var head = el("div", "q-head");
    head.appendChild(el("span", "q-index", "第 " + (state.idx + 1) + " 题"));
    head.appendChild(el("span", "type-tag", TYPE_LABEL[q.type]));
    (q.points || []).forEach(function (p) {
      head.appendChild(el("span", "points-tag", p));
    });
    card.appendChild(head);

    // 题干
    card.appendChild(el("p", "q-text", q.question));

    // 作答区
    if (q.type === "blank") {
      renderBlank(card, q, rec);
    } else {
      renderChoices(card, q, rec);
    }

    // 反馈区占位
    var fb = el("div", "feedback");
    fb.id = "feedback";
    card.appendChild(fb);

    // 操作按钮
    var actions = el("div", "actions");
    var submit = el("button", "btn", "提交");
    submit.id = "submitBtn";
    submit.addEventListener("click", onSubmit);
    actions.appendChild(submit);
    card.appendChild(actions);

    // 已作答则回显
    if (rec) {
      showAnswered(q, rec);
    }
    refreshStats();
  }

  function renderChoices(card, q, rec) {
    var box = el("div", "options");
    var inputType = q.type === "multiple" ? "checkbox" : "radio";
    q.options.forEach(function (o) {
      var label = el("label", "option");
      label.dataset.key = o.key;
      var input = document.createElement("input");
      input.type = inputType;
      input.name = "opt";
      input.value = o.key;
      label.appendChild(input);
      label.appendChild(el("span", "opt-key", o.key + "、"));
      label.appendChild(el("span", null, o.text));
      // 点击高亮
      input.addEventListener("change", function () {
        if (inputType === "radio") {
          box.querySelectorAll(".option").forEach(function (x) { x.classList.remove("selected"); });
        }
        label.classList.toggle("selected", input.checked);
      });
      box.appendChild(label);
    });
    card.appendChild(box);
  }

  function renderBlank(card, q, rec) {
    var input = document.createElement("input");
    input.type = "text";
    input.className = "blank-input";
    input.id = "blankInput";
    input.placeholder = "请输入答案后点击提交";
    input.autocomplete = "off";
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") onSubmit();
    });
    card.appendChild(input);
  }

  /* ---------- 提交与反馈 ---------- */
  function collectAnswer(q) {
    if (q.type === "blank") {
      var inp = $("blankInput");
      return inp ? inp.value.trim() : "";
    }
    var checked = $("card").querySelectorAll("input:checked");
    var keys = [];
    checked.forEach(function (c) { keys.push(c.value); });
    return keys.sort().join("");
  }

  function onSubmit() {
    var q = state.list[state.idx];
    if (!q) return;
    // 已作答则不重复判分
    if (state.records[q.origId]) return;

    var ua = collectAnswer(q);
    if (!ua) {
      flash("请先作答");
      return;
    }
    var correct = judge(q, ua);
    state.records[q.origId] = { answer: ua, correct: correct };
    if (!correct) {
      state.wrong[q.origId] = true;
    } else {
      delete state.wrong[q.origId];
    }
    save();
    showAnswered(q, state.records[q.origId]);
    refreshStats();
  }

  function showAnswered(q, rec) {
    var submit = $("submitBtn");
    if (submit) submit.disabled = true;

    if (q.type === "blank") {
      var inp = $("blankInput");
      if (inp) { inp.value = rec.answer; inp.disabled = true; }
    } else {
      // 标注正确/错误选项
      var labels = $("card").querySelectorAll(".option");
      labels.forEach(function (label) {
        var key = label.dataset.key;
        label.classList.add("disabled");
        var input = label.querySelector("input");
        var chosen = rec.answer.indexOf(key) !== -1;
        if (chosen) input.checked = true;
        if (q.answer.indexOf(key) !== -1) {
          label.classList.add("correct");
        } else if (chosen) {
          label.classList.add("wrong");
        }
      });
    }
    renderFeedback(q, rec);
  }

  function renderFeedback(q, rec) {
    var fb = $("feedback");
    if (!fb) return;
    fb.className = "feedback show " + (rec.correct ? "ok" : "no");
    fb.innerHTML = "";
    var title = el("div", "feedback-title " + (rec.correct ? "ok" : "no"),
      rec.correct ? "✓ 回答正确" : "✗ 回答错误");
    fb.appendChild(title);

    var ans = el("div", "feedback-row");
    ans.innerHTML = "正确答案：<strong>" + escapeHtml(q.answer) + "</strong>";
    fb.appendChild(ans);

    if (q.type === "blank" && !rec.correct) {
      var yours = el("div", "feedback-row");
      yours.innerHTML = "你的答案：<strong>" + escapeHtml(rec.answer) + "</strong>（如认为应判对，可对照标准答案自行核对）";
      fb.appendChild(yours);
    }

    var meta = el("div", "feedback-row");
    var bits = [];
    if (q.errorRate) bits.push("易错率 " + q.errorRate);
    if (q.points && q.points.length) bits.push("知识点：" + q.points.join(" / "));
    meta.textContent = bits.join("　·　");
    fb.appendChild(meta);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- 导航 ---------- */
  function go(delta) {
    var n = state.idx + delta;
    if (n < 0 || n >= state.list.length) return;
    state.idx = n;
    renderCard();
  }

  function jumpTo(num) {
    var n = parseInt(num, 10);
    if (isNaN(n) || n < 1 || n > state.list.length) {
      flash("题号范围 1–" + state.list.length);
      return;
    }
    state.idx = n - 1;
    renderCard();
  }

  /* ---------- 错题本 ---------- */
  function renderWrong() {
    var box = $("wrongList");
    box.innerHTML = "";
    var ids = Object.keys(state.wrong);
    if (!ids.length) {
      box.appendChild(el("p", "empty", "暂无错题，继续加油！"));
      return;
    }
    var map = {};
    state.all.forEach(function (q) { map[q.origId] = q; });
    ids.forEach(function (id) {
      var q = map[id];
      if (!q) return;
      var rec = state.records[id] || {};
      var item = el("div", "wrong-item");
      item.appendChild(el("div", "wrong-q",
        TYPE_LABEL[q.type] + "　" + q.question));
      var meta = el("div", "wrong-meta");
      meta.innerHTML = '正确答案：<span class="ans">' + escapeHtml(q.answer) +
        '</span>　你的答案：<span class="your">' + escapeHtml(rec.answer || "—") + "</span>";
      item.appendChild(meta);
      box.appendChild(item);
    });
  }

  function practiceWrong() {
    var ids = Object.keys(state.wrong);
    if (!ids.length) { flash("暂无错题"); return; }
    var set = {};
    ids.forEach(function (id) { set[id] = true; });
    state.list = state.all.filter(function (q) { return set[q.origId]; });
    if (state.mode === "rand") state.list = shuffle(state.list);
    state.idx = 0;
    switchView("practice");
    renderCard();
  }

  /* ---------- 视图切换 ---------- */
  function switchView(view) {
    state.view = view;
    $("practiceView").classList.toggle("hidden", view !== "practice");
    $("wrongView").classList.toggle("hidden", view !== "wrong");
    document.querySelectorAll(".tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.view === view);
    });
    if (view === "wrong") renderWrong();
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    $("prevBtn").addEventListener("click", function () { go(-1); });
    $("nextBtn").addEventListener("click", function () { go(1); });
    $("jumpBtn").addEventListener("click", function () { jumpTo($("jumpInput").value); });
    $("jumpInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") jumpTo(this.value);
    });

    $("modeSeq").addEventListener("click", function () { setMode("seq"); });
    $("modeRand").addEventListener("click", function () { setMode("rand"); });

    $("typeFilter").addEventListener("change", function () {
      state.filter = this.value;
      save();
      buildList();
      renderCard();
    });

    $("resetBtn").addEventListener("click", function () {
      if (confirm("确定清空全部答题进度与错题本？此操作不可撤销。")) {
        state.records = {}; state.wrong = {};
        save();
        buildList();
        renderCard();
      }
    });

    document.querySelectorAll(".tab").forEach(function (t) {
      t.addEventListener("click", function () { switchView(t.dataset.view); });
    });
    $("practiceWrongBtn").addEventListener("click", practiceWrong);
    $("clearWrongBtn").addEventListener("click", function () {
      if (confirm("确定清空错题本？")) {
        state.wrong = {}; save(); renderWrong(); refreshStats();
      }
    });

    // 键盘左右切题
    document.addEventListener("keydown", function (e) {
      if (state.view !== "practice") return;
      if (e.target.tagName === "INPUT") return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    });
  }

  function setMode(mode) {
    state.mode = mode;
    $("modeSeq").classList.toggle("active", mode === "seq");
    $("modeRand").classList.toggle("active", mode === "rand");
    save();
    buildList();
    renderCard();
  }

  /* ---------- 初始化 ---------- */
  function init() {
    load();
    fetch(DATA_FILE)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        state.all = data;
        $("typeFilter").value = state.filter;
        setMode(state.mode); // 同时 buildList + renderCard
        $("metaInfo").textContent = "题库共 " + data.length + " 题";
        bindEvents();
      })
      .catch(function (err) {
        $("card").innerHTML = '<p class="empty">题库加载失败：' + escapeHtml(err.message) +
          "<br>如在本地打开，请通过本地服务器访问（见 README）。</p>";
        $("metaInfo").textContent = "加载失败";
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();




