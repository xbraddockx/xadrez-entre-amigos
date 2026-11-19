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

DEFAULT_REGULATION = [
  {
    "title": "1. FORMATO DO TORNEIO",
    "body": "- O torneio será disputado em chaves eliminatórias.\n- O vencedor de cada confronto avança para a próxima fase.\n- O perdedor será eliminado.\n- Os confrontos serão definidos por sorteio, buscando adversários de ratings próximos."
  },
  {
    "title": "2. PRAZO E AGENDAMENTO",
    "body": "- Cada rodada terá duração máxima de {round_days} dias corridos.\n- Os adversários deverão entrar em contato e tentar agendar a partida até o {contact_day}º dia da rodada.\n- Os jogadores poderão escolher livremente o dia e o horário, desde que respeitem o prazo da rodada.\n- A organização divulgará a data e o horário exatos de início e encerramento de cada rodada.\n- As partidas deverão ser concluídas até o horário de encerramento divulgado."
  },
  {
    "title": "3. RITMO DE JOGO",
    "body": "- Cada confronto será disputado em uma partida de {minutes} minutos com {increment} segundo(s) de incremento ({time_control}).\n- As cores serão definidas por sorteio.\n- Em caso de empate, será disputada uma partida de desempate no ritmo {tiebreak_time_control}, alternando as cores a cada nova partida até haver um vencedor."
  },
  {
    "title": "4. ELIMINAÇÃO POR W.O.",
    "body": "- O jogador que não comparecer ao horário combinado, após {wo_minutes} minutos de tolerância, perderá por W.O.\n- O jogador que não responder às tentativas comprovadas de agendamento poderá perder por W.O.\n- Se ambos não realizarem a partida dentro do prazo, sem responsabilidade individual comprovada, os dois serão eliminados.\n- Não haverá prorrogação do prazo, salvo decisão excepcional da organização.\n- Em caso de desacordo, a organização avaliará as mensagens de agendamento para definir a responsabilidade pelo não comparecimento."
  },
  {
    "title": "5. COMUNICAÇÃO DOS RESULTADOS",
    "body": "- O vencedor deverá enviar o link da partida no Lichess ao grupo do torneio.\n- A organização atualizará as chaves após o encerramento de cada rodada."
  },
  {
    "title": "6. REGRAS GERAIS",
    "body": "- É proibido utilizar motores de análise, inteligência artificial ou qualquer auxílio externo durante as partidas.\n- Os participantes deverão respeitar os adversários e manter o espírito esportivo.\n- Os casos não previstos serão resolvidos pela organização."
  },
  {
    "title": "7. CAMPEÃO",
    "body": "- Será declarado campeão o jogador que vencer seus confrontos até a final."
  }
]


def regulation_sections(t):
    try:
        data = json.loads(t.regulation_json) if t.regulation_json else None
        if isinstance(data, list) and len(data) == 7:
            return data
    except (TypeError, ValueError):
        pass
    return DEFAULT_REGULATION


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
    ratings_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    disqualified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    disqualified_round: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    disqualification_reason: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
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
    tiebreak_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=5, server_default="5")
    tiebreak_increment: Mapped[int] = mapped_column(Integer, nullable=False, default=3, server_default="3")
    regulation_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


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
    white_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default='pending')
    result_source: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    game_url: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class MatchGame(Base):
    __tablename__ = 'match_games'
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    match_id: Mapped[int] = mapped_column(Integer, ForeignKey('matches.id'), nullable=False, index=True)
    outcome: Mapped[str] = mapped_column(String(12), nullable=False)
    game_url: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    result_source: Mapped[str] = mapped_column(String(30), nullable=False, default='manual')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


Base.metadata.create_all(engine)
with engine.begin() as conn:
    match_columns = {col['name'] for col in inspect(conn).get_columns('matches')}
    if 'white_id' not in match_columns:
        conn.execute(text('ALTER TABLE matches ADD COLUMN white_id INTEGER'))
