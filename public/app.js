const LS_USER = "dbms_user";

const els = {
  sidebar: document.getElementById("sidebar"),
  main: document.getElementById("main"),
  progressValue: document.getElementById("progressValue"),
  progressFill: document.getElementById("progressFill"),
  userName: document.getElementById("userName"),
  userBtn: document.getElementById("userBtn"),
  modalBackdrop: document.getElementById("modalBackdrop")
};

let catalog = null; // { lessons: [...] }
let lessonCache = new Map(); // id -> lesson
let progress = null; // {completedLessonIds:[], exercisePasses:{}}
let activeLessonId = null;

function $(sel, root = document) {
  return root.querySelector(sel);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem(LS_USER) || "null");
  } catch {
    return null;
  }
}

function setUser(user) {
  localStorage.setItem(LS_USER, JSON.stringify(user));
  els.userName.textContent = user?.name || "Guest";
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(opts.headers || {})
    },
    ...opts
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) throw new Error(json?.error || `Request failed: ${res.status}`);
  return json;
}

function parseRoute() {
  const hash = window.location.hash || "#/home";
  const parts = hash.replace(/^#\/?/, "").split("/");
  const route = parts[0] || "home";
  const arg = parts[1] || "";
  return { route, arg };
}

function groupLessonsByModule(lessons) {
  const map = new Map();
  for (const l of lessons) {
    const key = l.module || "Module";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(l);
  }
  return Array.from(map.entries()).map(([module, list]) => ({
    module,
    lessons: list.sort((a, b) => (a.topicOrder - b.topicOrder) || (a.order - b.order) || a.title.localeCompare(b.title))
  }));
}

function computeProgressPercent() {
  const lessons = catalog?.lessons || [];
  const lessonIds = new Set(lessons.map((l) => l.id));
  const total = lessons.length;
  const done = (progress?.completedLessonIds || []).filter((id) => lessonIds.has(id)).length;
  if (!total) return 0;
  return Math.round((done / total) * 100);
}

function renderProgress() {
  const pct = computeProgressPercent();
  els.progressValue.textContent = `${pct}%`;
  els.progressFill.style.width = `${pct}%`;
  const pb = $(".progress__bar");
  if (pb) pb.setAttribute("aria-valuenow", String(pct));
}

function openModal(node) {
  els.modalBackdrop.replaceChildren(node);
  els.modalBackdrop.hidden = false;
  const onKey = (e) => {
    if (e.key === "Escape") closeModal();
  };
  window.addEventListener("keydown", onKey, { once: true });

  node.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeModal(), { once: true }));
}

function closeModal() {
  els.modalBackdrop.hidden = true;
  els.modalBackdrop.replaceChildren();
}

function buildNoticeModal(message) {
  const tpl = document.getElementById("noticeTpl");
  const node = tpl.content.cloneNode(true);
  const modal = node.querySelector(".modal");
  node.getElementById("noticeMsg").textContent = String(message || "");
  modal.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeModal(), { once: true }));
  return modal;
}

function isLessonCompleted(id) {
  return Boolean(progress?.completedLessonIds?.includes(id));
}

function isLessonUnlocked(id) {
  const lessons = catalog?.lessons || [];
  const idx = lessons.findIndex((l) => l.id === id);
  if (idx < 0) return false;
  if (idx === 0) return true;
  const prevId = lessons[idx - 1]?.id;
  return prevId ? isLessonCompleted(prevId) : true;
}

function prevNextFor(id) {
  const lessons = catalog?.lessons || [];
  const idx = lessons.findIndex((l) => l.id === id);
  if (idx < 0) return { prevId: "", nextId: "" };
  const prevId = lessons[idx - 1]?.id || "";
  const nextId = lessons[idx + 1]?.id || "";
  return { prevId, nextId };
}

async function loadCatalog() {
  const res = await api("/api/catalog");
  // server returns already ordered; keep as-is for gating/index math
  catalog = { lessons: res.lessons || [] };
}

async function loadProgress() {
  const user = getUser();
  if (!user?.userId) {
    progress = null;
    renderProgress();
    return;
  }
  const res = await api(`/api/progress/${encodeURIComponent(user.userId)}`);
  progress = res.progress;
  renderProgress();
}

async function register(name, email) {
  const res = await api("/api/register", { method: "POST", body: JSON.stringify({ name, email }) });
  setUser({ userId: res.userId, name, email });
  await loadProgress();
  renderProgress();
}

