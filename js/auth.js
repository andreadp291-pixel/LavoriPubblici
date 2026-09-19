function getToken() {
  return localStorage.getItem("lp_token");
}

function setToken(token) {
  localStorage.setItem("lp_token", token);
}

function clearToken() {
  localStorage.removeItem("lp_token");
  localStorage.removeItem("lp_role");
  localStorage.removeItem("lp_display_name");
}

function getRole() {
  return localStorage.getItem("lp_role");
}

function getDisplayName() {
  return localStorage.getItem("lp_display_name");
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = Object.assign({}, options.headers, {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  });
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    clearToken();
    window.location.href = "index.html";
    throw new Error("Non autorizzato");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.detail || `Errore ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

// opts: { requireAdmin: bool } - da chiamare in cima a ogni pagina protetta.
// Reindirizza a index.html se non autenticato, a change-password.html se la
// password provvisoria non è ancora stata cambiata, a dashboard.html se la
// pagina richiede il ruolo admin e l'utente non lo ha.
async function requireAuth(opts = {}) {
  if (!getToken()) {
    window.location.href = "index.html";
    return;
  }

  let me;
  try {
    me = await apiFetch("/api/me");
  } catch (err) {
    return; // apiFetch ha già reindirizzato su 401
  }

  localStorage.setItem("lp_role", me.role);
  localStorage.setItem("lp_display_name", me.display_name);

  if (me.must_change_password && !opts.allowPasswordChange) {
    window.location.href = "change-password.html";
    return;
  }

  if (opts.requireAdmin && me.role !== "admin") {
    window.location.href = "dashboard.html";
    return;
  }

  return me;
}

function logout() {
  apiFetch("/api/logout", { method: "POST" }).catch(() => {});
  clearToken();
  window.location.href = "index.html";
}
