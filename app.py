"""Torneio Xadrez Entre Amigos: inscrição, sorteio balanceado e confirmação Lichess."""
from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import random
import re
import secrets
import time
import threading
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import requests
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, create_engine, select, func, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

BASE = Path(__file__).resolve().parent
DB_URL = os.getenv("DATABASE_URL", f"sqlite:///{BASE / 'torneio.db'}")
if DB_URL.startswith('postgres://'):
    DB_URL = 'postgresql://' + DB_URL[len('postgres://'):]
connect_args = {"check_same_thread": False} if DB_URL.startswith('sqlite') else {}
engine = create_engine(DB_URL, connect_args=connect_args, pool_pre_ping=True)
Session = sessionmaker(bind=engine, expire_on_commit=False)
SECRET = os.getenv("SECRET_KEY") or secrets.token_urlsafe(40)
AUTH = URLSafeTimedSerializer(SECRET, salt="xadrez-admin-v1")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
HTTP = requests.Session()
HTTP.headers.update({"User-Agent": "XadrezEntreAmigos/1.0 (Lichess API integration; public game metadata)"})
LICHESS_LOCK = threading.Lock()
lichess_cooldown_until = 0.0
USERNAME_RE = re.compile(r"^[A-Za-z0-9_-]{2,30}$")
GAME_URL_RE = re.compile(r"^https://lichess\.org/[a-zA-Z0-9]{8}(?:/[a-zA-Z0-9]+)?(?:\?.*)?$", re.I)
recent_signups = defaultdict(deque)
recent_logins = defaultdict(deque)


class Base(DeclarativeBase):
    pass


class Player(Base):
    __tablename__ = 'players'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(70), nullable=False)
    nick: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    nick_key: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    rating_reported: Mapped[int] = mapped_column(Integer, nullable=False)
    rating_official: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    provisional: Mapped[int] = mapped_column(Integer, default=0)
    verified: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Tournament(Base):
    __tablename__ = 'tournaments'
    id: Mapped[int] = mapped_column(primary_key=True)
    status: Mapped[str] = mapped_column(String(20), default="registration")
    current_round: Mapped[int] = mapped_column(Integer, default=0)
    round_started: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    deadline: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    champion_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False, default="Copa Mata-Mata | Xadrez Entre Amigos", server_default="Copa Mata-Mata | Xadrez Entre Amigos")
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="Uma copa eliminatória onde cada partida importa. Inscreva-se, descubra seu adversário e dispute o título!", server_default="Uma copa eliminatória onde cada partida importa. Inscreva-se, descubra seu adversário e dispute o título!")
    prize: Mapped[str] = mapped_column(String(160), nullable=False, default="", server_default="")
    minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=10, server_default="10")
    increment: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    round_days: Mapped[int] = mapped_column(Integer, nullable=False, default=5, server_default="5")
    contact_day: Mapped[int] = mapped_column(Integer, nullable=False, default=2, server_default="2")
    wo_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=15, server_default="15")


class TournamentArchive(Base):
    __tablename__ = 'tournament_archives'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    archived_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)


class Match(Base):
    __tablename__ = 'matches'
    id: Mapped[int] = mapped_column(primary_key=True)
    round_no: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    player1_id: Mapped[int] = mapped_column(Integer, ForeignKey('players.id'), nullable=False)
    player2_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey('players.id'), nullable=True)
    winner_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey('players.id'), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default='pending')
    result_source: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    game_url: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


