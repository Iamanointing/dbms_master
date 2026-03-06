import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = String(process.env.ADMIN_KEY || "");
const ADMIN_PASSWORD_HASH = String(process.env.ADMIN_PASSWORD_HASH || "");
const ADMIN_AUTH_SECRET = String(process.env.ADMIN_AUTH_SECRET || "");

const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const PROGRESS_DIR = path.join(DATA_DIR, "progress");

const TOPICS_PATH = path.join(DATA_DIR, "topics.json");
const LESSONS_PATH = path.join(DATA_DIR, "lessons.json");
const QUIZZES_PATH = path.join(DATA_DIR, "quizzes.json");
const USERS_PATH = path.join(DATA_DIR, "users.json");

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function sendJson(res, statusCode, obj) {
  res.writeHead(statusCode, JSON_HEADERS);
  res.end(JSON.stringify(obj, null, 2));
}

function sendText(res, statusCode, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, { "content-type": contentType });
  res.end(text);
}

function base64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecodeToBuffer(s) {
  const input = String(s || "").replaceAll("-", "+").replaceAll("_", "/");
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input + pad, "base64");
}

function timingSafeEqualStr(a, b) {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function hashPasswordPbkdf2Sha256(password, saltBuf, iterations = 150_000, keyLen = 32) {
  return crypto.pbkdf2Sync(String(password), saltBuf, iterations, keyLen, "sha256");
}

function formatPasswordHash({ iterations, saltBuf, hashBuf }) {
  // pbkdf2_sha256$150000$<saltB64Url>$<hashB64Url>
  return `pbkdf2_sha256$${iterations}$${base64UrlEncode(saltBuf)}$${base64UrlEncode(hashBuf)}`;
}

function verifyPassword(password, storedHash) {
  const s = String(storedHash || "").trim();
  if (!s) return false;
  const parts = s.split("$");
  if (parts.length !== 4) return false;
  const [alg, itersRaw, saltB64, hashB64] = parts;
  if (alg !== "pbkdf2_sha256") return false;
  const iterations = Number(itersRaw);
  if (!Number.isFinite(iterations) || iterations < 50_000) return false;

  const saltBuf = base64UrlDecodeToBuffer(saltB64);
  const expectedBuf = base64UrlDecodeToBuffer(hashB64);
  const actualBuf = hashPasswordPbkdf2Sha256(password, saltBuf, iterations, expectedBuf.length);
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

function makeAdminToken({ iatMs, ttlMs }) {
  if (!ADMIN_AUTH_SECRET) return "";
  const payload = { iat: iatMs, exp: iatMs + ttlMs, v: 1 };
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = crypto.createHmac("sha256", ADMIN_AUTH_SECRET).update(payloadB64).digest();
  const sigB64 = base64UrlEncode(sig);
  return `v1.${payloadB64}.${sigB64}`;
}

function verifyAdminToken(token) {
  if (!ADMIN_AUTH_SECRET) return false;
  const t = String(token || "").trim();
  const parts = t.split(".");
  if (parts.length !== 3) return false;
  const [v, payloadB64, sigB64] = parts;
  if (v !== "v1" || !payloadB64 || !sigB64) return false;

  const expectedSig = crypto.createHmac("sha256", ADMIN_AUTH_SECRET).update(payloadB64).digest();
  const gotSig = base64UrlDecodeToBuffer(sigB64);
  if (gotSig.length !== expectedSig.length) return false;
  if (!crypto.timingSafeEqual(gotSig, expectedSig)) return false;

  let payload = null;
  try {
    payload = JSON.parse(base64UrlDecodeToBuffer(payloadB64).toString("utf8"));
  } catch {
    payload = null;
  }
  const exp = Number(payload?.exp ?? 0);
  if (!Number.isFinite(exp) || exp <= Date.now()) return false;
  return true;
}

function isAdmin(req) {
  const auth = String(req.headers.authorization || "");
  if (auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice("bearer ".length).trim();
    if (verifyAdminToken(token)) return true;
  }
  const headerKey = req.headers["x-admin-key"];
  return Boolean(ADMIN_KEY) && typeof headerKey === "string" && headerKey === ADMIN_KEY;
}

function slugify(input) {
  const s = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "topic";
}

function makeUniqueId(preferred, usedIds) {
  let id = preferred;
  let i = 2;
  while (usedIds.has(id)) {
    id = `${preferred}-${i}`;
    i += 1;
  }
  usedIds.add(id);
  return id;
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath, obj) {
  await fs.writeFile(filePath, JSON.stringify(obj, null, 2), "utf8");
}

async function parseBody(req, maxBytes = 2_000_000) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("Payload too large");
    chunks.push(chunk);
  }
  const buf = Buffer.concat(chunks);
  const contentType = String(req.headers["content-type"] || "");
  if (contentType.includes("application/json")) return JSON.parse(buf.toString("utf8") || "{}");
  return buf;
}

