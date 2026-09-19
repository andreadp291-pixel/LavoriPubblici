(async function () {
  await requireAuth({ requireAdmin: true });
  await loadUsers();

  document.getElementById("create-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("username").value.trim();
    const display_name = document.getElementById("display_name").value.trim();
    const email = document.getElementById("email").value.trim();
    const role = document.getElementById("role").value;
    const errorEl = document.getElementById("create-error");
    errorEl.textContent = "";

    try {
      const result = await apiFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ username, display_name, email, role }),
      });
      showLastCreated(result);
      document.getElementById("create-form").reset();
      await loadUsers();
    } catch (err) {
      errorEl.textContent = err.message || "Errore durante la creazione";
    }
  });
})();

function showLastCreated(result) {
  const el = document.getElementById("last-created");
  el.hidden = false;
  if (result.email_sent) {
    el.textContent = `Utente "${result.username}" creato. Credenziali inviate via email.`;
    el.className = "notice notice-ok";
  } else {
    el.textContent = `Utente "${result.username}" creato. Invio email non riuscito o non configurato — password provvisoria: ${result.temp_password}`;
    el.className = "notice notice-warn";
  }
}

const ROLE_LABELS = { viewer: "Visualizzatore", editor: "Editor" };

async function loadUsers() {
  const users = await apiFetch("/api/admin/users");
  const tbody = document.getElementById("users-tbody");
  tbody.innerHTML = "";

  for (const u of users) {
    const tr = document.createElement("tr");

    const statusLabel = !u.active
      ? '<span class="badge badge-off">Disattivo</span>'
      : u.must_change_password
      ? '<span class="badge badge-warn">In attesa 1° accesso</span>'
      : '<span class="badge badge-ok">Attivo</span>';

    const roleSelect = `
      <select data-action="role" data-id="${u.id}">
        ${Object.entries(ROLE_LABELS)
          .map(([val, label]) => `<option value="${val}" ${u.role === val ? "selected" : ""}>${label}</option>`)
          .join("")}
      </select>
    `;

    tr.innerHTML = `
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.display_name)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${roleSelect}</td>
      <td>${statusLabel}</td>
      <td class="row-actions">
        <button data-action="toggle" data-id="${u.id}" data-active="${u.active}">${u.active ? "Disattiva" : "Riattiva"}</button>
        <button data-action="reset" data-id="${u.id}">Reset password</button>
        <button data-action="delete" data-id="${u.id}" class="btn-delete">Elimina</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => handleAction(btn));
  });
  tbody.querySelectorAll("select[data-action='role']").forEach((sel) => {
    sel.addEventListener("change", () => handleAction(sel));
  });
}

async function handleAction(btn) {
  const id = btn.dataset.id;
  const action = btn.dataset.action;

  try {
    if (action === "toggle") {
      const active = btn.dataset.active === "true";
      await apiFetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !active }),
      });
    } else if (action === "reset") {
      if (!confirm("Generare una nuova password provvisoria per questo utente?")) return;
      const result = await apiFetch(`/api/admin/users/${id}/reset-password`, { method: "POST" });
      showLastCreated({ ...result, email_sent: result.email_sent });
    } else if (action === "delete") {
      if (!confirm("Eliminare definitivamente questo utente?")) return;
      await apiFetch(`/api/admin/users/${id}`, { method: "DELETE" });
    } else if (action === "role") {
      await apiFetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: btn.value }),
      });
    }
    await loadUsers();
  } catch (err) {
    alert(err.message || "Operazione non riuscita");
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