async function loadLesson(id) {
  if (lessonCache.has(id)) return lessonCache.get(id);
  const res = await api(`/api/lessons/${encodeURIComponent(id)}`);
  lessonCache.set(id, res.lesson);
  return res.lesson;
}

function renderSidebar() {
  const lessons = catalog?.lessons || [];
  const groups = groupLessonsByModule(lessons);

  const frag = document.createDocumentFragment();
  for (const g of groups) {
    const wrap = document.createElement("div");
    wrap.className = "module";

    const title = document.createElement("div");
    title.className = "module__title";
    title.textContent = g.module;
    wrap.appendChild(title);

    for (const l of g.lessons) {
      const btn = document.createElement("button");
      btn.className = "lesson-link";
      btn.type = "button";
      btn.setAttribute("aria-current", l.id === activeLessonId ? "true" : "false");

      const unlocked = isLessonUnlocked(l.id);
      if (!unlocked) btn.classList.add("is-locked");

      const left = document.createElement("div");
      left.className = "lesson-link__title";
      left.textContent = l.title;

      const meta = document.createElement("div");
      meta.className = "lesson-link__meta";
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = "DBMS";
      meta.appendChild(pill);

      if (isLessonCompleted(l.id)) {
        const ok = document.createElement("span");
        ok.className = "pill pill--ok";
        ok.textContent = "✓";
        meta.appendChild(ok);
      } else if (!unlocked) {
        const lock = document.createElement("span");
        lock.className = "pill pill--lock";
        lock.textContent = "🔒";
        meta.appendChild(lock);
      }

      btn.appendChild(left);
      btn.appendChild(meta);

      btn.addEventListener("click", () => {
        if (!unlocked) {
          openModal(buildNoticeModal("This lesson is locked. Complete the previous lesson to unlock it."));
          return;
        }
        setActiveLesson(l.id);
      });

      wrap.appendChild(btn);
    }

    frag.appendChild(wrap);
  }

  els.sidebar.replaceChildren(frag);
}

