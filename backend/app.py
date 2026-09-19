# -*- coding: utf-8 -*-
"""
LavoriPubblici - backend API
Gestione sfalci erba, potature, asfaltature (mappa OSM) per il Comune.
"""
import os
import re
import secrets
import smtplib
import sqlite3
import string
import time
from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

ADMIN_USER = os.getenv("ADMIN_USER", "admin")
ADMIN_PASS = os.getenv("ADMIN_PASS", "changeme_now")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "https://andreadp291-pixel.github.io")
APP_URL = os.getenv("APP_URL", "https://andreadp291-pixel.github.io/LavoriPubblici/")
DB_PATH = Path(__file__).parent / "lavoripubblici.db"

# Invio email (SMTP + App Password). Se non configurate, l'invio viene
# saltato silenziosamente (log) e la password temporanea resta comunque
# visibile una tantum nella risposta API, come fallback manuale.
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "LavoriPubblici")

CATEGORIES = {"sfalci", "potature", "asfaltature"}
STATI = {"da_fare", "in_corso", "fatto"}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PASSWORD_SPECIALS = "!@#$%&*"

app = FastAPI(title="LavoriPubblici API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_methods=["*"],
    allow_headers=["*"],
)

ph = PasswordHasher()

# token -> user_id (0 = admin di bootstrap da env, non in DB)
sessions: dict[str, int] = {}
login_attempts: dict[str, list[float]] = defaultdict(list)


class Session:
    def __init__(self, user_id: int, role: str, display_name: str, must_change_password: bool):
        self.user_id = user_id
        self.role = role
        self.display_name = display_name
        self.must_change_password = must_change_password


def _credentials_email_html(display_name: str, username: str, temp_password: str) -> str:
    # display_name/username/temp_password sono generati o validati lato server.
    return f"""\
<div style="font-family:Segoe UI,Arial,sans-serif;background:#f1f5f9;padding:32px 16px">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,.12)">
    <div style="background:#1f5c32;padding:20px 28px">
      <span style="color:#fff;font-size:16px;font-weight:700">LavoriPubblici</span>
    </div>
    <div style="padding:28px">
      <h2 style="margin:0 0 8px;color:#1c2b22;font-size:18px">Ciao {display_name},</h2>
      <p style="color:#334155;font-size:14px;line-height:1.6;margin:0 0 20px">
        Ti è stato creato un account per accedere all'app LavoriPubblici del Comune di
        Castelfranco Veneto. Ecco le tue credenziali provvisorie:
      </p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 18px;margin-bottom:20px">
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em">Username</div>
        <div style="font-size:15px;font-weight:700;color:#1c2b22;margin-bottom:12px">{username}</div>
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em">Password provvisoria</div>
        <div style="font-size:15px;font-weight:700;color:#b23b3b;font-family:Consolas,monospace">{temp_password}</div>
      </div>
      <a href="{APP_URL}" style="display:inline-block;background:#1f5c32;color:#fff;text-decoration:none;font-weight:700;font-size:13.5px;padding:11px 20px;border-radius:10px;margin-bottom:20px">Apri l'app</a>
      <p style="color:#334155;font-size:13px;line-height:1.6;margin:0">
        Al primo accesso ti verrà chiesto di impostare una nuova password personale.
        Questa email non verrà rinviata: conserva la password finché non l'hai cambiata.
      </p>
    </div>
  </div>
</div>
"""


def send_credentials_email(to_email: str, display_name: str, username: str, temp_password: str) -> bool:
    if not (SMTP_USER and SMTP_PASSWORD and to_email):
        return False

    msg = EmailMessage()
    msg["Subject"] = "Le tue credenziali — LavoriPubblici"
    msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_USER}>"
    msg["To"] = to_email
    msg.set_content(
        f"Ciao {display_name},\n\n"
        f"Username: {username}\n"
        f"Password provvisoria: {temp_password}\n\n"
        "Al primo accesso ti verrà chiesto di impostarne una nuova."
    )
    msg.add_alternative(_credentials_email_html(display_name, username, temp_password), subtype="html")

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as smtp:
            smtp.starttls()
            smtp.login(SMTP_USER, SMTP_PASSWORD)
            smtp.send_message(msg)
        return True
    except Exception:
        return False


