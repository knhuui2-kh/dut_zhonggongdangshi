/* 中共党史刷题 — 前端逻辑
 * 纯静态：题库 JSON + localStorage，无后端。
 * 单选/判断：点击选项即判分；多选/填空：作答后点提交。
 * 错题本复用刷题卡片 UI，仅展示做错的题。
 */
(function () {
  "use strict";

  var DATA_FILE = "data/questions.json"; // 全量 1486 题（demo: data/demo.json）
  var STORE_KEY = "zgds_quiz_v1";
  var ORDER_VERSION = 2; // 顺序生成算法版本：变更后自动按新规则重建顺序
  var TYPE_LABEL = { single: "单选题", multiple: "多选题", judge: "判断题", blank: "填空题" };
  var VIEW_TITLE = { practice: "题库挑战", wrong: "错题本", settings: "设置" };

  // 每 100 题一组的题型配额与排列顺序（按总体占比：单选/多选各30，判断/填空各20）
  var TYPE_SEQUENCE = ["single", "multiple", "judge", "blank"];
  var GROUP_QUOTA = { single: 30, multiple: 30, judge: 20, blank: 20 };

  var state = {
    all: [],
    byId: {},         // origId -> 题目
    order: [],        // 固定顺序（origId 数组），首次生成后持久化
    orderVersion: 0,  // 已存顺序所用算法版本
    deck: [],         // 当前正在刷的题目序列
    idx: 0,
    view: "practice", // practice | wrong | settings
    threshold: 2,     // 错题需连续答对几次才移出错题本
    cardLocked: false,// 当前卡片本次是否已作答
    wrongPending: null,// 错题本中刚作答、待前进时处理的题 origId
    records: {},      // origId -> { answer, correct }
    wrong: {},        // origId -> 剩余需答对次数
    idxByView: { practice: 0, wrong: 0 },
  };

  /* ---------- 持久化 ---------- */
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      state.records = d.records || {};
      state.threshold = d.threshold >= 1 ? d.threshold : 2;
      state.order = Array.isArray(d.order) ? d.order : [];
      state.orderVersion = d.orderVersion || 0;
      state.idxByView = d.idxByView || { practice: 0, wrong: 0 };
      // 错题：兼容旧版布尔值，统一为剩余需答对次数
      state.wrong = {};
      var w = d.wrong || {};
      Object.keys(w).forEach(function (k) {
        var v = w[k];
        state.wrong[k] = (typeof v === "number" && v >= 1) ? v : state.threshold;
      });
    } catch (e) {}
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        records: state.records, wrong: state.wrong, threshold: state.threshold,
        order: state.order, orderVersion: state.orderVersion, idxByView: state.idxByView,
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
  // 题库牌组：全部题目，按固定顺序（state.order）排列
  function practiceDeck() {
    return state.order.map(function (id) { return state.byId[id]; }).filter(Boolean);
  }
  // 错题牌组：错题集合，沿用同一固定顺序
  function wrongDeck() {
    return practiceDeck().filter(function (q) { return state.wrong[q.origId]; });
  }

  // 结构化顺序：每 100 题一组，组内按 单选→多选→判断→填空 排列；
  // 每题型内部随机抽取（每人独立随机、打开后固定）。题型用尽后跳过其配额。
  function buildStructuredOrder(data) {
    var pools = {};
    TYPE_SEQUENCE.forEach(function (t) {
      pools[t] = shuffle(data.filter(function (q) { return q.type === t; })
        .map(function (q) { return q.origId; }));
    });
    var order = [];
    var remaining = function () {
      return TYPE_SEQUENCE.reduce(function (s, t) { return s + pools[t].length; }, 0);
    };
    while (remaining() > 0) {
      TYPE_SEQUENCE.forEach(function (t) {
        var take = Math.min(GROUP_QUOTA[t], pools[t].length);
        for (var i = 0; i < take; i++) order.push(pools[t].shift());
      });
    }
    return order;
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
      // 错题本中有待处理题时，"下一题"始终可用（即便最后一题，也需点它触发移出/后移）
      var pending = state.view === "wrong" && state.wrongPending != null;
      $("nextBtn").disabled = state.idx >= total - 1 && !pending;
    }
  }

  /* ---------- 渲染题卡 ---------- */
  function renderCard() {
    var card = $("card");
    card.classList.remove("hidden");
    $("settingsView").classList.add("hidden");
    card.innerHTML = "";
    state.cardLocked = false;

    var q = state.deck[state.idx];
    if (!q) {
      var msg = state.view === "wrong" ? "暂无错题，继续加油！" : "该题型下暂无题目。";
      card.appendChild(el("p", "empty", msg));
      refreshChrome();
      return;
    }
    // 错题本始终呈现原始题目供二次作答；刷题页回显历史作答
    var rec = state.view === "wrong" ? null : state.records[q.origId];

    var head = el("div", "q-head");
    head.appendChild(el("span", "type-tag", TYPE_LABEL[q.type]));
    (q.points || []).forEach(function (p) { head.appendChild(el("span", "points-tag", p)); });
    if (state.view === "wrong") {
      var left = state.wrong[q.origId];
      head.appendChild(el("span", "points-tag", "再答对 " + left + " 次移出"));
    }
    card.appendChild(head);

    // 题干/选项/反馈放入可滚动主体，题头固定
    var body = el("div", "card-body");
    body.appendChild(el("p", "q-text", q.question));

    if (q.type === "blank") renderBlank(body, q);
    else renderChoices(body, q);

    var fb = el("div", "feedback"); fb.id = "feedback"; body.appendChild(fb);

    // 多选/填空需要提交按钮；单选/判断点击即判分
    if (q.type === "multiple" || q.type === "blank") {
      var actions = el("div", "actions");
      var submit = el("button", "btn", "提交"); submit.id = "submitBtn";
      submit.addEventListener("click", onSubmit);
      actions.appendChild(submit);
      body.appendChild(actions);
    }

    card.appendChild(body);

    if (rec) { state.cardLocked = true; showAnswered(q, rec); }
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
        if (state.cardLocked) return; // 本卡已作答
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
    if (!q || state.cardLocked) return;
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
    state.cardLocked = true;
    var correct = judge(q, ua);
    state.records[q.origId] = { answer: ua, correct: correct };

    if (correct) {
      // 在错题本中：连续答对递减，归零则移出
      if (state.wrong[q.origId] != null) {
        var left = state.wrong[q.origId] - 1;
        if (left <= 0) delete state.wrong[q.origId];
        else state.wrong[q.origId] = left;
      }
    } else {
      // 答错：重置为需答对 threshold 次
      state.wrong[q.origId] = state.threshold;
    }
    // 错题本中作答：标记本题待处理（前进时移出或重新插入到后面）
    if (state.view === "wrong") state.wrongPending = q.origId;
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
      if (!state.cardLocked) fb.className = "feedback";
    }, 1400);
  }

  /* ---------- 导航 / 视图 ---------- */
  // 错题本中作答后前进：已掌握(移出错题)的题从牌组删除并实时消失；
  // 未掌握的题重新插入到当前位置之后的随机处，本轮内还会再遇到。
  function commitWrongMutation() {
    var id = state.wrongPending;
    state.wrongPending = null;
    var i = state.deck.findIndex(function (q) { return q.origId === id; });
    if (i === -1) return;
    state.deck.splice(i, 1); // 先移出当前位置
    if (state.wrong[id]) {
      var rest = state.deck.length;
      var lo = Math.min(i + 1, rest); // 至少排到当前题之后
      var pos = lo + Math.floor(Math.random() * (rest - lo + 1));
      state.deck.splice(pos, 0, state.byId[id]);
    }
  }

  function go(delta) {
    // 错题本中有待处理题：前进时先变更牌组（删除/后移），停留在同一索引看下一题
    if (state.view === "wrong" && state.wrongPending != null && delta > 0) {
      commitWrongMutation();
      if (state.deck.length === 0) { renderCard(); return; }
      state.idx = Math.min(state.idx, state.deck.length - 1);
      state.idxByView.wrong = state.idx;
      renderCard();
      return;
    }
    state.wrongPending = null;
    var n = state.idx + delta;
    if (n < 0 || n >= state.deck.length) return;
    state.idx = n;
    state.idxByView[state.view] = n;
    save();
    renderCard();
  }
  function jumpTo(num) {
    var n = parseInt(num, 10);
    if (isNaN(n) || n < 1 || n > state.deck.length) { flash("题号范围 1–" + state.deck.length); return; }
    state.idx = n - 1;
    state.idxByView[state.view] = state.idx;
    save();
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
    state.wrongPending = null; // 切换视图时丢弃未前进的待处理标记
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
  function setThreshold(n) {
    n = Math.max(1, Math.min(9, n || 1));
    state.threshold = n;
    $("thValue").textContent = n;
    save();
  }

  function bindEvents() {
    $("prevBtn").addEventListener("click", function () { go(-1); });
    $("nextBtn").addEventListener("click", function () { go(1); });
    $("jumpBtn").addEventListener("click", function () { jumpTo($("jumpInput").value); });
    $("jumpInput").addEventListener("keydown", function (e) { if (e.key === "Enter") jumpTo(this.value); });

    $("thMinus").addEventListener("click", function () { setThreshold(state.threshold - 1); });
    $("thPlus").addEventListener("click", function () { setThreshold(state.threshold + 1); });
    $("resetBtn").addEventListener("click", function () {
      if (confirm("确定清空全部答题进度与错题本？不可撤销。")) {
        state.records = {}; state.wrong = {};
        state.idxByView = { practice: 0, wrong: 0 };
        save();
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
        state.byId = {};
        data.forEach(function (q) { state.byId[q.origId] = q; });

        // 固定顺序：版本一致且完整则沿用；否则按当前规则重建（结构化分组）。
        // 进度/错题以 origId 记录，重建顺序不丢数据。
        var ids = data.map(function (q) { return q.origId; });
        var present = {};
        var validOrder = state.order.filter(function (id) {
          if (state.byId[id] && !present[id]) { present[id] = true; return true; }
          return false;
        });
        var complete = validOrder.length === ids.length;
        if (state.orderVersion !== ORDER_VERSION || !complete) {
          state.order = buildStructuredOrder(data);
          state.orderVersion = ORDER_VERSION;
          state.idxByView = { practice: 0, wrong: 0 };
        } else {
          state.order = validOrder;
        }
        save();

        $("thValue").textContent = state.threshold;
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