function renderComponent(c) {
  const type = c?.type;
  const data = c?.data || {};

  if (type === "heading") {
    const level = Math.min(3, Math.max(2, Number(data.level || 2)));
    const el = document.createElement(level === 2 ? "h2" : "h3");
    el.textContent = String(data.text || "");
    el.style.margin = "0 0 10px 0";
    return el;
  }

  if (type === "text") {
    const p = document.createElement("p");
    p.textContent = String(data.text || "");
    p.style.margin = "0 0 10px 0";
    p.style.lineHeight = "1.65";
    return p;
  }

  if (type === "code") {
    const wrap = document.createElement("div");
    wrap.className = "code";
    const meta = document.createElement("div");
    meta.className = "code__meta";
    meta.innerHTML = `<span><strong>Example</strong></span><span>${escapeHtml(data.language || "")}</span>`;
    const pre = document.createElement("pre");
    pre.textContent = String(data.code || "");
    wrap.appendChild(meta);
    wrap.appendChild(pre);
    return wrap;
  }

  if (type === "table") {
    const cols = Array.isArray(data.columns) ? data.columns : [];
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    const table = document.createElement("table");

    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    cols.forEach((col) => {
      const th = document.createElement("th");
      th.textContent = String(col);
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      for (let i = 0; i < cols.length; i += 1) {
        const td = document.createElement("td");
        td.textContent = row?.[i] == null ? "" : String(row[i]);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  if (type === "media") {
    if (data.kind === "youtube" && data.youtubeId) {
      const div = document.createElement("div");
      div.className = "video";
      const iframe = document.createElement("iframe");
      iframe.allow =
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      iframe.allowFullscreen = true;
      iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(data.youtubeId)}?rel=0`;
      iframe.title = String(data.title || "Video");
      div.appendChild(iframe);
      return div;
    }
    if (data.kind === "image" && data.src) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = String(data.src);
      img.alt = String(data.alt || "Image");
      img.style.maxWidth = "100%";
      img.style.borderRadius = "14px";
      img.style.border = "1px solid rgba(255,255,255,0.12)";
      return img;
    }
  }

  return document.createTextNode("");
}

async function validateExercise(lessonId, answer) {
  const user = getUser();
  if (!user?.userId) {
    openModal(buildNoticeModal("Please register first to save progress."));
    return { passed: false };
  }
  return await api("/api/exercise/validate", {
    method: "POST",
    body: JSON.stringify({ lessonId, userId: user.userId, answer })
  });
}

async function markLessonComplete(lessonId) {
  const user = getUser();
  if (!user?.userId) {
    openModal(buildNoticeModal("Please register first to save progress."));
    return;
  }
  const cur = new Set(progress?.completedLessonIds || []);
  cur.add(lessonId);
  await api(`/api/progress/${encodeURIComponent(user.userId)}`, {
    method: "PUT",
    body: JSON.stringify({ completedLessonIds: Array.from(cur) })
  });
  await loadProgress();
  renderProgress();
  renderSidebar();
}

function setActiveLesson(id) {
  activeLessonId = id;
  window.location.hash = `#/learn/${encodeURIComponent(id)}`;
}

async function renderLesson(id) {
  const lesson = await loadLesson(id);
  const { prevId, nextId } = prevNextFor(id);

  const tpl = document.getElementById("lessonTpl");
  const node = tpl.content.cloneNode(true);
  const root = node.querySelector("article");

  node.getElementById("lessonModule").textContent = `Module: ${String((catalog?.lessons || []).find((l) => l.id === id)?.module || "Topic")}`;
  node.getElementById("lessonTitle").textContent = lesson.title || "Lesson";

  const content = node.getElementById("lessonContent");
  const comps = Array.isArray(lesson?.components) ? lesson.components.slice().sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0)) : [];
  const frag = document.createDocumentFragment();
  comps.filter((c) => c?.type !== "exercise").forEach((c) => {
    const el = renderComponent(c);
    frag.appendChild(el);
  });
  if (!comps.length) {
    const p = document.createElement("p");
    p.textContent = "No lesson content yet.";
    frag.appendChild(p);
  }
  content.replaceChildren(frag);

  const exerciseComp = comps.find((c) => c?.type === "exercise") || null;
  const exercisePanel = node.getElementById("exercisePanel");
  const exercisePrompt = node.getElementById("exercisePrompt");
  const exerciseAnswer = node.getElementById("exerciseAnswer");
  const exerciseBtn = node.getElementById("exerciseCheckBtn");
  const exerciseNotice = node.getElementById("exerciseNotice");

  const markBtn = node.getElementById("markCompleteBtn");
  const completionHint = node.getElementById("completionHint");

  const prevBtn = node.getElementById("prevBtn");
  const nextBtn = node.getElementById("nextBtn");

  prevBtn.disabled = !prevId || !isLessonUnlocked(prevId);
  nextBtn.disabled = true;
  prevBtn.addEventListener("click", () => prevId && setActiveLesson(prevId));

  const completed = isLessonCompleted(id);
  markBtn.textContent = completed ? "Completed" : "Mark complete";
  markBtn.disabled = completed;
  completionHint.textContent = completed ? "Lesson completed." : "";

  // Exercise gating: must pass exercise (if present) before Next enables.
  const passedExercise = Boolean(progress?.exercisePasses?.[id]?.passed) || completed;
  if (exerciseComp) {
    exercisePanel.hidden = false;
    const placeholder = exerciseComp?.data?.placeholder || "Your answer";
    exerciseAnswer.placeholder = placeholder;
    exercisePrompt.textContent = String(exerciseComp?.data?.prompt || "Answer the question to unlock Next.");

    const refreshExerciseUi = () => {
      const passedNow = Boolean(progress?.exercisePasses?.[id]?.passed) || isLessonCompleted(id);
      exerciseNotice.hidden = true;
      nextBtn.disabled = !passedNow || !nextId;
      if (!nextId) nextBtn.disabled = true;
      if (passedNow) {
        exerciseNotice.hidden = false;
        exerciseNotice.className = "notice notice--ok";
        exerciseNotice.textContent = "Correct. Next lesson unlocked.";
      }
    };

    refreshExerciseUi();

    const runCheck = async () => {
      exerciseBtn.disabled = true;
      try {
        const ans = String(exerciseAnswer.value || "");
        const res = await validateExercise(id, ans);
        await loadProgress();
        renderProgress();
        renderSidebar();
        if (res.passed) {
          exerciseNotice.hidden = false;
          exerciseNotice.className = "notice notice--ok";
          exerciseNotice.textContent = "Correct. Next lesson unlocked.";
          // also mark complete to advance gating chain
          await markLessonComplete(id);
        } else {
          exerciseNotice.hidden = false;
          exerciseNotice.className = "notice notice--bad";
          exerciseNotice.textContent = "Not quite. Try again.";
        }
        await loadProgress();
        refreshExerciseUi();
      } catch (e) {
        exerciseNotice.hidden = false;
        exerciseNotice.className = "notice notice--bad";
        exerciseNotice.textContent = String(e?.message || e);
      } finally {
        exerciseBtn.disabled = false;
      }
    };

    exerciseBtn.addEventListener("click", runCheck);
    exerciseAnswer.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runCheck();
    });
  } else {
    exercisePanel.hidden = true;
    nextBtn.disabled = !nextId;
  }

  nextBtn.addEventListener("click", () => {
    if (!nextId) return;
    if (!isLessonUnlocked(nextId)) {
      openModal(buildNoticeModal("Next lesson is locked. Complete this lesson's exercise first."));
      return;
    }
    setActiveLesson(nextId);
  });

  markBtn.addEventListener("click", async () => {
    if (exerciseComp && !(progress?.exercisePasses?.[id]?.passed)) {
      openModal(buildNoticeModal("Complete the validation exercise to mark this lesson complete."));
      return;
    }
    await markLessonComplete(id);
    markBtn.disabled = true;
    markBtn.textContent = "Completed";
  });

  els.main.replaceChildren(root);
}

function renderWelcome() {
  const tpl = document.getElementById("welcomeTpl");
  const node = tpl.content.cloneNode(true);
  const mainNode = node.querySelector("section");
  els.main.replaceChildren(mainNode);

  const form = $("#registerForm");
  const demoBtn = $("#useDemoBtn");

  demoBtn.addEventListener("click", async () => {
    const name = "Student";
    const email = `student_${Date.now()}@example.com`;
    await register(name, email);
    window.location.hash = "#/learn";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get("name") || "").trim();
    const email = String(fd.get("email") || "").trim();
    await register(name, email);
    window.location.hash = "#/learn";
  });
}

