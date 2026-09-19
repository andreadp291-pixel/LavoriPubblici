# -*- coding: utf-8 -*-
"""
LavoriPubblici - backend API
Gestione sfalci erba, potature, asfaltature (mappa OSM) per il Comune.
"""
import os
import secrets
import sqlite3
import time
from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

load_dotenv()

ADMIN_USER = os.getenv("ADMIN_USER", "admin")
ADMIN_PASS = os.getenv("ADMIN_PASS", "changeme_now")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "https://andreadp291-pixel.github.io")
DB_PATH = Path(__file__).parent / "lavoripubblici.db"

CATEGORIES = {"sfalci", "potature", "asfaltature"}
STATI = {"da_fare", "in_corso", "fatto"}

app = FastAPI(title="LavoriPubblici API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer(auto_error=False)
admin_tokens: set[str] = set()
login_attempts: dict[str, list[float]] = defaultdict(list)


def require_admin(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    if credentials and credentials.credentials in admin_tokens:
        return credentials.credentials
    raise HTTPException(status_code=401, detail="Non autorizzato")


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


init_db()


class LoginRequest(BaseModel):
    username: str
    password: str


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


@app.post("/api/login")
async def login(body: LoginRequest, request: Request):
    ip = request.client.host if request.client else "unknown"
    now = time.time()
    attempts = [t for t in login_attempts[ip] if now - t < 600]

    if len(attempts) >= 10:
        raise HTTPException(status_code=429, detail="Troppi tentativi, riprova più tardi")

    if body.username == ADMIN_USER and body.password == ADMIN_PASS:
        login_attempts.pop(ip, None)
        token = secrets.token_hex(32)
        admin_tokens.add(token)
        return {"ok": True, "token": token}

    attempts.append(now)
    login_attempts[ip] = attempts
    raise HTTPException(status_code=401, detail="Credenziali non valide")


@app.post("/api/logout")
async def logout(token: str = Depends(require_admin)):
    admin_tokens.discard(token)
    return {"ok": True}


@app.get("/api/me")
async def me(token: str = Depends(require_admin)):
    return {"ok": True}


@app.get("/api/points")
async def list_points(category: str, token: str = Depends(require_admin)):
    _validate_category(category)
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM points WHERE category = ? ORDER BY id DESC", (category,)
        ).fetchall()
        return [dict(r) for r in rows]


@app.post("/api/points")
async def create_point(body: PointCreate, token: str = Depends(require_admin)):
    _validate_category(body.category)
    _validate_stato(body.stato)
    now = datetime.now().isoformat(timespec="seconds")
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
async def update_point(point_id: int, body: PointUpdate, token: str = Depends(require_admin)):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM points WHERE id = ?", (point_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Punto non trovato")

        stato = body.stato if body.stato is not None else row["stato"]
        note = body.note if body.note is not None else row["note"]
        if body.stato is not None:
            _validate_stato(body.stato)

        now = datetime.now().isoformat(timespec="seconds")
        conn.execute(
            "UPDATE points SET note = ?, stato = ?, aggiornato_il = ? WHERE id = ?",
            (note, stato, now, point_id),
        )
        row = conn.execute("SELECT * FROM points WHERE id = ?", (point_id,)).fetchone()
        return dict(row)


@app.delete("/api/points/{point_id}")
async def delete_point(point_id: int, token: str = Depends(require_admin)):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM points WHERE id = ?", (point_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Punto non trovato")
        conn.execute("DELETE FROM points WHERE id = ?", (point_id,))
        return {"ok": True}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("PORT", "8094")))
