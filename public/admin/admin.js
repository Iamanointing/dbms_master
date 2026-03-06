const LS_ADMIN_TOKEN = "dbms_admin_token";
const LS_ADMIN_KEY = "dbms_admin_key"; // legacy

const els = {
  root: document.getElementById("adminRoot"),
  logoutBtn: document.getElementById("logoutBtn")
};

let adminToken = localStorage.getItem(LS_ADMIN_TOKEN) || "";
let adminKeyLegacy = localStorage.getItem(LS_ADMIN_KEY) || "";
let topicsDb = null; // {topics: [...]}
let lessonsDb = null; // {lessons: [...]}

let selectedTopicId = null;
let selectedLessonId = null;

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

function parseBool(v) {
  return String(v) === "true";
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: {
      ...(opts.headers || {}),
      "content-type": "application/json",
      ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
      ...(!adminToken && adminKeyLegacy ? { "x-admin-key": adminKeyLegacy } : {})
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

function showNotice(el, msg, kind = "info") {
  el.hidden = false;
  el.className = `notice ${kind === "ok" ? "notice--ok" : kind === "bad" ? "notice--bad" : ""}`;
  el.textContent = msg;
}

function clearNotice(el) {
  el.hidden = true;
  el.textContent = "";
}

async function refreshAll() {
  [topicsDb, lessonsDb] = await Promise.all([api("/api/admin/topics"), api("/api/admin/lessons")]);
}

function topicList() {
  return Array.isArray(topicsDb?.topics) ? topicsDb.topics : [];
}

function lessonList() {
  return Array.isArray(lessonsDb?.lessons) ? lessonsDb.lessons : [];
}

function findTopic(id) {
  return topicList().find((t) => String(t.id) === String(id)) || null;
}

function findLesson(id) {
  return lessonList().find((l) => String(l.id) === String(id)) || null;
}

async function saveTopic(topic) {
  return await api("/api/admin/topics", { method: "POST", body: JSON.stringify({ topic }) });
}

async function deleteTopic(id) {
  return await api(`/api/admin/topics/${encodeURIComponent(id)}`, { method: "DELETE" });
}

async function saveLesson(lesson) {
  return await api("/api/admin/lessons", { method: "POST", body: JSON.stringify({ lesson }) });
}

async function deleteLesson(id) {
  return await api(`/api/admin/lessons/${encodeURIComponent(id)}`, { method: "DELETE" });
}

function renderTopicsTable() {
  const rows = document.getElementById("topicRows");
  if (!rows) return;
  rows.replaceChildren();

  const topics = topicList()
    .slice()
    .sort((a, b) => (Number(a.order ?? 0) - Number(b.order ?? 0)) || String(a.title || "").localeCompare(String(b.title || "")));

  for (const t of topics) {
    const tr = document.createElement("tr");
    if (t.id === selectedTopicId) tr.classList.add("is-selected");
    tr.innerHTML = `
      <td><code>${escapeHtml(String(t.order ?? 0))}</code></td>
      <td><input type="checkbox" data-pub ${t.published === false ? "" : "checked"} /></td>
      <td>${escapeHtml(String(t.title || ""))}</td>
      <td class="row" style="justify-content:flex-end">
        <button class="btn" type="button" data-edit>Edit</button>
        <button class="btn btn--danger" type="button" data-del>Delete</button>
      </td>
    `;
    rows.appendChild(tr);

    tr.querySelector("[data-edit]")?.addEventListener("click", () => setSelectedTopic(t.id));
    tr.querySelector("[data-del]")?.addEventListener("click", async () => {
      if (!confirm(`Delete topic "${t.title}"?\n\nThis also deletes its lessons.`)) return;
      const notice = document.getElementById("topicsNotice");
      try {
        await deleteTopic(t.id);
        selectedTopicId = null;
        selectedLessonId = null;
        await refreshAll();
        renderAll();
        fillTopicForm({ id: "", title: "", track: "dbms", order: 0, published: true });
        fillLessonMetaForm({ topicId: "" });
        fillBuilderForLesson(null);
        if (notice) showNotice(notice, "Topic deleted.", "ok");
      } catch (e) {
        if (notice) showNotice(notice, String(e?.message || e), "bad");
      }
    });

    tr.querySelector("[data-pub]")?.addEventListener("change", async (e) => {
      const next = { ...t, published: Boolean(e.target.checked) };
      try {
        await saveTopic(next);
        await refreshAll();
        renderAll();
      } catch (err) {
        const notice = document.getElementById("topicsNotice");
        if (notice) showNotice(notice, String(err?.message || err), "bad");
      }
    });
  }
}

function renderLessonsTable() {
  const rows = document.getElementById("lessonRows");
  if (!rows) return;
  rows.replaceChildren();
  if (!selectedTopicId) return;

  const lessons = lessonList()
    .filter((l) => String(l.topicId || "") === String(selectedTopicId))
    .slice()
    .sort((a, b) => (Number(a.order ?? 0) - Number(b.order ?? 0)) || String(a.title || "").localeCompare(String(b.title || "")));

  for (const l of lessons) {
    const tr = document.createElement("tr");
    if (l.id === selectedLessonId) tr.classList.add("is-selected");
    tr.innerHTML = `
      <td><code>${escapeHtml(String(l.order ?? 0))}</code></td>
      <td><input type="checkbox" data-pub ${l.published === false ? "" : "checked"} /></td>
      <td>${escapeHtml(String(l.title || ""))}</td>
      <td class="row" style="justify-content:flex-end">
        <button class="btn" type="button" data-edit>Edit</button>
        <button class="btn btn--danger" type="button" data-del>Delete</button>
      </td>
    `;
    rows.appendChild(tr);

    tr.querySelector("[data-edit]")?.addEventListener("click", () => setSelectedLesson(l.id));
    tr.querySelector("[data-del]")?.addEventListener("click", async () => {
      if (!confirm(`Delete lesson "${l.title}"?`)) return;
      const notice = document.getElementById("lessonNotice");
      try {
        await deleteLesson(l.id);
        if (selectedLessonId === l.id) selectedLessonId = null;
        await refreshAll();
        renderAll();
        fillLessonMetaForm({ topicId: selectedTopicId || "" });
        fillBuilderForLesson(null);
        if (notice) showNotice(notice, "Lesson deleted.", "ok");
      } catch (e) {
        if (notice) showNotice(notice, String(e?.message || e), "bad");
      }
    });

    tr.querySelector("[data-pub]")?.addEventListener("change", async (e) => {
      const next = { ...l, published: Boolean(e.target.checked) };
      try {
        await saveLesson(next);
        await refreshAll();
        renderAll();
      } catch (err) {
        const notice = document.getElementById("lessonNotice");
        if (notice) showNotice(notice, String(err?.message || err), "bad");
      }
    });
  }
}

function fillTopicForm(topic) {
  const form = document.getElementById("topicForm");
  if (!form) return;
  form.id.value = topic?.id || "";
  form.title.value = topic?.title || "";
  form.order.value = String(topic?.order ?? 0);
  form.published.value = String(topic?.published === false ? false : true);
  const delBtn = document.getElementById("deleteTopicBtn");
  if (delBtn) delBtn.disabled = !topic?.id;
}

function fillLessonMetaForm(lesson) {
  const form = document.getElementById("lessonMetaForm");
  if (!form) return;
  form.topicId.value = lesson?.topicId || selectedTopicId || "";
  form.id.value = lesson?.id || "";
  form.title.value = lesson?.title || "";
  form.order.value = String(lesson?.order ?? 0);
  form.published.value = String(lesson?.published === false ? false : true);
  const delBtn = document.getElementById("deleteLessonBtn");
  if (delBtn) delBtn.disabled = !lesson?.id;
}

function newComponent(type, order) {
  const id = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const base = { id, type, order, data: {} };
  switch (type) {
    case "heading":
      base.data = { text: "Heading", level: 2 };
      break;
    case "text":
      base.data = { text: "Text..." };
      break;
    case "code":
      base.data = { language: "sql", code: "SELECT *\nFROM table_name;" };
      break;
    case "table":
      base.data = { columns: ["col1", "col2"], rows: [["a", "b"], ["c", "d"]] };
      break;
    case "media":
      base.data = { kind: "image", src: "", alt: "" };
      break;
    case "exercise":
      base.data = { prompt: "Question...", placeholder: "your answer", acceptedAnswers: ["answer"], correctAnswer: "answer" };
      break;
    default:
      base.data = {};
  }
  return base;
}

function renderComponentCard(comp, idx, total) {
  const div = document.createElement("div");
  div.className = "c-card";
  div.dataset.cid = comp.id;

  const title = `${idx + 1}. ${comp.type}`;
  div.innerHTML = `
    <div class="c-card__top">
      <div class="c-card__title">${escapeHtml(title)}</div>
      <div class="c-card__actions">
        <button class="btn" type="button" data-up ${idx === 0 ? "disabled" : ""}>Up</button>
        <button class="btn" type="button" data-down ${idx === total - 1 ? "disabled" : ""}>Down</button>
        <button class="btn btn--danger" type="button" data-del>Remove</button>
      </div>
    </div>
    <div class="form" style="margin-top: 10px">
      <label class="field">
        <span class="field__label">Type</span>
        <select class="input" data-type>
          <option value="heading" ${comp.type === "heading" ? "selected" : ""}>Heading</option>
          <option value="text" ${comp.type === "text" ? "selected" : ""}>Text</option>
          <option value="code" ${comp.type === "code" ? "selected" : ""}>Code</option>
          <option value="table" ${comp.type === "table" ? "selected" : ""}>Table</option>
          <option value="media" ${comp.type === "media" ? "selected" : ""}>Media</option>
          <option value="exercise" ${comp.type === "exercise" ? "selected" : ""}>Exercise</option>
        </select>
      </label>
      <div data-fields></div>
    </div>
  `;

  const fields = div.querySelector("[data-fields]");

  const renderFields = () => {
    const c = readComponentFromCard(div, comp);
    comp.type = c.type;
    comp.data = c.data;
    fields.replaceChildren(buildFieldsFor(comp));
  };

  div.querySelector("[data-type]")?.addEventListener("change", () => {
    comp.type = String(div.querySelector("[data-type]").value || "text");
    comp.data = newComponent(comp.type, comp.order).data;
    renderFields();
  });

  fields.replaceChildren(buildFieldsFor(comp));
  return div;
}

function buildFieldsFor(comp) {
  const frag = document.createDocumentFragment();
  const d = comp.data || {};

  const addField = (label, inputEl) => {
    const wrap = document.createElement("label");
    wrap.className = "field";
    const span = document.createElement("span");
    span.className = "field__label";
    span.textContent = label;
    wrap.appendChild(span);
    wrap.appendChild(inputEl);
    frag.appendChild(wrap);
  };

  if (comp.type === "heading") {
    const text = document.createElement("input");
    text.className = "input";
    text.value = String(d.text || "");
    text.setAttribute("data-k", "text");
    addField("Text", text);

    const level = document.createElement("select");
    level.className = "input";
    level.setAttribute("data-k", "level");
    level.innerHTML = `
      <option value="2">H2</option>
      <option value="3">H3</option>
    `;
    level.value = String(d.level ?? 2);
    addField("Level", level);
  }

  if (comp.type === "text") {
    const ta = document.createElement("textarea");
    ta.className = "textarea";
    ta.value = String(d.text || "");
    ta.setAttribute("data-k", "text");
    addField("Paragraph text", ta);
  }

  if (comp.type === "code") {
    const lang = document.createElement("input");
    lang.className = "input";
    lang.value = String(d.language || "sql");
    lang.setAttribute("data-k", "language");
    addField("Language", lang);

    const code = document.createElement("textarea");
    code.className = "textarea";
    code.style.fontFamily = "var(--mono)";
    code.value = String(d.code || "");
    code.setAttribute("data-k", "code");
    addField("Code", code);
  }

  if (comp.type === "table") {
    const cols = document.createElement("input");
    cols.className = "input";
    cols.value = Array.isArray(d.columns) ? d.columns.join(", ") : "";
    cols.setAttribute("data-k", "columns");
    addField("Columns (comma-separated)", cols);

    const rows = document.createElement("textarea");
    rows.className = "textarea";
    rows.style.fontFamily = "var(--mono)";
    rows.value = JSON.stringify(Array.isArray(d.rows) ? d.rows : [], null, 2);
    rows.setAttribute("data-k", "rows");
    addField("Rows (JSON array of arrays)", rows);
  }

  if (comp.type === "media") {
    const kind = document.createElement("select");
    kind.className = "input";
    kind.setAttribute("data-k", "kind");
    kind.innerHTML = `
      <option value="image">Image</option>
      <option value="youtube">YouTube</option>
    `;
    kind.value = String(d.kind || "image");
    addField("Media type", kind);

    const src = document.createElement("input");
    src.className = "input";
    src.value = String(d.src || "");
    src.placeholder = "/uploads/example.png or https://...";
    src.setAttribute("data-k", "src");
    addField("Image src (for image)", src);

    const yt = document.createElement("input");
    yt.className = "input";
    yt.value = String(d.youtubeId || "");
    yt.placeholder = "YouTube video id";
    yt.setAttribute("data-k", "youtubeId");
    addField("YouTube id (for youtube)", yt);

    const alt = document.createElement("input");
    alt.className = "input";
    alt.value = String(d.alt || "");
    alt.setAttribute("data-k", "alt");
    addField("Alt text (for image)", alt);
  }

  if (comp.type === "exercise") {
    const prompt = document.createElement("textarea");
    prompt.className = "textarea";
    prompt.value = String(d.prompt || "");
    prompt.setAttribute("data-k", "prompt");
    addField("Question prompt", prompt);

    const placeholder = document.createElement("input");
    placeholder.className = "input";
    placeholder.value = String(d.placeholder || "your answer");
    placeholder.setAttribute("data-k", "placeholder");
    addField("Input placeholder", placeholder);

    const accepted = document.createElement("textarea");
    accepted.className = "textarea";
    accepted.value = Array.isArray(d.acceptedAnswers) ? d.acceptedAnswers.join("\n") : "";
    accepted.setAttribute("data-k", "acceptedAnswers");
    addField("Accepted answers (one per line)", accepted);
  }

  return frag;
}

function readComponentFromCard(card, fallback) {
  const type = String(card.querySelector("[data-type]")?.value || fallback?.type || "text");
  const data = {};

  card.querySelectorAll("[data-k]").forEach((el) => {
    const k = el.getAttribute("data-k");
    if (!k) return;
    data[k] = el.value;
  });

  if (type === "heading") data.level = Number(data.level || 2);
  if (type === "table") {
    data.columns = String(data.columns || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const rowsRaw = String(data.rows || "").trim();
    data.rows = rowsRaw ? JSON.parse(rowsRaw) : [];
    if (!Array.isArray(data.rows)) throw new Error("Table rows must be a JSON array of arrays");
  }
  if (type === "exercise") {
    data.acceptedAnswers = String(data.acceptedAnswers || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return { id: String(fallback?.id || ""), type, order: Number(fallback?.order ?? 0), data };
}

function fillBuilderForLesson(lesson) {
  const addBtn = document.getElementById("addComponentBtn");
  const saveBtn = document.getElementById("saveComponentsBtn");
  const list = document.getElementById("componentList");
  const label = document.getElementById("selectedLessonLabel");
  const notice = document.getElementById("builderNotice");
  if (!addBtn || !saveBtn || !list || !label) return;

  clearNotice(notice);

  if (!lesson) {
    label.textContent = "— Select a lesson to edit components.";
    addBtn.disabled = true;
    saveBtn.disabled = true;
    list.replaceChildren();
    return;
  }

  label.textContent = `— ${lesson.title}`;
  addBtn.disabled = false;
  saveBtn.disabled = false;

  const comps = Array.isArray(lesson.components) ? lesson.components.slice().sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0)) : [];

  const rerender = () => {
    list.replaceChildren();
    comps.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
    comps.forEach((c, idx) => {
      const card = renderComponentCard(c, idx, comps.length);
      list.appendChild(card);

      card.querySelector("[data-up]")?.addEventListener("click", () => {
        if (idx <= 0) return;
        const tmp = comps[idx - 1];
        comps[idx - 1] = comps[idx];
        comps[idx] = tmp;
        comps.forEach((x, i) => (x.order = i));
        rerender();
      });
      card.querySelector("[data-down]")?.addEventListener("click", () => {
        if (idx >= comps.length - 1) return;
        const tmp = comps[idx + 1];
        comps[idx + 1] = comps[idx];
        comps[idx] = tmp;
        comps.forEach((x, i) => (x.order = i));
        rerender();
      });
      card.querySelector("[data-del]")?.addEventListener("click", () => {
        comps.splice(idx, 1);
        comps.forEach((x, i) => (x.order = i));
        rerender();
      });
    });
  };

  rerender();

  addBtn.onclick = () => {
    const type = String(document.getElementById("addComponentType")?.value || "text");
    comps.push(newComponent(type, comps.length));
    comps.forEach((x, i) => (x.order = i));
    rerender();
  };

  saveBtn.onclick = async () => {
    try {
      clearNotice(notice);
      // read current values from DOM
      const cards = Array.from(list.querySelectorAll(".c-card"));
      const nextComps = cards.map((card, i) => {
        const cid = card.dataset.cid;
        const existing = comps.find((c) => c.id === cid) || comps[i];
        const read = readComponentFromCard(card, existing);
        return { id: existing.id, type: read.type, order: i, data: read.data };
      });

      // enforce single exercise component per lesson
      const exerciseCount = nextComps.filter((c) => c.type === "exercise").length;
      if (exerciseCount > 1) throw new Error("Only one Exercise component is allowed per lesson (for gating).");

      const updated = { ...lesson, components: nextComps };
      await saveLesson(updated);
      await refreshAll();
      // refresh local lesson
      const saved = findLesson(updated.id);
      if (saved) {
        selectedLessonId = saved.id;
        fillLessonMetaForm(saved);
        fillBuilderForLesson(saved);
      }
      showNotice(notice, "Builder saved.", "ok");
    } catch (e) {
      showNotice(notice, String(e?.message || e), "bad");
    }
  };
}

function setSelectedTopic(topicId) {
  selectedTopicId = topicId;
  selectedLessonId = null;

  const topic = findTopic(topicId);
  fillTopicForm(topic);
  const label = document.getElementById("selectedTopicLabel");
  if (label) label.textContent = topic ? `— ${topic.title}` : "";

  const newLessonBtn = document.getElementById("newLessonBtn");
  if (newLessonBtn) newLessonBtn.disabled = !topic;

  fillLessonMetaForm({ topicId });
  fillBuilderForLesson(null);
  renderAll();
}

function setSelectedLesson(lessonId) {
  selectedLessonId = lessonId;
  const lesson = findLesson(lessonId);
  if (!lesson) return;
  if (!selectedTopicId) selectedTopicId = lesson.topicId || null;

  fillLessonMetaForm(lesson);
  fillBuilderForLesson(lesson);
  renderAll();
}

function renderAll() {
  renderTopicsTable();
  renderLessonsTable();
}

function renderAdminApp() {
  const tpl = document.getElementById("adminAppTpl");
  const node = tpl.content.cloneNode(true);
  const root = node.querySelector("section");
  els.root.replaceChildren(root);

  const refreshBtn = document.getElementById("refreshBtn");
  const newTopicBtn = document.getElementById("newTopicBtn");
  const newLessonBtn = document.getElementById("newLessonBtn");

  const topicForm = document.getElementById("topicForm");
  const deleteTopicBtn = document.getElementById("deleteTopicBtn");
  const lessonMetaForm = document.getElementById("lessonMetaForm");
  const deleteLessonBtn = document.getElementById("deleteLessonBtn");

  const topicsNotice = document.getElementById("topicsNotice");
  const lessonNotice = document.getElementById("lessonNotice");

  refreshBtn.addEventListener("click", async () => {
    try {
      clearNotice(topicsNotice);
      clearNotice(lessonNotice);
      await refreshAll();
      renderAll();
      showNotice(topicsNotice, "Refreshed.", "ok");
      setTimeout(() => clearNotice(topicsNotice), 650);
    } catch (e) {
      showNotice(topicsNotice, String(e?.message || e), "bad");
    }
  });

  newTopicBtn.addEventListener("click", () => {
    selectedTopicId = null;
    selectedLessonId = null;
    fillTopicForm({ id: "", title: "", track: "dbms", order: 0, published: true });
    const label = document.getElementById("selectedTopicLabel");
    if (label) label.textContent = "";
    if (newLessonBtn) newLessonBtn.disabled = true;
    fillLessonMetaForm({ topicId: "" });
    fillBuilderForLesson(null);
    renderAll();
  });

  topicForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearNotice(topicsNotice);
    const fd = new FormData(topicForm);
    const topic = {
      id: String(fd.get("id") || "").trim(),
      title: String(fd.get("title") || "").trim(),
      track: "dbms",
      order: Number(fd.get("order") || 0),
      published: parseBool(fd.get("published"))
    };
    try {
      const res = await saveTopic(topic);
      await refreshAll();
      const savedId = res?.topic?.id || topic.id;
      if (savedId) selectedTopicId = savedId;
      renderAll();
      fillTopicForm(findTopic(savedId));
      showNotice(topicsNotice, "Topic saved.", "ok");
    } catch (err) {
      showNotice(topicsNotice, String(err?.message || err), "bad");
    }
  });

  deleteTopicBtn?.addEventListener("click", async () => {
    if (!selectedTopicId) return;
    const topic = findTopic(selectedTopicId);
    if (!confirm(`Delete topic "${topic?.title || selectedTopicId}"?\n\nThis also deletes its lessons.`)) return;
    clearNotice(topicsNotice);
    try {
      await deleteTopic(selectedTopicId);
      selectedTopicId = null;
      selectedLessonId = null;
      await refreshAll();
      renderAll();
      fillTopicForm({ id: "", title: "", track: "dbms", order: 0, published: true });
      fillLessonMetaForm({ topicId: "" });
      fillBuilderForLesson(null);
      const label = document.getElementById("selectedTopicLabel");
      if (label) label.textContent = "";
      showNotice(topicsNotice, "Topic deleted.", "ok");
    } catch (err) {
      showNotice(topicsNotice, String(err?.message || err), "bad");
    }
  });

  newLessonBtn?.addEventListener("click", () => {
    if (!selectedTopicId) return;
    selectedLessonId = null;
    const lessons = lessonList().filter((l) => String(l.topicId || "") === String(selectedTopicId));
    const nextOrder = lessons.length ? Math.max(...lessons.map((l) => Number(l.order ?? 0))) + 1 : 0;
    fillLessonMetaForm({ topicId: selectedTopicId, id: "", title: "", order: nextOrder, published: true });
    fillBuilderForLesson({ id: "", topicId: selectedTopicId, title: "", order: nextOrder, published: true, track: "dbms", components: [] });
    renderAll();
  });

  lessonMetaForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearNotice(lessonNotice);
    try {
      const fd = new FormData(lessonMetaForm);
      const id = String(fd.get("id") || "").trim();
      if (!id) throw new Error("Lesson ID is required");
      const topicId = String(fd.get("topicId") || selectedTopicId || "").trim();
      if (!topicId) throw new Error("Select a topic first");

      const existing = findLesson(id);
      const components = Array.isArray(existing?.components) ? existing.components : [];
      const lesson = {
        id,
        topicId,
        track: "dbms",
        title: String(fd.get("title") || "").trim(),
        order: Number(fd.get("order") || 0),
        published: parseBool(fd.get("published")),
        components
      };

      await saveLesson(lesson);
      selectedLessonId = id;
      await refreshAll();
      renderAll();
      fillLessonMetaForm(findLesson(id));
      fillBuilderForLesson(findLesson(id));
      showNotice(lessonNotice, "Lesson saved.", "ok");
    } catch (err) {
      showNotice(lessonNotice, String(err?.message || err), "bad");
    }
  });

  deleteLessonBtn?.addEventListener("click", async () => {
    if (!selectedLessonId) return;
    const l = findLesson(selectedLessonId);
    if (!confirm(`Delete lesson "${l?.title || selectedLessonId}"?`)) return;
    clearNotice(lessonNotice);
    try {
      await deleteLesson(selectedLessonId);
      selectedLessonId = null;
      await refreshAll();
      renderAll();
      fillLessonMetaForm({ topicId: selectedTopicId || "" });
      fillBuilderForLesson(null);
      showNotice(lessonNotice, "Lesson deleted.", "ok");
    } catch (err) {
      showNotice(lessonNotice, String(err?.message || err), "bad");
    }
  });

  // Row click selection
  $("#topicRows")?.addEventListener("click", (e) => {
    const tr = e.target.closest("tr");
    if (!tr) return;
    if (e.target.closest("button") || e.target.closest("input")) return;
    const idx = Array.from(tr.parentElement.children).indexOf(tr);
    const topics = topicList()
      .slice()
      .sort((a, b) => (Number(a.order ?? 0) - Number(b.order ?? 0)) || String(a.title || "").localeCompare(String(b.title || "")));
    const t = topics[idx];
    if (t) setSelectedTopic(t.id);
  });
  $("#lessonRows")?.addEventListener("click", (e) => {
    const tr = e.target.closest("tr");
    if (!tr) return;
    if (e.target.closest("button") || e.target.closest("input")) return;
    const idx = Array.from(tr.parentElement.children).indexOf(tr);
    const lessons = lessonList()
      .filter((l) => String(l.topicId || "") === String(selectedTopicId))
      .slice()
      .sort((a, b) => (Number(a.order ?? 0) - Number(b.order ?? 0)) || String(a.title || "").localeCompare(String(b.title || "")));
    const l = lessons[idx];
    if (l) setSelectedLesson(l.id);
  });

  fillTopicForm({ id: "", title: "", track: "dbms", order: 0, published: true });
  fillLessonMetaForm({ topicId: "" });
  fillBuilderForLesson(null);
  renderAll();
}

