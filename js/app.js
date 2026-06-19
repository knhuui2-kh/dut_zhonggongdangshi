/* 中共党史刷题 — 前端逻辑
 * 纯静态：题库 JSON + localStorage，无后端。
 * 单选/判断：点击选项即判分；多选/填空：作答后点提交。
 * 错题本复用刷题卡片 UI，仅展示做错的题。
 */
(function () {
  "use strict";

  var DATA_FILE = "data/demo.json"; // 全量时改为 "data/questions.json"
  var STORE_KEY = "zgds_quiz_v1";
  var TYPE_LABEL = { single: "单选题", multiple: "多选题", judge: "判断题", blank: "填空题" };
  var VIEW_TITLE = { practice: "题库挑战", wrong: "错题本", settings: "设置" };

  var state = {
    all: [],
    deck: [],         // 当前正在刷的题目序列
    idx: 0,
    view: "practice", // practice | wrong | settings
    mode: "seq",      // seq | rand
    filter: "all",
    records: {},      // origId -> { answer, correct }
    wrong: {},        // origId -> true
    idxByView: { practice: 0, wrong: 0 },
  };

  /* ---------- 持久化 ---------- */
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      state.records = d.records || {};
      state.wrong = d.wrong || {};
      state.mode = d.mode || "seq";
      state.filter = d.filter || "all";
    } catch (e) {}
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        records: state.records, wrong: state.wrong, mode: state.mode, filter: state.filter,
      }));
    } catch (e) {}
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
  function normalize(s) {
    return (s || "").replace(/\s+/g, "")
      .replace(/[，。、；：！？,.;:!?"'""''（）()《》]/g, "").toLowerCase();
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- 判分 ---------- */
  function judge(q, ua) {
    if (q.type === "blank") {
      var accepted = q.answer.split(/[\/;；]/).map(normalize).filter(Boolean);
      return accepted.indexOf(normalize(ua)) !== -1;
    }
    if (q.type === "multiple") {
      var a = (ua || "").split("").sort().join("");
      return a.length > 0 && a === q.answer.split("").sort().join("");
    }
    return ua === q.answer; // single / judge
  }

  /* ---------- 牌组构建 ---------- */
  function practiceDeck() {
    var arr = state.all;
    if (state.filter !== "all") {
      arr = arr.filter(function (q) { return q.type === state.filter; });
    }
    return state.mode === "rand" ? shuffle(arr) : arr.slice();
  }
  function wrongDeck() {
    var arr = state.all.filter(function (q) { return state.wrong[q.origId]; });
    return state.mode === "rand" ? shuffle(arr) : arr;
  }

  /* ---------- 顶栏 / 标签状态 ---------- */
  function refreshChrome() {
    $("viewTitle").textContent = VIEW_TITLE[state.view];
    var total = state.deck.length;
    var pos = total ? (state.idx + 1) : 0;
    var label = pos + "/" + total;
    $("progressSub").textContent = state.view === "settings" ? "" : label;
    $("navIndex").textContent = label;

    var wc = Object.keys(state.wrong).length;
    var badge = $("wrongCount");
    badge.textContent = wc;
    badge.classList.toggle("zero", wc === 0);

    document.querySelectorAll(".tabitem").forEach(function (t) {
      t.classList.toggle("active", t.dataset.view === state.view);
    });

    var navHidden = state.view === "settings" || total === 0;
    $("navrow").classList.toggle("hidden", navHidden);
    if (!navHidden) {
      $("prevBtn").disabled = state.idx <= 0;
      $("nextBtn").disabled = state.idx >= total - 1;
    }
  }

  /* ---------- 渲染题卡 ---------- */
  function renderCard() {
    var card = $("card");
    card.classList.remove("hidden");
    $("settingsView").classList.add("hidden");
    card.innerHTML = "";

    var q = state.deck[state.idx];
    if (!q) {
      var msg = state.view === "wrong" ? "暂无错题，继续加油！" : "该题型下暂无题目。";
      card.appendChild(el("p", "empty", msg));
      refreshChrome();
      return;
    }
    var rec = state.records[q.origId];

    var head = el("div", "q-head");
    head.appendChild(el("span", "type-tag", TYPE_LABEL[q.type]));
    (q.points || []).forEach(function (p) { head.appendChild(el("span", "points-tag", p)); });
    card.appendChild(head);

    card.appendChild(el("p", "q-text", q.question));

    if (q.type === "blank") renderBlank(card, q);
    else renderChoices(card, q);

    var fb = el("div", "feedback"); fb.id = "feedback"; card.appendChild(fb);

    // 多选/填空需要提交按钮；单选/判断点击即判分
    if (q.type === "multiple" || q.type === "blank") {
      var actions = el("div", "actions");
      var submit = el("button", "btn", "提交"); submit.id = "submitBtn";
      submit.addEventListener("click", onSubmit);
      actions.appendChild(submit);
      card.appendChild(actions);
    }

    if (rec) showAnswered(q, rec);
    refreshChrome();
  }

  function renderChoices(card, q) {
    var box = el("div", "options");
    var multi = q.type === "multiple";
    q.options.forEach(function (o) {
      var row = el("div", "option");
      row.dataset.key = o.key;
      var key = el("span", "opt-key", o.key);
      var txt = el("span", "opt-text", o.text);
      row.appendChild(key); row.appendChild(txt);
      row.addEventListener("click", function () {
        if (state.records[q.origId]) return; // 已作答
        if (multi) {
          row.classList.toggle("selected");
        } else {
          // 单选/判断：选中并立即判分
          box.querySelectorAll(".option").forEach(function (x) { x.classList.remove("selected"); });
          row.classList.add("selected");
          submitAnswer(q, o.key);
        }
      });
      box.appendChild(row);
    });
    card.appendChild(box);
  }

  function renderBlank(card, q) {
    var input = document.createElement("input");
    input.type = "text"; input.className = "blank-input"; input.id = "blankInput";
    input.placeholder = "输入答案后点提交"; input.autocomplete = "off";
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") onSubmit(); });
    card.appendChild(input);
  }

  /* ---------- 提交与反馈 ---------- */
  function onSubmit() {
    var q = state.deck[state.idx];
    if (!q || state.records[q.origId]) return;
    var ua;
    if (q.type === "blank") {
      var inp = $("blankInput");
      ua = inp ? inp.value.trim() : "";
    } else {
      var keys = [];
      $("card").querySelectorAll(".option.selected").forEach(function (r) { keys.push(r.dataset.key); });
      ua = keys.sort().join("");
    }
    if (!ua) { flash("请先作答"); return; }
    submitAnswer(q, ua);
  }

  function submitAnswer(q, ua) {
    var correct = judge(q, ua);
    state.records[q.origId] = { answer: ua, correct: correct };
    if (correct) delete state.wrong[q.origId];
    else state.wrong[q.origId] = true;
    save();
    showAnswered(q, state.records[q.origId]);
    refreshChrome();
  }

  function showAnswered(q, rec) {
    var submit = $("submitBtn");
    if (submit) submit.disabled = true;

    if (q.type === "blank") {
      var inp = $("blankInput");
      if (inp) { inp.value = rec.answer; inp.disabled = true; }
    } else {
      $("card").querySelectorAll(".option").forEach(function (row) {
        var key = row.dataset.key;
        row.classList.add("disabled");
        var chosen = rec.answer.indexOf(key) !== -1;
        var isAns = q.answer.indexOf(key) !== -1;
        row.classList.remove("selected");
        if (isAns) {
          row.classList.add("correct");
          row.appendChild(el("span", "opt-mark", "✓"));
        } else if (chosen) {
          row.classList.add("wrong");
          row.appendChild(el("span", "opt-mark", "✗"));
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
    fb.appendChild(el("div", "feedback-title " + (rec.correct ? "ok" : "no"),
      rec.correct ? "✓ 回答正确" : "✗ 回答错误"));

    var ans = el("div", "feedback-row");
    ans.innerHTML = "正确答案：<strong>" + escapeHtml(q.answer) + "</strong>";
    fb.appendChild(ans);

    if (q.type === "blank" && !rec.correct) {
      var y = el("div", "feedback-row");
      y.innerHTML = "你的答案：<strong>" + escapeHtml(rec.answer) + "</strong>（语义相同可自行核对）";
      fb.appendChild(y);
    }

    var bits = [];
    if (q.errorRate) bits.push("易错率 " + q.errorRate);
    if (q.points && q.points.length) bits.push("知识点：" + q.points.join(" / "));
    if (bits.length) fb.appendChild(el("div", "feedback-row", bits.join("　·　")));
  }

  var flashTimer = null;
  function flash(msg) {
    var fb = $("feedback");
    if (!fb) return;
    fb.className = "feedback show no";
    fb.textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      var q = state.deck[state.idx];
      if (q && !state.records[q.origId]) fb.className = "feedback";
    }, 1400);
  }

  /* ---------- 导航 / 视图 ---------- */
  function go(delta) {
    var n = state.idx + delta;
    if (n < 0 || n >= state.deck.length) return;
    state.idx = n;
    state.idxByView[state.view] = n;
    renderCard();
  }
  function jumpTo(num) {
    var n = parseInt(num, 10);
    if (isNaN(n) || n < 1 || n > state.deck.length) { flash("题号范围 1–" + state.deck.length); return; }
    state.idx = n - 1;
    state.idxByView[state.view] = state.idx;
    showView("practice");
  }

  function rebuildDeck() {
    if (state.view === "wrong") state.deck = wrongDeck();
    else state.deck = practiceDeck();
    var saved = state.idxByView[state.view] || 0;
    state.idx = Math.min(saved, Math.max(0, state.deck.length - 1));
  }

  function showView(view) {
    state.view = view;
    if (view === "settings") {
      $("card").classList.add("hidden");
      $("settingsView").classList.remove("hidden");
      refreshChrome();
      return;
    }
    rebuildDeck();
    renderCard();
  }

  /* ---------- 事件 ---------- */
  function setMode(mode) {
    state.mode = mode;
    $("modeSeq").classList.toggle("active", mode === "seq");
    $("modeRand").classList.toggle("active", mode === "rand");
    save();
    state.idxByView = { practice: 0, wrong: 0 };
  }

  function bindEvents() {
    $("prevBtn").addEventListener("click", function () { go(-1); });
    $("nextBtn").addEventListener("click", function () { go(1); });
    $("jumpBtn").addEventListener("click", function () { jumpTo($("jumpInput").value); });
    $("jumpInput").addEventListener("keydown", function (e) { if (e.key === "Enter") jumpTo(this.value); });

    $("modeSeq").addEventListener("click", function () { setMode("seq"); });
    $("modeRand").addEventListener("click", function () { setMode("rand"); });
    $("typeFilter").addEventListener("change", function () {
      state.filter = this.value; save();
      state.idxByView.practice = 0;
    });
    $("resetBtn").addEventListener("click", function () {
      if (confirm("确定清空全部答题进度与错题本？不可撤销。")) {
        state.records = {}; state.wrong = {}; save();
        state.idxByView = { practice: 0, wrong: 0 };
        showView("practice");
      }
    });

    document.querySelectorAll(".tabitem").forEach(function (t) {
      t.addEventListener("click", function () { showView(t.dataset.view); });
    });

    // 键盘左右切题（非输入态）
    document.addEventListener("keydown", function (e) {
      if (state.view === "settings") return;
      if (e.target.tagName === "INPUT") return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    });

    // 左右滑动切题
    var sx = 0, sy = 0;
    var stage = document.querySelector(".stage");
    stage.addEventListener("touchstart", function (e) {
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    stage.addEventListener("touchend", function (e) {
      if (state.view === "settings") return;
      var dx = e.changedTouches[0].clientX - sx;
      var dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        go(dx < 0 ? 1 : -1);
      }
    }, { passive: true });
  }

  /* ---------- 初始化 ---------- */
  function init() {
    load();
    fetch(DATA_FILE)
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        state.all = data;
        $("typeFilter").value = state.filter;
        $("modeSeq").classList.toggle("active", state.mode === "seq");
        $("modeRand").classList.toggle("active", state.mode === "rand");
        $("metaInfo").textContent = "题库共 " + data.length + " 题";
        bindEvents();
        showView("practice");
      })
      .catch(function (err) {
        $("card").innerHTML = '<p class="empty">题库加载失败：' + escapeHtml(err.message) +
          "<br>本地预览需通过服务器访问（见 README）。</p>";
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();


