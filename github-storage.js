/* ============================================================
   GitHub Storage Helper
   Зберігає бібліотеку фільмів і файли (постери) прямо в GitHub-репозиторії
   через GitHub REST API, щоб усі відвідувачі сайту бачили однакові дані.
   Токен потрібен ЛИШЕ для запису (створення/редагування/видалення).
   Читання списку фільмів відбувається публічно, без токена.
   ============================================================ */

const GH_CFG_KEY = "gh_repo_config";   // { owner, repo, branch }
const GH_TOKEN_KEY = "gh_repo_token";  // зберігається тільки в цьому браузері

/* Публічний репозиторій сайту "за замовчуванням".
   Це НЕ секрет (на відміну від токена) — він потрібен, щоб будь-який
   відвідувач (без адмін-налаштувань у своєму браузері) міг ЧИТАТИ
   movies.json і файли фільмів з GitHub. Без цього кожен пристрій,
   де адмін-панель не була відкрита вручну, бачив порожній сайт. */
const GH_DEFAULT_CFG = { owner: "vladgorenko11-glitch", repo: "NetflixFilm", branch: "main" };

function ghGetConfig() {
  try {
    const raw = localStorage.getItem(GH_CFG_KEY);
    const stored = raw ? JSON.parse(raw) : null;
    if (stored && stored.owner && stored.repo) return stored;
  } catch {}
  return GH_DEFAULT_CFG;
}
function ghSetConfig(cfg) {
  localStorage.setItem(GH_CFG_KEY, JSON.stringify(cfg));
}
function ghGetToken() {
  return localStorage.getItem(GH_TOKEN_KEY) || "";
}
function ghSetToken(token) {
  if (token) localStorage.setItem(GH_TOKEN_KEY, token);
  else localStorage.removeItem(GH_TOKEN_KEY);
}
function ghIsConfigured() {
  const cfg = ghGetConfig();
  return !!(cfg && cfg.owner && cfg.repo && ghGetToken());
}

function ghApiBase(cfg) {
  return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`;
}

/* Перетворює base64 (стандартний) у base64 з підтримкою UTF-8 коректно */
function ghUtf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function ghBase64ToUtf8(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

/* Отримати вміст файлу з репо. Повертає { content, sha } або null якщо немає файлу.
   raw=true -> повертає рядок як є (для бінарних файлів повертає base64 рядок). */
async function ghGetFile(path) {
  const cfg = ghGetConfig();
  if (!cfg || !cfg.owner || !cfg.repo) return null;
  const branch = cfg.branch || "main";
  const url = `${ghApiBase(cfg)}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}&t=${Date.now()}`;
  const headers = { "Accept": "application/vnd.github+json" };
  const token = ghGetToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers, cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status}: ${txt || res.statusText}`);
  }
  const data = await res.json();
  return { content: data.content, sha: data.sha, encoding: data.encoding };
}

/* Прочитати текстовий файл (наприклад movies.json) із репо. Повертає рядок або null. */
async function ghGetTextFile(path) {
  const file = await ghGetFile(path);
  if (!file) return null;
  return ghBase64ToUtf8(file.content.replace(/\n/g, ""));
}

/* Записати/оновити файл у репо. contentStr — звичайний рядок (буде закодований у base64).
   Якщо файл вже існує — потрібен його sha (визначається автоматично). */
async function ghPutFile(path, contentStr, message) {
  const cfg = ghGetConfig();
  const token = ghGetToken();
  if (!cfg || !cfg.owner || !cfg.repo || !token) {
    throw new Error("GitHub не налаштований: вкажіть репозиторій і токен в адмін-панелі.");
  }
  const branch = cfg.branch || "main";
  const existing = await ghGetFile(path).catch(() => null);
  const body = {
    message: message || `Update ${path}`,
    content: ghUtf8ToBase64(contentStr),
    branch,
  };
  if (existing && existing.sha) body.sha = existing.sha;
  const url = `${ghApiBase(cfg)}/contents/${encodeURI(path)}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    let msg = `GitHub API ${res.status}`;
    try { const j = JSON.parse(txt); if (j.message) msg += `: ${j.message}`; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

/* Записати бінарний файл (наприклад зображення) із dataURL (data:image/png;base64,....) */
async function ghPutFileFromDataUrl(path, dataUrl, message) {
  const cfg = ghGetConfig();
  const token = ghGetToken();
  if (!cfg || !cfg.owner || !cfg.repo || !token) {
    throw new Error("GitHub не налаштований: вкажіть репозиторій і токен в адмін-панелі.");
  }
  const branch = cfg.branch || "main";
  const base64 = dataUrl.split(",")[1] || "";
  const existing = await ghGetFile(path).catch(() => null);
  const body = {
    message: message || `Upload ${path}`,
    content: base64,
    branch,
  };
  if (existing && existing.sha) body.sha = existing.sha;
  const url = `${ghApiBase(cfg)}/contents/${encodeURI(path)}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    let msg = `GitHub API ${res.status}`;
    try { const j = JSON.parse(txt); if (j.message) msg += `: ${j.message}`; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

/* Видалити файл з репо (потрібен sha) */
async function ghDeleteFile(path, message) {
  const cfg = ghGetConfig();
  const token = ghGetToken();
  if (!cfg || !cfg.owner || !cfg.repo || !token) return;
  const branch = cfg.branch || "main";
  const existing = await ghGetFile(path).catch(() => null);
  if (!existing) return;
  const url = `${ghApiBase(cfg)}/contents/${encodeURI(path)}`;
  await fetch(url, {
    method: "DELETE",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: message || `Delete ${path}`, sha: existing.sha, branch }),
  });
}

/* Перевірка токена/репозиторію: чи маємо доступ на запис */
async function ghTestAccess() {
  const cfg = ghGetConfig();
  const token = ghGetToken();
  if (!cfg || !cfg.owner || !cfg.repo) throw new Error("Вкажіть власника і назву репозиторію.");
  if (!token) throw new Error("Вкажіть GitHub токен.");
  const res = await fetch(ghApiBase(cfg), {
    headers: { "Accept": "application/vnd.github+json", "Authorization": `Bearer ${token}` },
  });
  if (res.status === 404) throw new Error("Репозиторій не знайдено (перевірте власника/назву або права токена).");
  if (res.status === 401) throw new Error("Невірний або застарілий токен.");
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = await res.json();
  if (!data.permissions || !data.permissions.push) {
    throw new Error("Цей токен не має прав на запис у репозиторій.");
  }
  return true;
}
