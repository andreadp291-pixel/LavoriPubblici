# LavoriPubblici

Webapp interna per il Comune di Castelfranco Veneto per la gestione su mappa (OpenStreetMap) di:

- Sfalci erba
- Potature
- Asfaltature

## Architettura

- **Frontend**: HTML/JS statico (questa cartella), pubblicato su GitHub Pages.
- **Backend**: FastAPI + SQLite (`backend/`), in esecuzione sul Raspberry Pi, esposto tramite Tailscale Funnel su `https://andrea.tail04be23.ts.net/lavoripubblici`.

## Login e gestione utenti

- Un account amministratore di bootstrap è definito via `ADMIN_USER`/`ADMIN_PASS` in `backend/.env`.
- L'amministratore può creare altri utenti dalla pagina "Gestione utenti" (visibile solo a lui): inserendo email e nome, il sistema genera una password provvisoria robusta e la invia via email (SMTP configurato in `.env`); se l'invio fallisce o SMTP non è configurato, la password provvisoria è comunque mostrata una tantum a schermo.
- Al primo accesso l'utente creato viene forzato a impostare una password personale (minimo 10 caratteri, con maiuscola, minuscola, numero e carattere speciale).
- L'amministratore può disattivare/riattivare, resettare la password o eliminare un utente in qualsiasi momento.
- Il token di sessione è tenuto in memoria dal backend e in `localStorage` dal frontend (nessun dato sensibile lato client oltre al token).

## Backend - setup sul Raspberry

```bash
cd /home/andrea/LavoriPubblici/backend
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
cp .env.example .env   # poi modifica ADMIN_USER / ADMIN_PASS
sudo cp lavoripubblici.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lavoripubblici.service
```

Aggiungere la route nel Tailscale Funnel esistente:

```bash
sudo tailscale funnel --bg --set-path /lavoripubblici http://127.0.0.1:8094
```

## Frontend - GitHub Pages

Impostazioni repo → Pages → Deploy from branch → `main` / `root`.