Base.metadata.create_all(engine)
# Migração não destrutiva: os torneios existentes permanecem intactos.
# No primeiro deploy após esta versão, acrescenta apenas as novas colunas.
with engine.begin() as conn:
    existing = {col['name'] for col in inspect(conn).get_columns('tournaments')}
    columns = {
        'title': "VARCHAR(120) NOT NULL DEFAULT 'Copa Mata-Mata | Xadrez Entre Amigos'",
        'description': "VARCHAR(500) NOT NULL DEFAULT 'Uma copa eliminatória onde cada partida importa. Inscreva-se, descubra seu adversário e dispute o título!'",
        'prize': "VARCHAR(160) NOT NULL DEFAULT ''",
        'minutes': 'INTEGER NOT NULL DEFAULT 10',
        'increment': 'INTEGER NOT NULL DEFAULT 0',
        'round_days': 'INTEGER NOT NULL DEFAULT 5',
        'contact_day': 'INTEGER NOT NULL DEFAULT 2',
        'wo_minutes': 'INTEGER NOT NULL DEFAULT 15',
    }
    for name, ddl in columns.items():
        if name not in existing:
            conn.execute(text(f'ALTER TABLE tournaments ADD COLUMN {name} {ddl}'))
with Session.begin() as db:
    if db.get(Tournament, 1) is None:
        db.add(Tournament(id=1, status="registration", current_round=0))

app = FastAPI(title="Copa Mata-Mata | Xadrez Entre Amigos", docs_url=None, redoc_url=None)


def utc(d: Optional[datetime]):
    if d is None:
        return None
    return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d.astimezone(timezone.utc)


def iso(d):
    return utc(d).isoformat().replace('+00:00', 'Z') if d else None


def pdata(p):
    return {
        "id": p.id, "name": p.name, "nick": p.nick, "rating": p.rating,
        "rating_reported": p.rating_reported, "rating_official": p.rating_official,
        "provisional": bool(p.provisional), "verified": bool(p.verified),
    }


def mdata(m):
    return {"id": m.id, "round": m.round_no, "order": m.sort_order,
            "p1": m.player1_id, "p2": m.player2_id, "winner": m.winner_id,
            "status": m.status, "game_url": m.game_url, "source": m.result_source,
            "notes": m.notes}


def tournament_settings(t):
    return {
        'title': t.title,
        'description': t.description,
        'prize': t.prize,
        'minutes': t.minutes,
        'increment': t.increment,
        'round_days': t.round_days,
        'contact_day': t.contact_day,
        'wo_minutes': t.wo_minutes,
    }


def status_data(db):
    t = db.get(Tournament, 1)
    players = db.scalars(select(Player).order_by(Player.created_at, Player.id)).all()
    matches = db.scalars(select(Match).order_by(Match.round_no, Match.sort_order)).all()
    return {
        "status": t.status, "round": t.current_round, "started": iso(t.round_started),
        "deadline": iso(t.deadline), "champion_id": t.champion_id,
        "players": [pdata(p) for p in players], "matches": [mdata(m) for m in matches],
        "admin_enabled": bool(ADMIN_PASSWORD),
        "settings": tournament_settings(t),
        "viewing_archive": False,
    }


def fail(status, message):
    raise HTTPException(status_code=status, detail=message)


def is_admin(req: Request):
    cookie = req.cookies.get("xadrez_admin")
    if not cookie or not ADMIN_PASSWORD:
        return False
    try:
        val = AUTH.loads(cookie, max_age=12 * 3600)
        fingerprint = hashlib.sha256(ADMIN_PASSWORD.encode()).hexdigest()
        return hmac.compare_digest(val, fingerprint)
    except (BadSignature, SignatureExpired):
        return False


def require_admin(req: Request):
    if not is_admin(req):
        fail(401, "Entre no painel com a senha de administrador.")
    # Cookie de sessão SameSite=Strict e cabeçalho JSON obrigatório nas rotas mutáveis.


def lichess_get(url, **kwargs):
    """Respeita a recomendação do Lichess: uma chamada por vez e 1 min após HTTP 429."""
    global lichess_cooldown_until
    with LICHESS_LOCK:
        if time.monotonic() < lichess_cooldown_until:
            return None
        response = HTTP.get(url, **kwargs)
        if response.status_code == 429:
            lichess_cooldown_until = time.monotonic() + 65
        return response


def get_public_user(nick: str):
    """None when Lichess is temporarily unreachable, 404 if user does not exist."""
    try:
        resp = lichess_get(f"https://lichess.org/api/user/{nick}", timeout=(4, 7))
        if resp is None:
            return None
        if resp.status_code == 404:
            fail(400, "Esse usuário não existe no Lichess. Confira o nick.")
        if resp.status_code in (429, 500, 502, 503, 504):
            return None
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException:
        return None