function renderHome() {
  const user = getUser();
  if (!user?.userId) return renderWelcome();

  const card = document.createElement("section");
  card.className = "card";
  card.innerHTML = `
    <div class="kicker">Welcome back</div>
    <h1 class="h1">${escapeHtml(user.name || "Student")}</h1>
    <p class="muted">Use the sidebar to follow the locked lesson path.</p>
    <div class="row" style="margin-top: 12px">
      <button class="btn btn--primary" type="button" id="goLearnBtn">Continue learning</button>
      <a class="btn" href="/admin/">Admin Dashboard</a>
    </div>
  `;
  els.main.replaceChildren(card);
  $("#goLearnBtn")?.addEventListener("click", () => (window.location.hash = "#/learn"));
}

async function renderLearn(routeLessonId) {
  const user = getUser();
  if (!user?.userId) {
    renderWelcome();
    return;
  }

  const lessons = catalog?.lessons || [];
  const fallback = lessons[0]?.id || "";
  let id = routeLessonId || activeLessonId || fallback;
  if (!id) {
    els.main.replaceChildren(buildNoticeModal("No lessons found in the catalog."));
    return;
  }

  // Guard against direct navigation to locked lessons
  if (!isLessonUnlocked(id)) id = fallback;
  activeLessonId = id;
  renderSidebar();
  await renderLesson(id);
}

function openUserMenu() {
  const user = getUser();
  const tpl = document.getElementById("userMenuTpl");
  const node = tpl.content.cloneNode(true);
  const modal = node.querySelector(".modal");
  node.getElementById("umName").textContent = user?.name || "Guest";
  node.getElementById("umEmail").textContent = user?.email || "-";

  node.getElementById("resetUserBtn").addEventListener("click", () => {
    localStorage.removeItem(LS_USER);
    progress = null;
    lessonCache = new Map();
    renderProgress();
    closeModal();
    window.location.hash = "#/home";
  });

  openModal(modal);
}

async function renderRoute() {
  const { route, arg } = parseRoute();
  const decodedArg = arg ? decodeURIComponent(arg) : "";

  if (route === "learn") {
    await renderLearn(decodedArg || null);
    return;
  }
  renderSidebar();
  renderHome();
}

async function boot() {
  els.userBtn.addEventListener("click", () => openUserMenu());
  window.addEventListener("hashchange", () => renderRoute());

  await loadCatalog();
  if (getUser()?.userId) await loadProgress();
  renderProgress();
  renderSidebar();
  await renderRoute();
}

boot().catch((e) => {
  els.main.replaceChildren(buildNoticeModal(String(e?.message || e)));
});