function safeJoinPublic(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const cleaned = decoded.replace(/^\/+/, "");
  const fsPath = path.normalize(path.join(PUBLIC_DIR, cleaned));
  if (!fsPath.startsWith(PUBLIC_DIR)) return null;
  return fsPath;
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function normalizeAnswer(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/;+\s*$/g, "")
    .toLowerCase();
}

function lessonExerciseComponent(lesson) {
  const comps = Array.isArray(lesson?.components) ? lesson.components : [];
  return comps.find((c) => c?.type === "exercise") || null;
}

function sanitizeLessonForStudents(lesson) {
  const l = { ...lesson };
  // never leak correct answers
  if (Array.isArray(l.components)) {
    l.components = l.components.map((c) => {
      if (c?.type !== "exercise") return c;
      const data = c.data || {};
      const out = { ...c, data: { ...data } };
      delete out.data.correctAnswer;
      delete out.data.acceptedAnswers;
      return out;
    });
  }
  return l;
}

async function ensureDataFiles() {
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(PROGRESS_DIR, { recursive: true });
  await fs.mkdir(path.join(PUBLIC_DIR, "uploads"), { recursive: true });
  await fs.mkdir(path.join(PUBLIC_DIR, "admin"), { recursive: true });

  const defaults = [
    {
      file: TOPICS_PATH,
      value: {
        topics: [
          { id: "intro", title: "Introduction", track: "dbms", order: 0, published: true },
          { id: "sql", title: "SQL", track: "dbms", order: 1, published: true }
        ]
      }
    },
    {
      file: LESSONS_PATH,
      value: {
        lessons: [
          {
            id: "what-is-dbms",
            topicId: "intro",
            track: "dbms",
            title: "What is a DBMS?",
            order: 0,
            published: true,
            components: [
              { id: "c1", type: "heading", order: 0, data: { text: "What is a DBMS?", level: 2 } },
              {
                id: "c2",
                type: "text",
                order: 1,
                data: {
                  text:
                    "A Database Management System (DBMS) is software that stores, organizes, and manages data so applications can create, read, update, and delete it safely."
                }
              },
              {
                id: "c3",
                type: "text",
                order: 2,
                data: {
                  text:
                    "In this course you’ll learn core DBMS ideas (tables, keys, normalization) and apply them through SQL examples."
                }
              },
              {
                id: "c4",
                type: "exercise",
                order: 3,
                data: {
                  prompt: "Fill in the blank: A DBMS is software used to ______ data.",
                  placeholder: "your answer",
                  acceptedAnswers: ["manage", "store and manage", "store, organize and manage"],
                  correctAnswer: "manage"
                }
              }
            ]
          },
          {
            id: "sql-select",
            topicId: "sql",
            track: "dbms",
            title: "SQL SELECT",
            order: 0,
            published: true,
            components: [
              { id: "c1", type: "heading", order: 0, data: { text: "SQL SELECT Statement", level: 2 } },
              { id: "c2", type: "text", order: 1, data: { text: "The SELECT statement retrieves data from a table." } },
              {
                id: "c3",
                type: "code",
                order: 2,
                data: { language: "sql", code: "SELECT name\nFROM students;" }
              },
              {
                id: "c4",
                type: "table",
                order: 3,
                data: {
                  columns: ["name"],
                  rows: [["Ada"], ["Grace"], ["Linus"]]
                }
              },
              {
                id: "c5",
                type: "exercise",
                order: 4,
                data: {
                  prompt: "Write a query to select all columns from the table `students`.",
                  placeholder: "e.g. SELECT * FROM students;",
                  acceptedAnswers: ["select * from students", "select * from students;"],
                  correctAnswer: "SELECT * FROM students;"
                }
              }
            ]
          }
        ]
      }
    },
    { file: QUIZZES_PATH, value: { quizzes: [] } },
    { file: USERS_PATH, value: { users: [] } }
  ];

  for (const def of defaults) {
    try {
      await fs.access(def.file);
    } catch {
      await writeJson(def.file, def.value);
    }
  }

  await migrateLegacyLessonShape();
}