def choose_pairs(players: list[Player], previous_byes: dict[int, int], rng: random.Random):
    """Sorteia folgas e pares com preferência estatística por rating próximo."""
    n = len(players)
    if n < 2:
        return [], []
    lower = 2 ** (n.bit_length() - 1)
    byes_number = 0 if n == lower else 2 * lower - n
    candidates = players[:]
    rng.shuffle(candidates)
    # Evita, sempre que possível, que a mesma pessoa receba duas folgas.
    candidates.sort(key=lambda p: previous_byes.get(p.id, 0))
    bye = candidates[:byes_number]
    waiting = candidates[byes_number:]
    waiting.sort(key=lambda p: (p.rating, rng.random()))
    pairs = []
    # Dividir por blocos de rating e sortear entre pareamentos próximos do ótimo.
    # Evita o efeito dominó do sorteio guloso, que pode deixar os dois últimos
    # participantes com uma diferença de rating desproporcional.
    for start in range(0, len(waiting), 4):
        group = waiting[start:start + 4]
        if len(group) == 2:
            chosen = [(group[0], group[1])]
        else:
            matchings = [
                [(group[0], group[1]), (group[2], group[3])],
                [(group[0], group[2]), (group[1], group[3])],
                [(group[0], group[3]), (group[1], group[2])],
            ]
            costs = [sum(abs(a.rating-b.rating) for a,b in matching) for matching in matchings]
            minimum = min(costs)
            weights = [math.exp(-(cost-minimum)/100) for cost in costs]
            chosen = rng.choices(matchings, weights=weights, k=1)[0]
        for a, b in chosen:
            pairs.append((a,b) if rng.random()<0.5 else (b,a))
    rng.shuffle(pairs)
    rng.shuffle(bye)
    return pairs, bye


def bye_counts(db):
    counts = defaultdict(int)
    for m in db.scalars(select(Match).where(Match.status == "bye")):
        counts[m.player1_id] += 1
    return counts


def add_round(db, t, advancing: list[Player]):
    if len(advancing) == 1:
        t.status = "finished"
        t.champion_id = advancing[0].id
        t.round_started = None
        t.deadline = None
        return
    if not advancing:
        t.status = "finished"
        t.champion_id = None
        t.round_started = None
        t.deadline = None
        return
    t.current_round += 1
    t.round_started = datetime.now(timezone.utc)
    t.deadline = t.round_started + timedelta(days=t.round_days)
    pairs, bye = choose_pairs(advancing, bye_counts(db), random.SystemRandom())
    idx = 1
    for p1, p2 in pairs:
        db.add(Match(round_no=t.current_round, sort_order=idx,
                     player1_id=p1.id, player2_id=p2.id, status="pending"))
        idx += 1
    for p in bye:
        db.add(Match(round_no=t.current_round, sort_order=idx,
                     player1_id=p.id, player2_id=None, winner_id=p.id,
                     status="bye", result_source="automatic"))
        idx += 1


class Signup(BaseModel):
    name: str = Field(min_length=2, max_length=70)
    nick: str = Field(min_length=2, max_length=30)
    rating: int = Field(ge=400, le=3500)

    @field_validator('name')
    @classmethod
    def strip_name(cls, v):
        v = ' '.join(v.split())
        if len(v) < 2 or not any(ch.isalpha() for ch in v):
            raise ValueError('Informe um nome válido.')
        return v

    @field_validator('nick')
    @classmethod
    def validate_nick(cls, v):
        v = v.strip().lstrip('@')
        if not USERNAME_RE.fullmatch(v):
            raise ValueError('Nick inválido para o Lichess.')
        return v


class Password(BaseModel):
    password: str


class Result(BaseModel):
    choice: str
    game_url: Optional[str] = None
    notes: Optional[str] = None


class UseGame(BaseModel):
    game_id: str


