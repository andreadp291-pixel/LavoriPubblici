function getToken() {
  return localStorage.getItem("lp_token");
}

function setToken(token) {
  localStorage.setItem("lp_token", token);
}

function clearToken() {
  localStorage.removeItem("lp_token");
}

function requireAuth() {
  if (!getToken()) {
    window.location.href = "index.html";
  }
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
    throw new Error(body.detail || `Errore ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

function logout() {
  apiFetch("/api/logout", { method: "POST" }).catch(() => {});
  clearToken();
  window.location.href = "index.html";
}