# Migração não destrutiva: os torneios existentes permanecem intactos.
# No primeiro deploy após esta versão, acrescenta apenas as novas colunas.
with engine.begin() as conn:
    player_columns = {col['name'] for col in inspect(conn).get_columns('players')}
    if 'ratings_json' not in player_columns:
        conn.execute(text('ALTER TABLE players ADD COLUMN ratings_json TEXT'))
    if 'disqualified_at' not in player_columns:
        conn.execute(text('ALTER TABLE players ADD COLUMN disqualified_at TIMESTAMP WITH TIME ZONE'))
    if 'disqualified_round' not in player_columns:
        conn.execute(text('ALTER TABLE players ADD COLUMN disqualified_round INTEGER'))
    if 'disqualification_reason' not in player_columns:
        conn.execute(text('ALTER TABLE players ADD COLUMN disqualification_reason VARCHAR(300)'))
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
        'tiebreak_minutes': 'INTEGER NOT NULL DEFAULT 5',
        'tiebreak_increment': 'INTEGER NOT NULL DEFAULT 3',
        'regulation_json': 'TEXT',
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


SPEEDS = ('ultraBullet', 'bullet', 'blitz', 'rapid', 'classical')
SPEED_LABELS = {'ultraBullet': 'UltraBullet', 'bullet': 'Bullet',
                'blitz': 'Blitz', 'rapid': 'Rapid', 'classical': 'Classical'}


def speed_for_clock(minutes, increment):
    """Cálculo oficial: tempo inicial (segundos) + 40 × incremento."""
    seconds = int(minutes) * 60 + int(increment) * 40
    if seconds < 30:
        return 'ultraBullet'
    if seconds < 180:
        return 'bullet'
    if seconds < 480:
        return 'blitz'
    if seconds < 1500:
        return 'rapid'
    return 'classical'


def stored_ratings(p):
    try:
        parsed = json.loads(p.ratings_json or '{}')
        if isinstance(parsed, dict):
            return parsed
    except (ValueError, TypeError):
        pass
    # Legado: antes da atualização, só existia rating Rapid oficial.
    if p.ratings_json is None and p.rating_official is not None:
        return {'rapid': {'rating': p.rating_official, 'prov': bool(p.provisional)}}
    return {}


def effective_rating(p, speed):
    entry = stored_ratings(p).get(speed) or {}
    val = entry.get('rating')
    return val if isinstance(val, int) and not isinstance(val, bool) and val > 0 else None


def pairing_rating(p, speed):
    """Tenta modalidade exata; usa proxy de modalidade vizinha apenas internamente."""
    exact = effective_rating(p, speed)
    if exact is not None:
        return exact
    rank = SPEEDS.index(speed)
    for alternative in sorted((x for x in SPEEDS if x != speed), key=lambda x: abs(SPEEDS.index(x) - rank)):
        fallback = effective_rating(p, alternative)
        if fallback is not None:
            return fallback
    return 1500


def ratings_from_lichess(profile):
    perfs = profile.get('perfs') or {}
    result = {}
    for speed in SPEEDS:
        item = perfs.get(speed) or {}
        val = item.get('rating')
        games = item.get('games')
        if isinstance(val, int) and not isinstance(val, bool) and 400 <= val <= 3500 and (games is None or games > 0):
            result[speed] = {'rating': val, 'prov': bool(item.get('prov', False)),
                             'games': games if isinstance(games, int) else None}
    return result


def pdata(p, t=None, include_private=False):
    # Público recebe só o rating da categoria atual, nunca as outras modalidades
    # ou o rating auxiliar privado usado no sorteio de pares.
    result = {'id': p.id, 'name': p.name, 'nick': p.nick,
              'disqualified': bool(p.disqualified_at), 'disqualified_round': p.disqualified_round}
    if include_private:
        result['ratings_json'] = p.ratings_json
        if p.disqualified_at:
            result['disqualified_at'] = iso(p.disqualified_at)
            result['disqualification_reason'] = p.disqualification_reason
    if t is not None:
        speed = speed_for_clock(t.minutes, t.increment)
        selected = stored_ratings(p).get(speed) or {}
        result['rating'] = effective_rating(p, speed)
        result['provisional'] = bool(selected.get('prov', False))
    return result