class TournamentSettingsIn(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    description: str = Field(min_length=0, max_length=500)
    prize: str = Field(default="", max_length=160)
    minutes: int = Field(ge=1, le=60)
    increment: int = Field(ge=0, le=60)
    round_days: int = Field(ge=1, le=30)
    contact_day: int = Field(ge=1, le=30)
    wo_minutes: int = Field(ge=0, le=60)

    @field_validator('title')
    @classmethod
    def normal_title(cls, value):
        normalized = ' '.join(value.split())
        if len(normalized) < 3:
            raise ValueError('Informe um nome de torneio com pelo menos três caracteres.')
        return normalized

    @field_validator('description', 'prize')
    @classmethod
    def normalized_text(cls, value):
        return value.strip()


class NewTournamentIn(TournamentSettingsIn):
    pass


def validate_settings(value: TournamentSettingsIn):
    if value.contact_day > value.round_days:
        fail(400, 'O dia para contato inicial não pode ultrapassar o prazo da rodada.')


def update_settings(t, data: TournamentSettingsIn):
    for key, value in data.model_dump().items():
        setattr(t, key, value)


@app.get('/')
def homepage():
    return FileResponse(BASE / 'static' / 'index.html')


@app.get('/static/{filename}')
def static_file(filename: str):
    if filename not in ('app.css', 'app.js', 'favicon.svg'):
        fail(404, "Arquivo não encontrado")
    return FileResponse(BASE / 'static' / filename)


@app.get('/api/tournaments')
def tournament_history():
    with Session() as db:
        t = db.get(Tournament, 1)
        archives = db.scalars(select(TournamentArchive).order_by(TournamentArchive.id.desc())).all()
        return {'tournaments': [
            {'id': 0, 'title': t.title, 'status': t.status, 'current': True},
            *[{'id': a.id, 'title': a.title, 'status': 'finished', 'current': False,
               'archived_at': iso(a.archived_at)} for a in archives]
        ]}


@app.get('/api/tournaments/{archive_id}')
def archived_tournament(archive_id: int):
    with Session() as db:
        a = db.get(TournamentArchive, archive_id)
        if not a:
            fail(404, 'Edição anterior não encontrada.')
        return {**json.loads(a.snapshot), 'viewing_archive': True,
                'archive_id': a.id, 'archived_at': iso(a.archived_at)}


@app.get('/api/state')
def state():
    with Session() as db:
        return status_data(db)


@app.get('/api/preview')
def preview():
    with Session() as db:
        t = db.get(Tournament, 1)
        if t.status != 'registration':
            return {"pairs": [], "byes": []}
        players = db.scalars(select(Player).order_by(Player.id)).all()
        if len(players) < 2:
            return {"pairs": [], "byes": []}
        # Mesmo conjunto de inscritos => prévia estável, mas cada nova inscrição muda a prévia.
        seed = int(hashlib.sha256((','.join(str(p.id) for p in players)+'preview').encode()).hexdigest()[:16], 16)
        pairs, bye = choose_pairs(players, {}, random.Random(seed))
        return {"pairs": [[a.id, b.id] for a, b in pairs], "byes": [p.id for p in bye]}


@app.post('/api/register', status_code=201)
def register(data: Signup, request: Request):
    # Limite simples por IP para grupos de pequeno porte; recomendar proxy/limite externo em escala.
    ip = request.client.host if request.client else 'unknown'
    now = time.monotonic()
    queue = recent_signups[ip]
    while queue and now-queue[0] > 900:
        queue.popleft()
    if len(queue) >= 10:
        fail(429, "Muitas inscrições deste endereço. Tente novamente mais tarde.")
    with Session.begin() as db:
        if db.get(Tournament, 1).status != 'registration':
            fail(409, "As inscrições estão encerradas.")
        if db.scalar(select(Player.id).where(Player.nick_key == data.nick.casefold())):
            fail(409, "Esse nick já está inscrito.")
    public = get_public_user(data.nick)
    official = None
    provisional = False
    verified = False
    if public:
        verified = True
        account = public.get('username') or public.get('id') or data.nick
        perfs = (public.get('perfs') or {}).get('rapid') or {}
        official = perfs.get('rating')
        provisional = bool(perfs.get('prov', False))
        if not isinstance(official, int):
            official = None
    else:
        account = data.nick
    p = Player(name=data.name, nick=account, nick_key=account.casefold(),
               rating_reported=data.rating, rating_official=official,
               rating=official if official is not None else data.rating,
               provisional=int(provisional), verified=int(verified))
    try:
        with Session.begin() as db:
            if db.get(Tournament, 1).status != 'registration':
                fail(409, "As inscrições foram encerradas.")
            db.add(p)
    except IntegrityError:
        fail(409, "Esse nick já está inscrito.")
    queue.append(now)
    return {"message": "Inscrição registrada!", "player": pdata(p)}


@app.get('/api/admin/session')
def admin_session(request: Request):
    return {"authenticated": is_admin(request), "enabled": bool(ADMIN_PASSWORD)}


@app.post('/api/admin/login')
def login(data: Password, response: Response, request: Request):
    if not ADMIN_PASSWORD:
        fail(503, "ADMIN_PASSWORD precisa ser configurada no servidor.")
    # Limite simples por IP contra tentativas repetidas de adivinhar senha.
    ip = request.client.host if request.client else 'unknown'
    queue = recent_logins[ip]
    now = time.monotonic()
    while queue and now-queue[0] > 900:
        queue.popleft()
    if len(queue) >= 8:
        fail(429, 'Muitas tentativas de login. Tente novamente depois de 15 minutos.')
    if not hmac.compare_digest(data.password.encode(), ADMIN_PASSWORD.encode()):
        queue.append(now)
        fail(401, "Senha incorreta.")
    queue.clear()
    fingerprint = hashlib.sha256(ADMIN_PASSWORD.encode()).hexdigest()
    token = AUTH.dumps(fingerprint)
    response.set_cookie("xadrez_admin", token, httponly=True, secure=os.getenv('COOKIE_SECURE', '0') == '1',
                        samesite='strict', max_age=12*3600, path='/')
    return {"message": "Acesso autorizado."}


@app.post('/api/admin/logout')
def logout(request: Request, response: Response):
    require_admin(request)
    response.delete_cookie("xadrez_admin", path='/')
    return {"message": "Sessão encerrada."}


@app.delete('/api/admin/players/{player_id}')
def remove_player(player_id: int, request: Request):
    require_admin(request)
    with Session.begin() as db:
        if db.get(Tournament, 1).status != 'registration':
            fail(409, 'Não é possível excluir inscritos depois de iniciado o torneio.')
        p = db.get(Player, player_id)
        if not p:
            fail(404, "Jogador não encontrado.")
        db.delete(p)
    return {"message": "Inscrição removida."}


@app.get('/api/admin/export')
def export_tournament_history(request: Request):
    require_admin(request)
    with Session() as db:
        archived = db.scalars(select(TournamentArchive).order_by(TournamentArchive.id)).all()
        return {
            'format': 'xadrez-entre-amigos-backup-v1',
            'exported_at': iso(datetime.now(timezone.utc)),
            'current': status_data(db),
            'archives': [
                {'id': a.id, 'title': a.title, 'archived_at': iso(a.archived_at),
                 'data': json.loads(a.snapshot)} for a in archived
            ],
        }


@app.put('/api/admin/settings')
def save_tournament_settings(data: TournamentSettingsIn, request: Request):
    require_admin(request)
    validate_settings(data)
    with Session.begin() as db:
        t = db.get(Tournament, 1)
        if t.status != 'registration':
            locked = ('minutes', 'increment', 'round_days', 'contact_day', 'wo_minutes')
            old = tournament_settings(t)
            for key in locked:
                if getattr(data, key) != old[key]:
                    fail(409, 'Após o sorteio, ritmo e prazos ficam bloqueados para preservar a integridade das rodadas.')
        update_settings(t, data)
    return {'message': 'Informações do torneio atualizadas.'}


@app.post('/api/admin/tournaments/new', status_code=201)
def create_next_tournament(data: NewTournamentIn, request: Request):
    require_admin(request)
    validate_settings(data)
    with Session.begin() as db:
        t = db.get(Tournament, 1)
        if t.status == 'active':
            fail(409, 'Conclua primeiro todas as rodadas do torneio atual.')
        previous = status_data(db)
        if t.status == 'registration' and previous['players']:
            fail(409, 'Há inscrições abertas. Para preservar os participantes, conclua a edição antes de criar outra.')
        if previous['players'] or previous['matches'] or t.status == 'finished':
            # Guarda uma cópia completa e imutável da edição anterior antes de limpar os dados ativos.
            db.add(TournamentArchive(title=t.title,
                                     snapshot=json.dumps(previous, ensure_ascii=False)))
        db.query(Match).delete(synchronize_session=False)
        db.query(Player).delete(synchronize_session=False)
        t.status = 'registration'
        t.current_round = 0
        t.round_started = None
        t.deadline = None
        t.champion_id = None
        update_settings(t, data)
    return {'message': 'Nova edição criada! A edição anterior foi preservada no histórico.'}


@app.post('/api/admin/start')
def start(request: Request):
    require_admin(request)
    with Session.begin() as db:
        t = db.get(Tournament, 1)
        if t.status != 'registration':
            fail(409, 'O torneio já foi iniciado.')
        participants = db.scalars(select(Player)).all()
        if len(participants) < 2:
            fail(409, 'São necessários pelo menos 2 inscritos.')
        t.status = 'active'
        add_round(db, t, participants)
    return {"message": "Inscrições encerradas. Primeira rodada iniciada!"}


@app.post('/api/admin/next-round')
def next_round(request: Request):
    require_admin(request)
    with Session.begin() as db:
        t = db.get(Tournament, 1)
        if t.status != 'active':
            fail(409, 'Não há rodada ativa.')
        matches = db.scalars(select(Match).where(Match.round_no == t.current_round)).all()
        if not matches or any(m.status in ('pending','draw_pending') for m in matches):
            fail(409, "Há partidas sem resultado confirmado nesta rodada.")
        winners = [db.get(Player, m.winner_id) for m in matches if m.winner_id]
        add_round(db, t, winners)
    return {"message": "Próxima rodada gerada."}


def editable_match(db, match_id):
    t = db.get(Tournament, 1)
    m = db.get(Match, match_id)
    if not m:
        fail(404, 'Confronto não encontrado.')
    if t.status != 'active' or m.round_no != t.current_round:
        fail(409, 'Só é permitido alterar partidas da rodada atual.')
    if m.player2_id is None:
        fail(409, 'Classificação automática não pode ser alterada.')
    return m


@app.post('/api/admin/matches/{match_id}/result')
def save_result(match_id: int, data: Result, request: Request):
    require_admin(request)
    if data.choice not in ('p1', 'p2', 'p1_wo', 'p2_wo', 'double', 'draw'):
        fail(400, 'Resultado inválido.')
    link = (data.game_url or '').strip()
    if link and not GAME_URL_RE.fullmatch(link):
        fail(400, 'Informe um link de partida válido do Lichess (https://lichess.org/abcdefgh).')
    with Session.begin() as db:
        m = editable_match(db, match_id)
        m.status = 'draw_pending' if data.choice == 'draw' else 'complete' if data.choice in ('p1', 'p2') else 'wo' if data.choice in ('p1_wo', 'p2_wo') else 'double_wo'
        m.winner_id = m.player1_id if data.choice in ('p1', 'p1_wo') else m.player2_id if data.choice in ('p2', 'p2_wo') else None
        m.result_source = 'manual'
        m.game_url = link or None
        m.notes = (data.notes or '')[:300] or None
    return {"message": "Resultado salvo."}


def inspect_games(m: Match, db):
    t = db.get(Tournament, 1)
    p1, p2 = db.get(Player, m.player1_id), db.get(Player, m.player2_id)
    started = utc(t.round_started)
    deadline = utc(t.deadline)
    if not p2:
        return []
    params = {'vs': p2.nick, 'since': int(started.timestamp()*1000),
              'until': int(min(deadline, datetime.now(timezone.utc)).timestamp()*1000),
              'max': 60, 'moves': 'false', 'tags': 'true', 'clocks': 'false',
              'sort': 'dateDesc'}
    try:
        resp = lichess_get(f'https://lichess.org/api/games/user/{p1.nick}', params=params,
                        headers={'Accept': 'application/x-ndjson'}, timeout=(5, 18))
        if resp is None or resp.status_code == 429:
            fail(503, 'Lichess limitou as consultas temporariamente. Aguarde pelo menos um minuto.')
        resp.raise_for_status()
    except requests.RequestException:
        fail(503, 'Não foi possível consultar o Lichess neste momento.')
    results = []
    for line in resp.text.splitlines():
        if not line.strip():
            continue
        try:
            g = json.loads(line)
        except ValueError:
            continue
        clock = g.get('clock') or {}
        if clock.get('initial') != t.minutes * 60 or clock.get('increment') != t.increment:
            continue
        if g.get('variant') != 'standard':
            continue
        white = (g.get('players') or {}).get('white') or {}
        black = (g.get('players') or {}).get('black') or {}
        wnick = ((white.get('user') or {}).get('id') or (white.get('user') or {}).get('name') or '').casefold()
        bnick = ((black.get('user') or {}).get('id') or (black.get('user') or {}).get('name') or '').casefold()
        if {wnick, bnick} != {p1.nick_key, p2.nick_key}:
            continue
        end_ts = g.get('lastMoveAt') or g.get('createdAt') or 0
        start_ts = g.get('createdAt') or 0
        if not (int(started.timestamp()*1000) <= start_ts and end_ts <= int(deadline.timestamp()*1000)):
            continue
        if g.get('status') in ('created', 'started', 'aborted', 'noStart', 'unknownFinish'):
            continue
        color = g.get('winner')
        victor = wnick if color == 'white' else bnick if color == 'black' else None
        winner_id = p1.id if victor == p1.nick_key else p2.id if victor == p2.nick_key else None
        results.append({'id': g['id'], 'url': 'https://lichess.org/' + g['id'],
                        'created_at': datetime.fromtimestamp(start_ts/1000, timezone.utc).isoformat(),
                        'winner_id': winner_id, 'draw': not bool(color),
                        'white': wnick, 'black': bnick, 'status': g.get('status', '')})
    results.sort(key=lambda g: g['created_at'], reverse=True)
    return results


@app.get('/api/admin/matches/{match_id}/lichess')
def lichess_games(match_id: int, request: Request):
    require_admin(request)
    with Session() as db:
        m = editable_match(db, match_id)
        t = db.get(Tournament, 1)
        return {"games": inspect_games(m, db),
                "note": f"Confira qual partida corresponde ao torneio antes de registrar. Empates exigem desempate {t.minutes}+{t.increment}."}


@app.post('/api/admin/matches/{match_id}/use-game')
def use_game(match_id: int, data: UseGame, request: Request):
    require_admin(request)
    if not re.fullmatch(r'[A-Za-z0-9]{8}', data.game_id):
        fail(400, "ID de partida inválido.")
    with Session.begin() as db:
        m = editable_match(db, match_id)
        candidates = inspect_games(m, db)
        chosen = next((g for g in candidates if g['id'] == data.game_id), None)
        if not chosen:
            fail(409, 'Partida não encontrada com nick, prazo e ritmo 10+0 correspondentes.')
        m.status = 'draw_pending' if chosen['draw'] else 'complete'
        m.winner_id = chosen['winner_id']
        m.result_source = 'lichess'
        m.game_url = chosen['url']
        m.notes = 'Resultado confirmado pelo administrador após consulta à API.'
    return {"message": "Partida do Lichess confirmada."}


@app.get('/health')
def health():
    return {"ok": True}