def generate_temp_password() -> str:
    alphabet = string.ascii_uppercase + string.ascii_lowercase + string.digits + PASSWORD_SPECIALS
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(14))
        if (
            any(c.islower() for c in pw)
            and any(c.isupper() for c in pw)
            and any(c.isdigit() for c in pw)
            and any(c in PASSWORD_SPECIALS for c in pw)
        ):
            return pw


def validate_password_strength(password: str):
    if len(password) < 10:
        raise HTTPException(status_code=400, detail="La password deve avere almeno 10 caratteri")
    if not any(c.islower() for c in password):
        raise HTTPException(status_code=400, detail="La password deve contenere almeno una lettera minuscola")
    if not any(c.isupper() for c in password):
        raise HTTPException(status_code=400, detail="La password deve contenere almeno una lettera maiuscola")
    if not any(c.isdigit() for c in password):
        raise HTTPException(status_code=400, detail="La password deve contenere almeno un numero")
    if not any(c in PASSWORD_SPECIALS for c in password):
        raise HTTPException(status_code=400, detail=f"La password deve contenere almeno un carattere speciale ({PASSWORD_SPECIALS})")


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS points (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                lat REAL NOT NULL,
                lon REAL NOT NULL,
                note TEXT DEFAULT '',
                stato TEXT NOT NULL DEFAULT 'da_fare',
                creato_il TEXT NOT NULL,
                aggiornato_il TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                display_name TEXT NOT NULL,
                email TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                active INTEGER NOT NULL DEFAULT 1,
                must_change_password INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            )
            """
        )


init_db()


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def get_session(request: Request) -> Session:
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else ""
    if not token or token not in sessions:
        raise HTTPException(status_code=401, detail="Non autorizzato")

    user_id = sessions[token]
    if user_id == 0:
        return Session(user_id=0, role="admin", display_name="Amministratore", must_change_password=False)

    with get_db() as conn:
        row = conn.execute(
            "SELECT id, display_name, role, active, must_change_password FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()

    if row is None or not row["active"]:
        sessions.pop(token, None)
        raise HTTPException(status_code=401, detail="Non autorizzato")

    return Session(
        user_id=row["id"],
        role=row["role"],
        display_name=row["display_name"],
        must_change_password=bool(row["must_change_password"]),
    )


def require_session(request: Request) -> Session:
    return get_session(request)


def require_active_session(request: Request) -> Session:
    session = get_session(request)
    if session.must_change_password:
        raise HTTPException(status_code=403, detail="Devi impostare una nuova password prima di continuare")
    return session


def require_admin(request: Request) -> Session:
    session = get_session(request)
    if session.role != "admin":
        raise HTTPException(status_code=403, detail="Riservato agli amministratori")
    return session


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    new_password: str


class UserCreate(BaseModel):
    username: str
    display_name: str
    email: str


class UserUpdate(BaseModel):
    display_name: str | None = None
    active: bool | None = None


class PointCreate(BaseModel):
    category: str
    lat: float
    lon: float
    note: str = ""
    stato: str = "da_fare"


class PointUpdate(BaseModel):
    note: str | None = None
    stato: str | None = None


def _validate_category(category: str):
    if category not in CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Categoria non valida: {category}")


def _validate_stato(stato: str):
    if stato not in STATI:
        raise HTTPException(status_code=400, detail=f"Stato non valido: {stato}")


def _user_public(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "email": row["email"],
        "role": row["role"],
        "active": bool(row["active"]),
        "must_change_password": bool(row["must_change_password"]),
        "created_at": row["created_at"],
    }


@app.post("/api/login")
async def login(body: LoginRequest, request: Request):
    ip = request.client.host if request.client else "unknown"
    username = body.username.strip()
    # Chiave IP+username (non solo IP): dietro il tunnel Tailscale tutte le
    # richieste arrivano dallo stesso IP locale, quindi un limite per sola IP
    # bloccherebbe il login di tutti gli utenti per l'errore di uno solo.
    key = f"{ip}:{username.lower()}"
    now = time.time()
    attempts = [t for t in login_attempts[key] if now - t < 600]

    if len(attempts) >= 10:
        raise HTTPException(status_code=429, detail="Troppi tentativi, riprova più tardi")

    # 1. admin di bootstrap (credenziali da env)
    if secrets.compare_digest(username, ADMIN_USER) and secrets.compare_digest(body.password, ADMIN_PASS):
        login_attempts.pop(key, None)
        token = secrets.token_hex(32)
        sessions[token] = 0
        return {
            "ok": True,
            "token": token,
            "role": "admin",
            "display_name": "Amministratore",
            "must_change_password": False,
        }

    # 2. utenti creati dall'admin
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, password_hash, display_name, role, active, must_change_password FROM users WHERE username = ?",
            (username,),
        ).fetchone()

    if row is not None:
        try:
            ph.verify(row["password_hash"], body.password)
            if row["active"]:
                login_attempts.pop(key, None)
                token = secrets.token_hex(32)
                sessions[token] = row["id"]
                return {
                    "ok": True,
                    "token": token,
                    "role": row["role"],
                    "display_name": row["display_name"],
                    "must_change_password": bool(row["must_change_password"]),
                }
        except (VerifyMismatchError, InvalidHashError):
            pass

    attempts.append(now)
    login_attempts[key] = attempts
    raise HTTPException(status_code=401, detail="Credenziali non valide")


@app.post("/api/logout")
async def logout(request: Request):
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else ""
    sessions.pop(token, None)
    return {"ok": True}


@app.get("/api/me")
async def me(session: Session = Depends(require_session)):
    return {
        "user_id": session.user_id,
        "role": session.role,
        "display_name": session.display_name,
        "must_change_password": session.must_change_password,
    }


@app.post("/api/me/password")
async def change_own_password(body: ChangePasswordRequest, session: Session = Depends(require_session)):
    if session.role == "admin" and session.user_id == 0:
        raise HTTPException(status_code=400, detail="Password amministratore gestita via configurazione server")

    validate_password_strength(body.new_password)
    new_hash = ph.hash(body.new_password)
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
            (new_hash, session.user_id),
        )
    return {"ok": True}


@app.get("/api/admin/users")
async def list_users(session: Session = Depends(require_admin)):
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM users ORDER BY created_at DESC").fetchall()
    return [_user_public(r) for r in rows]


@app.post("/api/admin/users")
async def create_user(body: UserCreate, session: Session = Depends(require_admin)):
    username = body.username.strip().lower()
    display_name = body.display_name.strip()
    email = body.email.strip()

    if not username or not display_name:
        raise HTTPException(status_code=400, detail="username e display_name obbligatori")
    if not email or not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="email non valida")
    if secrets.compare_digest(username, ADMIN_USER.lower()):
        raise HTTPException(status_code=400, detail="username riservato")

    temp_password = generate_temp_password()
    password_hash = ph.hash(temp_password)

    with get_db() as conn:
        existing = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="username già esistente")
        cur = conn.execute(
            """
            INSERT INTO users (username, password_hash, display_name, email, role, active, must_change_password, created_at)
            VALUES (?, ?, ?, ?, 'user', 1, 1, ?)
            """,
            (username, password_hash, display_name, email, now_iso()),
        )
        user_id = cur.lastrowid

    email_sent = send_credentials_email(email, display_name, username, temp_password)
    return {
        "id": user_id,
        "username": username,
        "temp_password": temp_password,
        "email_sent": email_sent,
    }


@app.patch("/api/admin/users/{user_id}")
async def update_user(user_id: int, body: UserUpdate, session: Session = Depends(require_admin)):
    updates = {}
    if body.display_name is not None:
        dn = body.display_name.strip()
        if not dn:
            raise HTTPException(status_code=400, detail="display_name non valido")
        updates["display_name"] = dn
    if body.active is not None:
        updates["active"] = 1 if body.active else 0

    if not updates:
        raise HTTPException(status_code=400, detail="nessun campo da aggiornare")

    with get_db() as conn:
        existing = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="Utente non trovato")
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(f"UPDATE users SET {set_clause} WHERE id = ?", list(updates.values()) + [user_id])
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

    if not row["active"]:
        for token, uid in list(sessions.items()):
            if uid == user_id:
                sessions.pop(token, None)

    return _user_public(row)


@app.post("/api/admin/users/{user_id}/reset-password")
async def reset_password(user_id: int, session: Session = Depends(require_admin)):
    temp_password = generate_temp_password()
    password_hash = ph.hash(temp_password)

    with get_db() as conn:
        existing = conn.execute(
            "SELECT username, display_name, email FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="Utente non trovato")
        conn.execute(
            "UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?",
            (password_hash, user_id),
        )

    for token, uid in list(sessions.items()):
        if uid == user_id:
            sessions.pop(token, None)

    email_sent = send_credentials_email(
        existing["email"], existing["display_name"], existing["username"], temp_password
    )
    return {
        "id": user_id,
        "username": existing["username"],
        "temp_password": temp_password,
        "email_sent": email_sent,
    }


@app.delete("/api/admin/users/{user_id}")
async def delete_user(user_id: int, session: Session = Depends(require_admin)):
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="Utente non trovato")
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))

    for token, uid in list(sessions.items()):
        if uid == user_id:
            sessions.pop(token, None)

    return {"ok": True}


@app.get("/api/points")
async def list_points(category: str, session: Session = Depends(require_active_session)):
    _validate_category(category)
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM points WHERE category = ? ORDER BY id DESC", (category,)
        ).fetchall()
        return [dict(r) for r in rows]


@app.post("/api/points")
async def create_point(body: PointCreate, session: Session = Depends(require_active_session)):
    _validate_category(body.category)
    _validate_stato(body.stato)
    now = now_iso()
    with get_db() as conn:
        cur = conn.execute(
            """
            INSERT INTO points (category, lat, lon, note, stato, creato_il, aggiornato_il)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (body.category, body.lat, body.lon, body.note, body.stato, now, now),
        )
        new_id = cur.lastrowid
        row = conn.execute("SELECT * FROM points WHERE id = ?", (new_id,)).fetchone()
        return dict(row)


@app.put("/api/points/{point_id}")
async def update_point(point_id: int, body: PointUpdate, session: Session = Depends(require_active_session)):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM points WHERE id = ?", (point_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Punto non trovato")

        stato = body.stato if body.stato is not None else row["stato"]
        note = body.note if body.note is not None else row["note"]
        if body.stato is not None:
            _validate_stato(body.stato)

        now = now_iso()
        conn.execute(
            "UPDATE points SET note = ?, stato = ?, aggiornato_il = ? WHERE id = ?",
            (note, stato, now, point_id),
        )
        row = conn.execute("SELECT * FROM points WHERE id = ?", (point_id,)).fetchone()
        return dict(row)


@app.delete("/api/points/{point_id}")
async def delete_point(point_id: int, session: Session = Depends(require_active_session)):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM points WHERE id = ?", (point_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Punto non trovato")
        conn.execute("DELETE FROM points WHERE id = ?", (point_id,))
        return {"ok": True}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("PORT", "8094")))