function renderLogin() {
  const tpl = document.getElementById("adminLoginTpl");
  const node = tpl.content.cloneNode(true);
  const root = node.querySelector("section");
  els.root.replaceChildren(root);

  const form = document.getElementById("adminLoginForm");
  const notice = document.getElementById("adminLoginNotice");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearNotice(notice);
    const fd = new FormData(form);
    const password = String(fd.get("password") || fd.get("key") || "");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password })
      });
      const json = await res.json();
      if (!json?.ok) {
        showNotice(notice, "Invalid password.", "bad");
        return;
      }
      adminToken = String(json?.token || "");
      if (adminToken) {
        localStorage.setItem(LS_ADMIN_TOKEN, adminToken);
        // clear legacy key if we have token
        localStorage.removeItem(LS_ADMIN_KEY);
        adminKeyLegacy = "";
      } else {
        // Legacy mode: server didn't issue a token, so fall back to x-admin-key.
        adminKeyLegacy = password;
        localStorage.setItem(LS_ADMIN_KEY, adminKeyLegacy);
      }
      await boot();
    } catch (err) {
      showNotice(notice, String(err?.message || err), "bad");
    }
  });
}

async function boot() {
  if (!adminToken && !adminKeyLegacy) {
    renderLogin();
    return;
  }

  try {
    await refreshAll();
    renderAdminApp();
  } catch {
    adminToken = "";
    adminKeyLegacy = "";
    localStorage.removeItem(LS_ADMIN_TOKEN);
    localStorage.removeItem(LS_ADMIN_KEY);
    renderLogin();
  }
}

els.logoutBtn.addEventListener("click", () => {
  adminToken = "";
  adminKeyLegacy = "";
  localStorage.removeItem(LS_ADMIN_TOKEN);
  localStorage.removeItem(LS_ADMIN_KEY);
  renderLogin();
});

boot();