async function migrateLegacyLessonShape() {
  // If a previous version stored lessons with contentBlocks/artifact/resultPreview, convert them into components.
  const lessonsDb = await readJson(LESSONS_PATH);
  if (!lessonsDb || !Array.isArray(lessonsDb.lessons)) return;

  let changed = false;
  for (const lesson of lessonsDb.lessons) {
    if (!lesson || Array.isArray(lesson.components)) continue;
    const components = [];
    let order = 0;

    const title = String(lesson.title || "").trim();
    if (title) components.push({ id: "c_title", type: "heading", order: order++, data: { text: title, level: 2 } });

    const paras = Array.isArray(lesson.contentBlocks)
      ? lesson.contentBlocks.filter((b) => b?.type === "p").map((b) => String(b.text || "").trim()).filter(Boolean)
      : [];
    for (const p of paras) components.push({ id: `c_p_${order}`, type: "text", order: order++, data: { text: p } });

    if (lesson.artifact?.kind === "code") {
      components.push({
        id: `c_code_${order}`,
        type: "code",
        order: order++,
        data: { language: String(lesson.artifact.language || "sql"), code: String(lesson.artifact.code || "") }
      });
    }

    if (lesson.resultPreview?.columns && lesson.resultPreview?.rows) {
      components.push({
        id: `c_table_${order}`,
        type: "table",
        order: order++,
        data: { columns: lesson.resultPreview.columns || [], rows: lesson.resultPreview.rows || [] }
      });
    }

    // If a quiz exists, keep it for knowledge checks (not used for gating unless no exercise is present).
    lesson.components = components;
    changed = true;
  }

  if (changed) await writeJson(LESSONS_PATH, lessonsDb);
}