def mdata(m):
    return {"id": m.id, "round": m.round_no, "order": m.sort_order,
            "p1": m.player1_id, "p2": m.player2_id, "winner": m.winner_id,
            "status": m.status, "white_id": m.white_id, "game_url": m.game_url, "source": m.result_source,
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
        'tiebreak_minutes': t.tiebreak_minutes,
        'tiebreak_increment': t.tiebreak_increment,
        'regulation_sections': regulation_sections(t),
    }


def game_data(g):
    return {
        'id': g.id, 'match_id': g.match_id, 'outcome': g.outcome,
        'game_url': g.game_url, 'source': g.result_source, 'created_at': iso(g.created_at),
    }


def record_game(db, match, outcome, link, source):
    # Preserva cada empate e sua partida de desempate no histórico.
    # Evita duplicar uma mesma partida quando o administrador confirma novamente.
    existing = None
    if link:
        existing = db.scalar(select(MatchGame).where(
            MatchGame.match_id == match.id, MatchGame.game_url == link))
    elif outcome != 'draw':
        existing = db.scalar(select(MatchGame).where(
            MatchGame.match_id == match.id, MatchGame.game_url.is_(None),
            MatchGame.outcome != 'draw').order_by(MatchGame.id.desc()))
    if existing:
        existing.outcome = outcome
        existing.result_source = source
    else:
        db.add(MatchGame(match_id=match.id, outcome=outcome, game_url=link or None,
                         result_source=source))