function orderLessons(topics, lessons) {
  const topicOrder = new Map((topics || []).map((t) => [String(t.id), Number(t.order ?? 0)]));
  return (lessons || [])
    .slice()
    .sort((a, b) => {
      const ta = topicOrder.get(String(a.topicId || "")) ?? 9e9;
      const tb = topicOrder.get(String(b.topicId || "")) ?? 9e9;
      if (ta !== tb) return ta - tb;
      const la = Number(a.order ?? 0);
      const lb = Number(b.order ?? 0);
      if (la !== lb) return la - lb;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") return sendJson(res, 200, { ok: true });

  // Register (simple identity to store progress)
  if (req.method === "POST" && url.pathname === "/api/register") {
    const body = await parseBody(req);
    const name = String(body?.name || "").trim();
    const email = String(body?.email || "").trim().toLowerCase();
    if (!name || !email) return sendJson(res, 400, { error: "name and email are required" });

    const usersDb = await readJson(USERS_PATH);
    const existing = (usersDb.users || []).find((u) => u.email === email);
    if (existing) return sendJson(res, 200, { userId: existing.id });

    const userId = `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    usersDb.users = Array.isArray(usersDb.users) ? usersDb.users : [];
    usersDb.users.push({ id: userId, name, email, createdAt: new Date().toISOString() });
    await writeJson(USERS_PATH, usersDb);

    await writeJson(path.join(PROGRESS_DIR, `${userId}.json`), {
      userId,
      completedLessonIds: [],
      exercisePasses: {},
      quizPasses: {},
      updatedAt: new Date().toISOString()
    });

    return sendJson(res, 200, { userId });
  }

  // Catalog (sidebar)
  if (req.method === "GET" && url.pathname === "/api/catalog") {
    const [topicsDb, lessonsDb] = await Promise.all([readJson(TOPICS_PATH), readJson(LESSONS_PATH)]);
    const topics = Array.isArray(topicsDb?.topics) ? topicsDb.topics : [];
    const lessonsAll = Array.isArray(lessonsDb?.lessons) ? lessonsDb.lessons : [];

    const topicById = new Map(topics.map((t) => [String(t.id), t]));
    const visibleTopics = new Set(topics.filter((t) => t.published !== false).map((t) => String(t.id)));
    const visibleLessons = lessonsAll.filter((l) => {
      if (!l?.id) return false;
      if (l.published === false) return false;
      if (l.topicId && !visibleTopics.has(String(l.topicId))) return false;
      return true;
    });

    const ordered = orderLessons(topics, visibleLessons);
    const lessons = ordered.map((l) => {
      const t = l.topicId ? topicById.get(String(l.topicId)) : null;
      const hasExercise = Boolean(lessonExerciseComponent(l));
      return {
        id: l.id,
        track: String(l.track || t?.track || "dbms"),
        topicId: String(l.topicId || ""),
        module: String(t?.title || "Topic"),
        title: String(l.title || "Lesson"),
        order: Number(l.order ?? 0),
        topicOrder: Number(t?.order ?? 0),
        hasExercise
      };
    });
    return sendJson(res, 200, { lessons });
  }

  // Lesson
  if (req.method === "GET" && url.pathname.startsWith("/api/lessons/")) {
    const id = url.pathname.split("/").pop();
    const [topicsDb, lessonsDb] = await Promise.all([readJson(TOPICS_PATH), readJson(LESSONS_PATH)]);
    const topics = Array.isArray(topicsDb?.topics) ? topicsDb.topics : [];
    const lesson = (lessonsDb.lessons || []).find((l) => l.id === id);
    if (!lesson) return sendJson(res, 404, { error: "Lesson not found" });

    const topic = lesson.topicId ? topics.find((t) => String(t.id) === String(lesson.topicId)) : null;
    const canPreview = isAdmin(req);
    if (!canPreview) {
      if (lesson.published === false) return sendJson(res, 404, { error: "Lesson not found" });
      if (topic && topic.published === false) return sendJson(res, 404, { error: "Lesson not found" });
    }

    const lessonOut = canPreview ? lesson : sanitizeLessonForStudents(lesson);
    return sendJson(res, 200, { lesson: lessonOut });
  }

  // Exercise validate (gatekeeper)
  if (req.method === "POST" && url.pathname === "/api/exercise/validate") {
    const body = await parseBody(req);
    const lessonId = String(body?.lessonId || "");
    const userId = String(body?.userId || "");
    const answer = String(body?.answer || "");
    if (!lessonId || !userId) return sendJson(res, 400, { error: "lessonId and userId are required" });

    const lessonsDb = await readJson(LESSONS_PATH);
    const lesson = (lessonsDb.lessons || []).find((l) => String(l.id) === String(lessonId));
    if (!lesson || lesson.published === false) return sendJson(res, 404, { error: "Lesson not found" });

    const ex = lessonExerciseComponent(lesson);
    if (!ex) return sendJson(res, 400, { error: "No exercise configured for this lesson" });

    const accepted = [];
    const data = ex.data || {};
    if (Array.isArray(data.acceptedAnswers)) accepted.push(...data.acceptedAnswers);
    if (typeof data.correctAnswer === "string" && data.correctAnswer.trim()) accepted.push(data.correctAnswer);

    const normalized = normalizeAnswer(answer);
    const acceptedNormalized = accepted.map(normalizeAnswer).filter(Boolean);
    const passed = acceptedNormalized.includes(normalized);

    const progressPath = path.join(PROGRESS_DIR, `${userId}.json`);
    const progress = await readJson(progressPath);
    progress.exercisePasses = progress.exercisePasses || {};
    progress.quizPasses = progress.quizPasses || {};
    progress.completedLessonIds = Array.isArray(progress.completedLessonIds) ? progress.completedLessonIds : [];

    progress.exercisePasses[lessonId] = { passed, at: new Date().toISOString() };
    if (passed && !progress.completedLessonIds.includes(lessonId)) progress.completedLessonIds.push(lessonId);
    progress.updatedAt = new Date().toISOString();
    await writeJson(progressPath, progress);

    return sendJson(res, 200, { passed });
  }

  // Progress read/update
  if (url.pathname.startsWith("/api/progress/")) {
    const userId = url.pathname.split("/").pop();
    const progressPath = path.join(PROGRESS_DIR, `${userId}.json`);

    if (req.method === "GET") {
      try {
        const progress = await readJson(progressPath);
        return sendJson(res, 200, { progress });
      } catch {
        return sendJson(res, 404, { error: "Progress not found" });
      }
    }

    if (req.method === "PUT") {
      const body = await parseBody(req);
      const completedLessonIds = Array.isArray(body?.completedLessonIds) ? body.completedLessonIds : null;
      if (!completedLessonIds) return sendJson(res, 400, { error: "completedLessonIds must be an array" });
      const progress = await readJson(progressPath);
      progress.completedLessonIds = completedLessonIds;
      progress.updatedAt = new Date().toISOString();
      await writeJson(progressPath, progress);
      return sendJson(res, 200, { ok: true });
    }
  }

  // --- Admin ---
  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    const body = await parseBody(req);
    const password = String(body?.password || body?.key || "");

    let ok = false;
    const usingPasswordHash = Boolean(ADMIN_PASSWORD_HASH);
    if (usingPasswordHash) ok = verifyPassword(password, ADMIN_PASSWORD_HASH);
    else if (ADMIN_KEY) ok = timingSafeEqualStr(password, ADMIN_KEY);

    if (!ok) return sendJson(res, 200, { ok: false });

    if (usingPasswordHash && !ADMIN_AUTH_SECRET) {
      return sendJson(res, 500, { error: "Admin auth misconfigured: set ADMIN_AUTH_SECRET" });
    }

    // 24h token (recommended). If ADMIN_AUTH_SECRET isn't set (legacy ADMIN_KEY only), token will be empty.
    const token = makeAdminToken({ iatMs: Date.now(), ttlMs: 24 * 60 * 60 * 1000 });
    return sendJson(res, 200, { ok: true, token });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/check") {
    const body = await parseBody(req);
    const password = String(body?.password || body?.key || "");
    let ok = false;
    if (ADMIN_PASSWORD_HASH) ok = verifyPassword(password, ADMIN_PASSWORD_HASH);
    else if (ADMIN_KEY) ok = timingSafeEqualStr(password, ADMIN_KEY);
    return sendJson(res, 200, { ok });
  }

  if (url.pathname.startsWith("/api/admin/")) {
    if (!isAdmin(req)) return sendJson(res, 401, { error: "Unauthorized" });

    if (req.method === "GET" && url.pathname === "/api/admin/topics") {
      const topicsDb = await readJson(TOPICS_PATH);
      return sendJson(res, 200, topicsDb);
    }

    if (req.method === "POST" && url.pathname === "/api/admin/topics") {
      const body = await parseBody(req);
      const topic = body?.topic;
      const title = String(topic?.title || "").trim();
      const track = String(topic?.track || "dbms").trim() || "dbms";
      if (!title) return sendJson(res, 400, { error: "topic.title is required" });

      const topicsDb = await readJson(TOPICS_PATH);
      topicsDb.topics = Array.isArray(topicsDb.topics) ? topicsDb.topics : [];
      const usedIds = new Set(topicsDb.topics.map((t) => String(t?.id || "")).filter(Boolean));
      const id = String(topic?.id || "").trim() || makeUniqueId(slugify(title), usedIds);
      const existingIdx = topicsDb.topics.findIndex((t) => t.id === id);

      const next = {
        id,
        title,
        track,
        order: Number.isFinite(Number(topic?.order))
          ? Number(topic.order)
          : existingIdx >= 0
            ? Number(topicsDb.topics[existingIdx].order ?? 0)
            : topicsDb.topics.length,
        published: topic?.published == null ? true : Boolean(topic.published)
      };

      if (existingIdx >= 0) topicsDb.topics[existingIdx] = { ...topicsDb.topics[existingIdx], ...next };
      else topicsDb.topics.push(next);

      await writeJson(TOPICS_PATH, topicsDb);
      return sendJson(res, 200, { ok: true, topic: next });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/topics/")) {
      const id = url.pathname.split("/").pop();
      const topicsDb = await readJson(TOPICS_PATH);
      const lessonsDb = await readJson(LESSONS_PATH);
      const quizzesDb = await readJson(QUIZZES_PATH);

      const beforeTopics = Array.isArray(topicsDb.topics) ? topicsDb.topics.length : 0;
      topicsDb.topics = (topicsDb.topics || []).filter((t) => String(t.id) !== String(id));

      const removedLessonIds = new Set(
        (lessonsDb.lessons || []).filter((l) => String(l?.topicId || "") === String(id)).map((l) => l.id)
      );
      lessonsDb.lessons = (lessonsDb.lessons || []).filter((l) => !removedLessonIds.has(l.id));
      quizzesDb.quizzes = (quizzesDb.quizzes || []).filter((q) => !removedLessonIds.has(String(q?.lessonId || "")));

      await Promise.all([writeJson(TOPICS_PATH, topicsDb), writeJson(LESSONS_PATH, lessonsDb), writeJson(QUIZZES_PATH, quizzesDb)]);
      return sendJson(res, 200, { ok: true, removed: { topics: beforeTopics - topicsDb.topics.length, lessons: removedLessonIds.size } });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/lessons") {
      const lessonsDb = await readJson(LESSONS_PATH);
      return sendJson(res, 200, lessonsDb);
    }

    if (req.method === "POST" && url.pathname === "/api/admin/lessons") {
      const body = await parseBody(req, 8_000_000);
      const lesson = body?.lesson;
      if (!lesson?.id) return sendJson(res, 400, { error: "lesson.id is required" });
      if (!lesson?.topicId) return sendJson(res, 400, { error: "lesson.topicId is required" });
      if (!Array.isArray(lesson?.components)) return sendJson(res, 400, { error: "lesson.components must be an array" });

      const lessonsDb = await readJson(LESSONS_PATH);
      lessonsDb.lessons = Array.isArray(lessonsDb.lessons) ? lessonsDb.lessons : [];

      const idx = lessonsDb.lessons.findIndex((l) => l.id === lesson.id);
      if (idx >= 0) lessonsDb.lessons[idx] = lesson;
      else lessonsDb.lessons.push(lesson);

      await writeJson(LESSONS_PATH, lessonsDb);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/lessons/")) {
      const id = url.pathname.split("/").pop();
      const lessonsDb = await readJson(LESSONS_PATH);
      lessonsDb.lessons = (lessonsDb.lessons || []).filter((l) => String(l.id) !== String(id));
      await writeJson(LESSONS_PATH, lessonsDb);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/quizzes") {
      const quizzesDb = await readJson(QUIZZES_PATH);
      return sendJson(res, 200, quizzesDb);
    }

    if (req.method === "POST" && url.pathname === "/api/admin/quizzes") {
      const body = await parseBody(req);
      const quiz = body?.quiz;
      if (!quiz?.id) return sendJson(res, 400, { error: "quiz.id is required" });
      if (!quiz?.lessonId) return sendJson(res, 400, { error: "quiz.lessonId is required" });
      if (!Array.isArray(quiz?.questions) || !quiz.questions.length) return sendJson(res, 400, { error: "quiz.questions must be a non-empty array" });
      if (quiz.published == null) quiz.published = true;

      const quizzesDb = await readJson(QUIZZES_PATH);
      quizzesDb.quizzes = Array.isArray(quizzesDb.quizzes) ? quizzesDb.quizzes : [];
      const idx = quizzesDb.quizzes.findIndex((q) => q.id === quiz.id);
      if (idx >= 0) quizzesDb.quizzes[idx] = quiz;
      else quizzesDb.quizzes.push(quiz);
      await writeJson(QUIZZES_PATH, quizzesDb);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/admin/quizzes/")) {
      const id = url.pathname.split("/").pop();
      const quizzesDb = await readJson(QUIZZES_PATH);
      quizzesDb.quizzes = (quizzesDb.quizzes || []).filter((q) => String(q.id) !== String(id));
      await writeJson(QUIZZES_PATH, quizzesDb);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/admin/upload-image") {
      const body = await parseBody(req, 10_000_000);
      const fileName = String(body?.fileName || "").replace(/[^a-zA-Z0-9._-]/g, "_");
      const dataUrl = String(body?.dataUrl || "");
      if (!fileName || !dataUrl.startsWith("data:image/")) return sendJson(res, 400, { error: "fileName and dataUrl (data:image/...) are required" });
      const comma = dataUrl.indexOf(",");
      if (comma < 0) return sendJson(res, 400, { error: "Invalid dataUrl" });
      const base64 = dataUrl.slice(comma + 1);
      const buf = Buffer.from(base64, "base64");
      const outPath = path.join(PUBLIC_DIR, "uploads", fileName);
      await fs.writeFile(outPath, buf);
      return sendJson(res, 200, { ok: true, src: `/uploads/${fileName}` });
    }

    return sendJson(res, 404, { error: "Not found" });
  }

  return sendJson(res, 404, { error: "Not found" });
}

async function serveStatic(req, res, url) {
  const reqPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const fsPath = safeJoinPublic(reqPath);
  if (!fsPath) return sendText(res, 400, "Bad request");

  try {
    const stat = await fs.stat(fsPath);
    if (stat.isDirectory()) {
      const idxPath = path.join(fsPath, "index.html");
      const idxStat = await fs.stat(idxPath);
      if (!idxStat.isFile()) return sendText(res, 404, "Not found");
      const bytes = await fs.readFile(idxPath);
      res.writeHead(200, { "content-type": contentTypeFor(idxPath), "cache-control": "no-store" });
      return res.end(bytes);
    }
    const bytes = await fs.readFile(fsPath);
    res.writeHead(200, { "content-type": contentTypeFor(fsPath), "cache-control": "no-store" });
    return res.end(bytes);
  } catch {
    return sendText(res, 404, "Not found");
  }
}

await ensureDataFiles();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (err) {
    return sendJson(res, 500, { error: "Server error", details: String(err?.message || err) });
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`DBMS Academy running on http://localhost:${PORT}`);
});