def status_data(db, include_private=False):
    t = db.get(Tournament, 1)
    players = db.scalars(select(Player).order_by(Player.created_at, Player.id)).all()
    matches = db.scalars(select(Match).order_by(Match.round_no, Match.sort_order)).all()
    return {
        "status": t.status, "round": t.current_round, "started": iso(t.round_started),
        "deadline": iso(t.deadline), "champion_id": t.champion_id,
        "players": [pdata(p, t, include_private=include_private) for p in players], "matches": [mdata(m) for m in matches],
        "games": [game_data(g) for g in db.scalars(select(MatchGame).order_by(MatchGame.id)).all()],
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


def choose_pairs(players: list[Player], previous_byes: dict[int, int], rng: random.Random, speed: str = 'rapid'):
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
    waiting.sort(key=lambda p: (pairing_rating(p, speed), rng.random()))
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
            costs = [sum(abs(pairing_rating(a, speed)-pairing_rating(b, speed)) for a,b in matching) for matching in matchings]
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


def color_balance(db):
    """Saldo de cores realmente registradas em confrontos anteriores.
    Não conta folgas ou W.O. e não inventa cores em jogos antigos.
    Empates e desempates alternam as cores a cada partida."""
    balance = defaultdict(int)
    matches = db.scalars(select(Match).where(
        Match.white_id.is_not(None), Match.player2_id.is_not(None),
        Match.status.in_(('complete', 'draw_pending'))).order_by(Match.round_no, Match.id)).all()
    games_by_match = defaultdict(list)
    for game in db.scalars(select(MatchGame).order_by(MatchGame.created_at, MatchGame.id)).all():
        games_by_match[game.match_id].append(game)
    for match in matches:
        games = games_by_match.get(match.id, [])
        count = len(games) or 1
        black_id = match.player2_id if match.white_id == match.player1_id else match.player1_id
        # A primeira partida tem a cor sorteada; cada desempate inverte.
        for i in range(count):
            white_id, dark_id = (match.white_id, black_id) if i % 2 == 0 else (black_id, match.white_id)
            balance[white_id] += 1
            balance[dark_id] -= 1
    return balance


def balanced_colors(p1, p2, balances, rng):
    """Escolhe a orientação que minimiza os desvios combinados de cores.
    Caso o custo seja igual, realiza sorteio justo sem considerar rating."""
    options = [(p1.id, p2.id), (p2.id, p1.id)]
    costs = [abs(balances[white]+1) + abs(balances[black]-1)
             for white, black in options]
    best = min(costs)
    choices = [i for i, cost in enumerate(costs) if cost == best]
    selected = rng.choice(choices)
    return options[selected][0]


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
    rng = random.SystemRandom()
    pairs, bye = choose_pairs(advancing, bye_counts(db), rng, speed_for_clock(t.minutes, t.increment))
    balances = color_balance(db)
    idx = 1
    for p1, p2 in pairs:
        white = balanced_colors(p1, p2, balances, rng)
        db.add(Match(round_no=t.current_round, sort_order=idx,
                     player1_id=p1.id, player2_id=p2.id, white_id=white, status="pending"))
        # Equilibra cada escolha feita dentro da própria rodada.
        black = p2.id if white == p1.id else p1.id
        balances[white] += 1
        balances[black] -= 1
        idx += 1
    for p in bye:
        db.add(Match(round_no=t.current_round, sort_order=idx,
                     player1_id=p.id, player2_id=None, winner_id=p.id,
                     status="bye", result_source="automatic"))
        idx += 1


class Signup(BaseModel):
    name: str = Field(min_length=2, max_length=70)
    nick: str = Field(min_length=2, max_length=30)
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
    tiebreak_minutes: int = Field(default=5, ge=1, le=60)
    tiebreak_increment: int = Field(default=3, ge=0, le=60)

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


class RegulationSectionIn(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    body: str = Field(min_length=5, max_length=3500)

    @field_validator('title', 'body')
    @classmethod
    def strip_rule(cls, v):
        return v.strip()


class RegulationUpdateIn(BaseModel):
    sections: list[RegulationSectionIn] = Field(min_length=7, max_length=7)



class ImportPlayersIn(BaseModel):
    archive_id: int = Field(ge=1)
    nicks: list[str] = Field(min_length=1, max_length=100)

    @field_validator('nicks')
    @classmethod
    def normalize_import_nicks(cls, values):
        cleaned = []
        seen = set()
        for nick in values:
            nick = str(nick).strip().lstrip('@')
            if not USERNAME_RE.fullmatch(nick):
                raise ValueError('A seleção contém um nick inválido.')
            key = nick.casefold()
            if key not in seen:
                cleaned.append(nick)
                seen.add(key)
        return cleaned


def imported_ratings(archive_player, archive_settings):
    """Somente ratings oficiais já conhecidos; não inventa rating de modalidade."""
    cached = archive_player.get('ratings_json')
    try:
        cached = json.loads(cached) if isinstance(cached, str) else cached
    except (TypeError, ValueError):
        cached = {}
    result = {}
    if isinstance(cached, dict):
        for speed in SPEEDS:
            entry = cached.get(speed)
            if isinstance(entry, dict):
                rating = entry.get('rating')
                if isinstance(rating, int) and not isinstance(rating, bool) and 400 <= rating <= 3500:
                    result[speed] = {'rating': rating, 'prov': bool(entry.get('prov', False)),
                                     'games': entry.get('games')}
    if not result:
        # Em arquivos antigos havia um único rating exibido na categoria da edição.
        old_rating = archive_player.get('rating')
        if isinstance(old_rating, int) and not isinstance(old_rating, bool) and 400 <= old_rating <= 3500:
            original_speed = speed_for_clock(archive_settings.get('minutes', 10),
                                             archive_settings.get('increment', 0))
            result[original_speed] = {
                'rating': old_rating, 'prov': bool(archive_player.get('provisional', False))
            }
    return result


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
    if filename not in ('app.css', 'app.js', 'favicon.svg', 'trophy.svg'):
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
        data = json.loads(a.snapshot)
        # Remove classificações internas dos históricos legados no endpoint público.
        data['players'] = [{
            'id': p['id'], 'name': p['name'], 'nick': p['nick'],
            'rating': p.get('rating'), 'provisional': p.get('provisional', False),
            'disqualified': bool(p.get('disqualified')), 'disqualified_round': p.get('disqualified_round')
        } for p in data.get('players', [])]
        return {**data, 'viewing_archive': True,
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
        pairs, bye = choose_pairs(players, {}, random.Random(seed), speed_for_clock(t.minutes, t.increment))
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
    if public is None:
        fail(503, 'O Lichess está temporariamente indisponível. Tente novamente mais tarde.')
    account = public.get('username') or public.get('id') or data.nick
    ratings = ratings_from_lichess(public)
    with Session() as db:
        t = db.get(Tournament, 1)
        speed = speed_for_clock(t.minutes, t.increment)
    current = ratings.get(speed) or {}
    p = Player(name=data.name, nick=account, nick_key=account.casefold(),
               rating_reported=1500, rating_official=(ratings.get('rapid') or {}).get('rating'),
               rating=current.get('rating') or 1500, provisional=int(bool(current.get('prov'))),
               verified=1, ratings_json=json.dumps(ratings, ensure_ascii=False))
    try:
        with Session.begin() as db:
            if db.get(Tournament, 1).status != 'registration':
                fail(409, "As inscrições foram encerradas.")
            db.add(p)
    except IntegrityError:
        fail(409, "Esse nick já está inscrito.")
    queue.append(now)
    return {"message": "Inscrição registrada!", "player": {"id": p.id, "name": p.name, "nick": p.nick}}


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
            'current': status_data(db, include_private=True),
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
            locked = ('minutes', 'increment', 'round_days', 'contact_day', 'wo_minutes', 'tiebreak_minutes', 'tiebreak_increment')
            old = tournament_settings(t)
            for key in locked:
                if getattr(data, key) != old[key]:
                    fail(409, 'Após o sorteio, ritmo e prazos ficam bloqueados para preservar a integridade das rodadas.')
        update_settings(t, data)
    return {'message': 'Informações do torneio atualizadas.'}


@app.put('/api/admin/regulation')
def save_regulation(data: RegulationUpdateIn, request: Request):
    require_admin(request)
    with Session.begin() as db:
        t = db.get(Tournament, 1)
        t.regulation_json = json.dumps([section.model_dump() for section in data.sections], ensure_ascii=False)
    return {'message': 'Regulamento atualizado e publicado.'}



@app.get('/api/admin/importable-players')
def list_importable_players(request: Request):
    require_admin(request)
    with Session() as db:
        t = db.get(Tournament, 1)
        if t.status != 'registration':
            return {'available': False, 'editions': [], 'players': [],
                    'message': 'A transferência só é permitida com inscrições abertas.'}
        existing = {p.nick_key for p in db.scalars(select(Player)).all()}
        archives = db.scalars(select(TournamentArchive).order_by(TournamentArchive.id.desc())).all()
        editions = []
        choices = []
        for archive in archives:
            snapshot = json.loads(archive.snapshot)
            edition = {'id': archive.id, 'title': archive.title, 'count': len(snapshot.get('players', []))}
            editions.append(edition)
            seen = set()
            for item in snapshot.get('players', []):
                nick = str(item.get('nick', '')).strip()
                key = nick.casefold()
                if not USERNAME_RE.fullmatch(nick) or key in seen:
                    continue
                seen.add(key)
                choices.append({
                    'archive_id': archive.id, 'nick': nick, 'name': str(item.get('name', '')),
                    'already_registered': key in existing,
                    'disqualified_in_source': bool(item.get('disqualified', False))
                })
        return {'available': True, 'editions': editions, 'players': choices,
                'registered_count': len(existing)}


@app.post('/api/admin/import-players')
def import_players(data: ImportPlayersIn, request: Request):
    """Copia inscrições autorizadas do arquivo para uma edição com inscrições abertas.

    Nicks repetidos, inclusive entre importação e inscrição pública concorrentes,
    são impedidos pela constraint UNIQUE de players.nick_key.
    """
    require_admin(request)
    with Session.begin() as db:
        t = db.get(Tournament, 1)
        if t.status != 'registration':
            fail(409, 'Só é possível transferir jogadores enquanto as inscrições estiverem abertas.')
        archive = db.get(TournamentArchive, data.archive_id)
        if archive is None:
            fail(404, 'Edição de origem não encontrada.')
        snapshot = json.loads(archive.snapshot)
        source = {str(item.get('nick', '')).strip().casefold(): item
                  for item in snapshot.get('players', []) if item.get('nick')}
        missing = [nick for nick in data.nicks if nick.casefold() not in source]
        if missing:
            fail(400, 'Alguns nicks selecionados não pertencem à edição de origem.')
        existing = {p.nick_key for p in db.scalars(select(Player)).all()}
        speed = speed_for_clock(t.minutes, t.increment)
        imported, skipped = [], []
        for nick in data.nicks:
            key = nick.casefold()
            if key in existing:
                skipped.append(nick)
                continue
            record = source[key]
            name = ' '.join(str(record.get('name', '')).split())
            canonical = str(record.get('nick', '')).strip()
            if not (2 <= len(name) <= 70 and USERNAME_RE.fullmatch(canonical)):
                skipped.append(nick)
                continue
            ratings = imported_ratings(record, snapshot.get('settings') or {})
            chosen = ratings.get(speed) or {}
            rapid = ratings.get('rapid') or {}
            player = Player(
                name=name, nick=canonical, nick_key=canonical.casefold(),
                rating_reported=1500, rating_official=rapid.get('rating'),
                rating=chosen.get('rating') or 1500,
                provisional=int(bool(chosen.get('prov'))), verified=int(bool(ratings)),
                ratings_json=json.dumps(ratings, ensure_ascii=False))
            db.add(player)
            existing.add(key)
            imported.append(canonical)
        try:
            db.flush()
        except IntegrityError:
            fail(409, 'Inscrição simultânea detectada. Atualize a lista e tente novamente.')
    return {'message': f'{len(imported)} jogador(es) transferido(s) para a edição atual.',
            'imported': len(imported), 'skipped': skipped}


@app.post('/api/admin/tournaments/new', status_code=201)
def create_next_tournament(data: NewTournamentIn, request: Request):
    require_admin(request)
    validate_settings(data)
    with Session.begin() as db:
        t = db.get(Tournament, 1)
        if t.status == 'active':
            fail(409, 'Conclua primeiro todas as rodadas do torneio atual.')
        previous = status_data(db, include_private=True)
        if t.status == 'registration' and previous['players']:
            fail(409, 'Há inscrições abertas. Para preservar os participantes, conclua a edição antes de criar outra.')
        if previous['players'] or previous['matches'] or t.status == 'finished':
            # Guarda uma cópia completa e imutável da edição anterior antes de limpar os dados ativos.
            db.add(TournamentArchive(title=t.title,
                                     snapshot=json.dumps(previous, ensure_ascii=False)))
        db.query(MatchGame).delete(synchronize_session=False)
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


@app.get('/api/admin/disqualifications')
def admin_disqualifications(request: Request):
    require_admin(request)
    with Session() as db:
        players = db.scalars(select(Player).where(Player.disqualified_at.is_not(None)).order_by(Player.disqualified_at)).all()
        return {'items': [{
            'player_id': p.id, 'reason': p.disqualification_reason,
            'round': p.disqualified_round, 'at': iso(p.disqualified_at)
        } for p in players]}


@app.post('/api/admin/players/{player_id}/disqualify')
def disqualify_player(player_id: int, data: DisqualificationIn, request: Request):
    """Desclassificação técnica sem exclusão de jogadores ou partidas.
    A decisão afeta apenas o confronto da rodada atual.
    Resultados de partidas individuais e links permanecem preservados."""
    require_admin(request)
    with Session.begin() as db:
        t = db.get(Tournament, 1)
        if t.status != 'active':
            fail(409, 'A desclassificação está disponível somente durante o torneio.')
        player = db.get(Player, player_id)
        if not player:
            fail(404, 'Jogador não encontrado.')
        if player.disqualified_at:
            fail(409, 'Este jogador já está desclassificado.')
        match = db.scalar(select(Match).where(
            Match.round_no == t.current_round,
            ((Match.player1_id == player.id) | (Match.player2_id == player.id))))
        player.disqualified_at = datetime.now(timezone.utc)
        player.disqualified_round = t.current_round
        player.disqualification_reason = data.reason
        # Se o jogador já foi eliminado, apenas registra a decisão e retira
        # sua elegibilidade para ranking/pódio. Resultados anteriores não mudam.
        if match and (match.status in ('pending', 'draw_pending')
                      or match.winner_id == player.id):
            if match.player2_id is None:
                # Cancela a vaga de quem avançaria automaticamente por folga.
                match.status = 'dq'
                match.winner_id = None
            else:
                opponent_id = (match.player2_id if match.player1_id == player.id
                               else match.player1_id)
                opponent = db.get(Player, opponent_id)
                if opponent and not opponent.disqualified_at:
                    match.status = 'wo'
                    match.winner_id = opponent.id
                else:
                    match.status = 'double_wo'
                    match.winner_id = None
            match.result_source = 'disqualification'
            # Motivo privado fica apenas no cadastro administrativo.
            match.notes = 'Decisão administrativa de desclassificação.'
            # Não removemos game_url ou MatchGame: o histórico jogado é preservado.
    return {'message': 'Desclassificação registrada. O chaveamento e a classificação foram atualizados.'}


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
        winners = [p for m in matches if m.winner_id
                   for p in [db.get(Player, m.winner_id)] if p and not p.disqualified_at]
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
    if m.result_source == 'disqualification':
        fail(409, 'Confronto encerrado por desclassificação. O resultado técnico não pode ser alterado.')
    return m


class DisqualificationIn(BaseModel):
    reason: str = Field(min_length=8, max_length=300)

    @field_validator('reason')
    @classmethod
    def strip_reason(cls, value):
        value = ' '.join(value.split())
        if len(value) < 8:
            raise ValueError('Informe um motivo de pelo menos 8 caracteres.')
        return value


class MatchColorIn(BaseModel):
    white_id: int


@app.put('/api/admin/matches/{match_id}/color')
def update_match_color(match_id: int, data: MatchColorIn, request: Request):
    """Permite preencher as cores de confrontos antigos sem inventar resultados."""
    require_admin(request)
    with Session.begin() as db:
        match = db.get(Match, match_id)
        if not match or match.player2_id is None:
            fail(404, 'Confronto não encontrado ou houve folga.')
        if data.white_id not in (match.player1_id, match.player2_id):
            fail(400, 'O jogador de brancas precisa pertencer ao confronto.')
        match.white_id = data.white_id
    return {'message': 'Cores do confronto atualizadas.'}


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
        if data.choice in ('p1', 'p2', 'draw'):
            record_game(db, m, data.choice, link, 'manual')
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
        allowed = {(t.minutes * 60, t.increment)}
        if m.status == 'draw_pending':
            allowed.add((t.tiebreak_minutes * 60, t.tiebreak_increment))
        if (clock.get('initial'), clock.get('increment')) not in allowed:
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
                "note": f"Confira a partida. Após empate, o desempate será {t.tiebreak_minutes}+{t.tiebreak_increment}."}


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
        record_game(db, m, 'draw' if chosen['draw'] else ('p1' if chosen['winner_id'] == m.player1_id else 'p2'), chosen['url'], 'lichess')
    return {"message": "Partida do Lichess confirmada."}


@app.get('/health')
def health():
    return {"ok": True}