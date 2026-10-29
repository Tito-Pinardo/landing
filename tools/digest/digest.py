#!/usr/bin/env python3
"""Resumen semanal de los lunes para el blog de titopinardogutierrez.com.

Cada domingo por la noche recoge lo que ha salido en la semana y afecta a
mi homelab (versiones nuevas, vulnerabilidades y noticias de fuera), le pide
al modelo local que lo cuente pieza a pieza y manda el borrador a Matrix.
Si respondo «publicar», sale el lunes a las 8:00 como un artículo más del
blog (kind = "digest"), con su commit, su comprobación y su despliegue.

Un solo punto de entrada, `tick`, que lanza un temporizador cada 15 minutos:

    domingo 20:00 → lunes 8:00   prepara el borrador (si aún no lo hay)
    siempre                      lee las respuestas al borrador en Matrix
    lunes ≥ 8:00 y aprobado      publica
    martes ≥ 20:00 sin respuesta caduca (no se publica nada sin permiso)

Órdenes en Matrix (solo las del dueño): «publicar», «descartar» y
«quitar 2» o «quitar 2,4» para sacar novedades del borrador.

Para probar sin tocar nada: `digest.py collect` enseña lo recogido y
`digest.py draft --dry-run` escribe el artículo en la salida.

Solo biblioteca estándar: corre en el contenedor de agentes sin instalar nada.
"""

from __future__ import annotations

import argparse
import datetime as dt
import email.utils
import fcntl
import html
import json
import os
import re
import subprocess
import sys
import time
import tomllib
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path
from zoneinfo import ZoneInfo

MADRID = ZoneInfo("Europe/Madrid")
# El proxy de Matrix da 403 al User-Agent por defecto de urllib.
UA = "tito-landing-digest/1.0 (+https://titopinardogutierrez.com)"
HERE = Path(__file__).resolve().parent
PUBLIC_URL = "https://titopinardogutierrez.com"
# El despliegue rechaza commits con otra identidad (control de fugas): el
# clon del CT 123 hereda la de la máquina, así que se fija al commitear.
PUBLIC_AUTHOR = ["-c", "user.name=Tito-Pinardo", "-c", "user.email=Tito-Pinardo@users.noreply.github.com"]
# Cuánto se espera a que el CI y el despliegue continuo publiquen el artículo.
PUBLISH_WAIT = 40 * 60

MAX_ITEMS = 6          # novedades por resumen
MAX_CANDIDATES = 10    # las que se le pasan al modelo
MAX_PER_UNIT = 2       # para que no sea un resumen de una sola pieza
PRERELEASE = re.compile(r"(?<![a-z])(rc|beta|alpha|nightly|preview|dev|canary|pre)(?![a-z])", re.I)
# Cupo de candidatas por tipo, para que la seguridad no se lleve todo.
QUOTA = {"security": 4, "release": 4, "news": 2}

MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
             "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July",
             "August", "September", "October", "November", "December"]


# --------------------------------------------------------------------------
# Configuración
# --------------------------------------------------------------------------

class Config:
    def __init__(self, env: dict[str, str] | None = None):
        e = os.environ if env is None else env
        home = Path(e.get("HOME", str(Path.home())))
        self.matrix_homeserver = e.get("MATRIX_HOMESERVER", "").rstrip("/")
        self.matrix_token = e.get("MATRIX_ACCESS_TOKEN", "")
        self.matrix_room = e.get("MATRIX_ROOM_ID", "")
        self.owner = e.get("DIGEST_OWNER", "")
        self.ollama = e.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
        self.model = e.get("OLLAMA_MODEL", "qwen3:8b")
        # Gemini primero si hay clave (no depende de que el PC esté encendido);
        # el modelo local queda de respaldo. La clave vive en un fichero 0600,
        # nunca en el repositorio.
        # Varios modelos por orden: si uno está saturado (503/429), el siguiente.
        self.gemini_models = [m.strip() for m in e.get(
            "GEMINI_MODEL", "gemini-3.5-flash,gemini-3.6-flash,gemini-3.1-flash-lite").split(",") if m.strip()]
        key = e.get("GEMINI_API_KEY", "")
        key_file = Path(e.get("DIGEST_GEMINI_KEY_FILE", home / ".config/landing-digest/gemini.key"))
        if not key and key_file.exists():
            key = key_file.read_text().strip()
        self.gemini_key = key
        self.state = Path(e.get("DIGEST_STATE", home / ".local/state/landing-digest"))
        self.repo = Path(e.get("DIGEST_REPO", home / ".local/share/landing-digest/repo"))
        # El origen del repositorio (el de casa, con su CI/CD): publicar es
        # empujar ahí y esperar a que el despliegue continuo lo ponga en la web.
        self.remote = e.get("DIGEST_REMOTE", "")
        self.cargo_path = e.get("DIGEST_CARGO_PATH", str(home / ".cargo/bin"))
        self.gitleaks = e.get("DIGEST_GITLEAKS", str(home / ".local/bin/gitleaks"))
        self.sources = Path(e.get("DIGEST_SOURCES", HERE / "sources.toml"))

    def matrix_ok(self) -> bool:
        return bool(self.matrix_homeserver and self.matrix_token and self.matrix_room and self.owner)


def log(*a):
    print(dt.datetime.now(MADRID).strftime("%Y-%m-%d %H:%M:%S"), *a, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------
# Red
# --------------------------------------------------------------------------

def http(url: str, *, data: bytes | None = None, headers: dict | None = None,
         method: str | None = None, timeout: int = 40, tries: int = 2) -> bytes:
    h = {"User-Agent": UA, **(headers or {})}
    last: Exception | None = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=h, method=method)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code < 500 and e.code != 429:
                raise
            last = e
        except (urllib.error.URLError, TimeoutError) as e:
            last = e
        time.sleep(3 * (i + 1))
    raise last  # type: ignore[misc]


def http_json(url: str, **kw):
    return json.loads(http(url, **kw))


# --------------------------------------------------------------------------
# Feeds
# --------------------------------------------------------------------------

def strip_html(s: str) -> str:
    s = re.sub(r"<(script|style)\b.*?</\1>", " ", s or "", flags=re.S | re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def parse_date(s: str | None) -> dt.datetime | None:
    if not s:
        return None
    s = s.strip()
    try:
        d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        try:
            d = email.utils.parsedate_to_datetime(s)
        except (TypeError, ValueError):
            return None
    return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)


def parse_feed(raw: bytes) -> list[dict]:
    """Entradas de un feed Atom o RSS 2.0: título, enlace, fecha y texto."""
    root = ET.fromstring(raw)
    out = []
    atom = "{http://www.w3.org/2005/Atom}"
    if root.tag == atom + "feed":
        for e in root.iter(atom + "entry"):
            link = ""
            for l in e.findall(atom + "link"):
                if l.get("rel", "alternate") == "alternate":
                    link = l.get("href", "")
                    break
            text = e.findtext(atom + "content") or e.findtext(atom + "summary") or ""
            out.append({
                "title": (e.findtext(atom + "title") or "").strip(),
                "link": link,
                "date": parse_date(e.findtext(atom + "published") or e.findtext(atom + "updated")),
                "text": strip_html(text),
            })
    else:
        content = "{http://purl.org/rss/1.0/modules/content/}encoded"
        for e in root.iter("item"):
            text = e.findtext(content) or e.findtext("description") or ""
            out.append({
                "title": (e.findtext("title") or "").strip(),
                "link": (e.findtext("link") or "").strip(),
                "date": parse_date(e.findtext("pubDate")),
                "text": strip_html(text),
            })
    return out


def release_score(title: str, text: str) -> int:
    """Una versión nueva menor o mayor pesa más que un parche; si sus notas
    hablan de seguridad, más todavía."""
    score = 1
    m = re.search(r"(\d+)\.(\d+)(?:\.(\d+))?", title)
    if m and (m.group(3) in (None, "0")):
        score = 2
    if re.search(r"\b(security|CVE-\d{4}-\d+|vulnerab)", f"{title} {text}", re.I):
        score += 2
    return score


def collect_feeds(sources: dict, since: dt.datetime, until: dt.datetime) -> list[dict]:
    items = []
    for f in sources.get("feeds", []):
        try:
            entries = parse_feed(http(f["url"]))
        except Exception as e:  # una fuente caída no para el resumen
            log("fuente sin leer:", f["name"], e)
            continue
        fresh = [x for x in entries if x["date"] and since <= x["date"] <= until and x["link"].startswith("https://")]
        if f["kind"] == "release":
            # Solo versiones de verdad: con número y sin ser previas.
            fresh = [x for x in fresh if re.search(r"\d", x["title"]) and not PRERELEASE.search(x["title"])]
            if not fresh:
                continue
            fresh.sort(key=lambda x: x["date"], reverse=True)
            top = fresh[0]
            # Si hubo varias versiones en la semana, el modelo lo sabe.
            others = ", ".join(x["title"] for x in fresh[1:4])
            text = top["text"] + (f" (Otras versiones de la semana: {others}.)" if others else "")
            items.append(item("release", f, top["title"], top["link"], top["date"], text,
                              max(release_score(x["title"], x["text"]) for x in fresh)))
        else:
            fresh.sort(key=lambda x: x["date"], reverse=True)
            for x in fresh[:3]:
                items.append(item("news", f, x["title"], x["link"], x["date"], x["text"], 1))
    return items


def item(kind, src, title, link, date, text, score, cve=None, severity=None):
    return {
        "kind": kind, "source": src["name"], "unit": src["unit"], "tech": src["tech"],
        "title": title, "link": link, "date": date.isoformat() if hasattr(date, "isoformat") else date,
        "text": text[:2500], "score": score, "cve": cve, "severity": severity,
    }


# --------------------------------------------------------------------------
# Vulnerabilidades
# --------------------------------------------------------------------------

def collect_security(sources: dict, since: dt.datetime, until: dt.datetime) -> list[dict]:
    found: dict[str, dict] = {}

    def add(it: dict):
        key = it["cve"] or it["link"]
        old = found.get(key)
        if not old or it["score"] > old["score"]:
            found[key] = it

    kev = None
    for s in sources.get("security", []):
        for phrase in s.get("nvd", []):
            q = urllib.parse.urlencode({
                "keywordSearch": phrase,
                "pubStartDate": since.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                "pubEndDate": until.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            }) + "&keywordExactMatch"
            try:
                data = http_json("https://services.nvd.nist.gov/rest/json/cves/2.0?" + q, timeout=60)
            except Exception as e:
                log("NVD sin leer:", phrase, e)
                data = {}
            for v in data.get("vulnerabilities", []):
                c = v["cve"]
                desc = next((d["value"] for d in c.get("descriptions", []) if d["lang"] == "en"), "")
                sev = None
                for k in ("cvssMetricV40", "cvssMetricV31", "cvssMetricV30"):
                    if c.get("metrics", {}).get(k):
                        sev = c["metrics"][k][0]["cvssData"].get("baseSeverity")
                        break
                score = 3 + (1 if sev in ("HIGH", "CRITICAL") else 0)
                add(item("security", s, f"{c['id']} en {s['name']}", f"https://nvd.nist.gov/vuln/detail/{c['id']}",
                         parse_date(c.get("published")) or until, desc, score, c["id"], sev))
            # NVD sin clave: 5 peticiones cada 30 segundos.
            time.sleep(6.5)
        for pkg in s.get("ghsa", []):
            q = urllib.parse.urlencode({
                "affects": pkg, "per_page": 20,
                "published": f"{since.date().isoformat()}..{until.date().isoformat()}",
            })
            try:
                data = http_json("https://api.github.com/advisories?" + q,
                                 headers={"Accept": "application/vnd.github+json"})
            except Exception as e:
                log("GitHub Advisories sin leer:", pkg, e)
                data = []
            for a in data:
                sev = (a.get("severity") or "").upper() or None
                score = 3 + (1 if sev in ("HIGH", "CRITICAL") else 0)
                title = f"{a.get('cve_id') or a['ghsa_id']} en {s['name']}"
                add(item("security", s, title, a["html_url"], parse_date(a.get("published_at")) or until,
                         f"{a.get('summary', '')}. {a.get('description', '')}", score, a.get("cve_id"), sev))
        if s.get("kev"):
            if kev is None:
                try:
                    kev = http_json("https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json", timeout=90)
                except Exception as e:
                    log("CISA KEV sin leer:", e)
                    kev = {}
            for v in kev.get("vulnerabilities", []):
                added = parse_date(v.get("dateAdded") + "T12:00:00+00:00") if v.get("dateAdded") else None
                name = f"{v.get('vendorProject', '')} {v.get('product', '')}".lower()
                if added and since <= added <= until and any(k in name for k in s["kev"]):
                    text = (f"Se está explotando activamente (catálogo KEV de CISA). {v.get('vulnerabilityName', '')}. "
                            f"{v.get('shortDescription', '')} Acción indicada: {v.get('requiredAction', '')}")
                    add(item("security", s, f"{v['cveID']} en {s['name']}, ya explotada",
                             f"https://nvd.nist.gov/vuln/detail/{v['cveID']}", added, text, 5, v["cveID"], "KEV"))
    return group_security(list(found.values()))


def group_security(items: list[dict]) -> list[dict]:
    """Varias vulnerabilidades del mismo producto en la semana van en una sola
    novedad: el resumen no es una lista de CVE."""
    by: dict[str, list[dict]] = {}
    for it in items:
        by.setdefault(it["source"], []).append(it)
    out = []
    for name, group in by.items():
        group.sort(key=lambda i: i["score"], reverse=True)
        if len(group) == 1:
            out.append(group[0])
            continue
        top = dict(group[0])
        ids = [g["cve"] or g["link"].rsplit("/", 1)[-1] for g in group]
        top["title"] = f"{len(group)} vulnerabilidades en {name} ({', '.join(ids[:4])}{'…' if len(ids) > 4 else ''})"
        top["text"] = " ".join(f"[{i}] {g['text'][:700]}" for i, g in zip(ids, group))[:2500]
        top["cves"] = ids
        out.append(top)
    return out


def pick(items: list[dict], n: int = MAX_CANDIDATES) -> list[dict]:
    """Las más importantes primero, sin que una pieza se lleve todo el resumen."""
    items = sorted(items, key=lambda i: (i["score"], i["date"]), reverse=True)
    out, per_unit, per_kind = [], {}, {}
    for i in items:
        if per_unit.get(i["unit"], 0) >= MAX_PER_UNIT or per_kind.get(i["kind"], 0) >= QUOTA[i["kind"]]:
            continue
        per_unit[i["unit"]] = per_unit.get(i["unit"], 0) + 1
        per_kind[i["kind"]] = per_kind.get(i["kind"], 0) + 1
        out.append(i)
        if len(out) == n:
            break
    return out


# --------------------------------------------------------------------------
# Modelo local
# --------------------------------------------------------------------------

SYSTEM = """Escribes el resumen semanal del blog de Tito, administrador de sistemas, sobre novedades que afectan a su homelab. Respondes solo con el JSON pedido, en español de España y en inglés británico.

Su homelab: un servidor Proxmox VE (Debian) con contenedores LXC y Docker, todo Linux; un router MikroTik; un PC de escritorio con GPU para el modelo local. No hay Windows ni macOS en el servidor.

Reglas:
- Usa solo lo que dice la novedad. No inventes versiones, cifras, fechas ni funciones.
- "what": qué ha salido o qué se ha descubierto, en una o dos frases claras.
- "means": por qué importa para esa pieza en un homelab como el suyo. NUNCA digas si su servidor está actualizado, parcheado, expuesto o es vulnerable: no lo sabes. Habla de la pieza, no del estado de su servidor.
- "idea": una acción concreta que merezca la pena (probar una función nueva, revisar una opción, leer las notas antes de actualizar). Cadena vacía si no hay ninguna. En vulnerabilidades, la idea es general: qué versión lo corrige o qué opción lo mitiga. Nunca digas que Tito tiene algo pendiente, que va a actualizar o que tiene que revisar su versión.
- Sé concreto con la pieza: nada de frases de relleno como "dado que gestiono mis servicios con contenedores".
- "title": titular corto (máximo 90 caracteres), sin clickbait y sin emojis.
- "keep": false si la novedad no aporta nada (un parche menor sin cambios notables, una noticia que no tiene que ver con un homelab) o si es de una plataforma que no usa (por ejemplo, una vulnerabilidad solo de Windows).
- Tono directo y en primera persona cuando hable Tito ("en mi caso", "lo pruebo"), sin exagerar."""

ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "keep": {"type": "boolean"},
        "es": {"type": "object", "properties": {k: {"type": "string"} for k in ("title", "what", "means", "idea")},
               "required": ["title", "what", "means", "idea"]},
        "en": {"type": "object", "properties": {k: {"type": "string"} for k in ("title", "what", "means", "idea")},
               "required": ["title", "what", "means", "idea"]},
    },
    "required": ["keep", "es", "en"],
}

INTRO_SCHEMA = {
    "type": "object",
    "properties": {
        "es": {"type": "object", "properties": {"summary": {"type": "string"}, "lesson": {"type": "string"}},
               "required": ["summary", "lesson"]},
        "en": {"type": "object", "properties": {"summary": {"type": "string"}, "lesson": {"type": "string"}},
               "required": ["summary", "lesson"]},
    },
    "required": ["es", "en"],
}

# En una vulnerabilidad, nada en primera persona: lo público habla de la
# pieza, nunca de lo que tengo instalado o pendiente.
FIRST_PERSON = re.compile(r"\b(mi|mis|m[ií]o|utilizo|uso|tengo|instalad[ao]|my|mine|i use|i run|installed)\b", re.I)

SECURITY_RULES = """Esta novedad es una VULNERABILIDAD. Reglas extra:
- "means": qué podría hacer un atacante y qué parte de un homelab como este toca, en tercera persona. Nada de "mi", "utilizo", "tengo" ni "la versión instalada".
- "idea": solo qué versión lo corrige u qué opción lo mitiga, si lo dice el texto ("Lo corrige la 4.14.8."). Si no lo dice, cadena vacía.
- No menciones productos que no estén en el texto como si los usara."""

# Lo que el modelo no puede afirmar: el estado real de mi servidor.
STATUS_CLAIM = re.compile(
    r"(ya (lo )?(tengo|he|est[aá]) (actualizad|parchead)|mi servidor (est[aá]|es) (vulnerable|expuest|parchead|actualizad)"
    r"|no (me )?afecta|estoy a salvo|already (patched|updated|upgraded)|my server is (vulnerable|exposed|patched|safe)"
    r"|i'?m (safe|not affected)|doesn'?t affect me"
    r"|(planificar|programar|tengo que|toca|pendiente[s]? de) (la )?actualiza|componentes afectados|actualizar mi |revisar (la versi[oó]n de )?mi "
    r"|(plan|schedule|need) (to )?(the )?(update|upgrade)|affected components|update my |check my (current )?version)", re.I)


class ModelDown(Exception):
    pass


def ollama(cfg: Config, messages: list[dict], schema: dict) -> dict:
    body = json.dumps({
        "model": cfg.model, "messages": messages, "stream": False, "think": False,
        "format": schema, "options": {"temperature": 0.2, "num_ctx": 8192},
    }).encode()
    try:
        raw = http(cfg.ollama + "/api/chat", data=body, headers={"Content-Type": "application/json"},
                   timeout=300, tries=1)
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
        raise ModelDown(f"Ollama: {e}") from e
    return json.loads(json.loads(raw)["message"]["content"])


def gemini_schema(schema: dict) -> dict:
    """El esquema de respuesta de Gemini es el de OpenAPI: tipos en mayúsculas."""
    out = {k: v for k, v in schema.items() if k not in ("type", "properties")}
    out["type"] = schema["type"].upper()
    if "properties" in schema:
        out["properties"] = {k: gemini_schema(v) for k, v in schema["properties"].items()}
    return out


def gemini(cfg: Config, messages: list[dict], schema: dict) -> dict:
    system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
    contents = [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
                for m in messages if m["role"] != "system"]
    body = json.dumps({
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": contents,
        "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json",
                             "responseSchema": gemini_schema(schema)},
    }).encode()
    errors = []
    for model in cfg.gemini_models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        try:
            raw = http(url, data=body, headers={"Content-Type": "application/json", "x-goog-api-key": cfg.gemini_key},
                       timeout=120, tries=3)
            break
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            # Sin el cuerpo de la respuesta: la clave va en cabecera y no se repite.
            errors.append(f"{model}: {getattr(e, 'code', '')} {getattr(e, 'reason', e)}")
    else:
        raise ModelDown("Gemini: " + "; ".join(errors))
    r = json.loads(raw)
    text = "".join(p.get("text", "") for p in r["candidates"][0]["content"]["parts"])
    return json.loads(text)


def llm(cfg: Config, messages: list[dict], schema: dict) -> dict:
    """Gemini si hay clave; si falla o no la hay, el modelo local."""
    errors = []
    if cfg.gemini_key:
        try:
            return gemini(cfg, messages, schema)
        except (ModelDown, KeyError, IndexError, json.JSONDecodeError) as e:
            log("Gemini no ha servido, pruebo el modelo local:", e)
            errors.append(str(e))
    try:
        return ollama(cfg, messages, schema)
    except ModelDown as e:
        errors.append(str(e))
        raise ModelDown("; ".join(errors)) from e


def unit_context(repo: Path, unit: str) -> dict:
    """Qué es esa pieza, sacado de su unidad del rack (para que el modelo sepa
    de qué habla sin inventarlo)."""
    try:
        u = tomllib.loads((repo / "content/units" / f"{unit}.toml").read_text())
        return {lang: u["text"][lang]["hero"]["tagline"] for lang in ("es", "en")}
    except (OSError, KeyError, tomllib.TOMLDecodeError):
        return {"es": unit, "en": unit}


def clean(s: str, limit: int) -> str:
    s = re.sub(r"\s+", " ", (s or "")).strip()
    if len(s) <= limit:
        return s
    cut = s[:limit].rsplit(" ", 1)[0].rstrip(",;:")
    return cut + "…"


def write_item(cfg: Config, it: dict) -> dict | None:
    ctx = unit_context(cfg.repo, it["unit"])
    prompt = {
        "tipo": {"release": "versión nueva", "security": "vulnerabilidad", "news": "noticia"}[it["kind"]],
        "fuente": it["source"], "titulo_original": it["title"], "fecha": it["date"][:10],
        "gravedad": it["severity"], "texto": it["text"],
        "pieza_de_su_servidor": ctx["es"],
    }
    security = it["kind"] == "security"
    system = SYSTEM + ("\n\n" + SECURITY_RULES if security else "")
    msgs = [{"role": "system", "content": system},
            {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)}]
    for attempt in range(2):
        out = llm(cfg, msgs, ITEM_SCHEMA)
        if not out.get("keep"):
            return None
        text = " ".join(out[l][k] for l in ("es", "en") for k in ("what", "means", "idea"))
        if not STATUS_CLAIM.search(text) and not (security and FIRST_PERSON.search(text)):
            break
        msgs.append({"role": "assistant", "content": json.dumps(out, ensure_ascii=False)})
        msgs.append({"role": "user", "content": "Has afirmado algo sobre el estado de su servidor (si está actualizado, expuesto o le afecta) o has hablado en primera persona de una vulnerabilidad. Reescríbelo hablando solo de la pieza, en tercera persona."})
    else:
        log("descartada por afirmar el estado del servidor:", it["title"])
        return None
    for lang in ("es", "en"):
        o = out[lang]
        o["title"] = clean(o["title"], 90)
        o["what"] = clean(o["what"], 420)
        o["means"] = clean(o["means"], 420)
        o["idea"] = clean(o["idea"], 300)
        if not (o["title"] and o["what"] and o["means"]):
            return None
    return {**it, "es": out["es"], "en": out["en"]}


def write_intro(cfg: Config, items: list[dict]) -> dict:
    lines = [f"- {i['es']['title']}: {i['es']['what']}" for i in items]
    msgs = [{"role": "system", "content": SYSTEM},
            {"role": "user", "content": "Novedades de esta semana:\n" + "\n".join(lines) +
             "\n\nEscribe 'summary' (entradilla de dos frases que diga lo más importante de la semana) y "
             "'lesson' (una frase con una enseñanza general de la semana; nunca sobre actualizaciones o revisiones pendientes de su servidor). En los dos idiomas."}]
    out = llm(cfg, msgs, INTRO_SCHEMA)
    if STATUS_CLAIM.search(" ".join(out[l][k] for l in ("es", "en") for k in ("summary", "lesson"))):
        msgs.append({"role": "assistant", "content": json.dumps(out, ensure_ascii=False)})
        msgs.append({"role": "user", "content": "No hables de actualizaciones o revisiones pendientes de su servidor: reescribe la entradilla y la lección en general."})
        out = llm(cfg, msgs, INTRO_SCHEMA)
        if STATUS_CLAIM.search(" ".join(out[l][k] for l in ("es", "en") for k in ("summary", "lesson"))):
            for lang, txt in (("es", "Lo importante de la semana, pieza a pieza: lo que cambia y dónde mirar."), ("en", "The week's news, piece by piece: what changes and where to look.")):
                out[lang]["lesson"] = txt
    for lang in ("es", "en"):
        out[lang]["summary"] = clean(out[lang]["summary"], 360)
        out[lang]["lesson"] = clean(out[lang]["lesson"], 260)
    return out


# --------------------------------------------------------------------------
# Artículo
# --------------------------------------------------------------------------

def q(s: str) -> str:
    """Cadena TOML básica (el escape de JSON también es TOML válido)."""
    return json.dumps(s, ensure_ascii=False)


def date_label(d: dt.date, lang: str) -> str:
    return f"{d.day} de {MONTHS_ES[d.month - 1]}" if lang == "es" else f"{d.day} {MONTHS_EN[d.month - 1]}"


def description(items: list[dict], lang: str) -> str:
    head = "Novedades de la semana para mi homelab: " if lang == "es" else "This week's news for my homelab: "
    names = []
    for i in items:
        if i["source"] not in names:
            names.append(i["source"])
    return clean(head + ", ".join(names) + ".", 170)


def build_article(monday: dt.date, items: list[dict], intro: dict, valid_tech: set[str]) -> str:
    tech = []
    for i in items:
        for t in i["tech"]:
            if t in valid_tech and t not in tech:
                tech.append(t)
    sec_label = {"es": "Seguridad", "en": "Security"}
    out = [
        f'slug = "resumen-{monday.isoformat()}"',
        f'date = "{monday.isoformat()}"',
        f'unit = "{items[0]["unit"]}"',
        f"tech = [{', '.join(q(t) for t in tech)}]",
        'kind = "digest"',
        "",
    ]
    for lang in ("es", "en"):
        lead = "Resumen del lunes" if lang == "es" else "Monday digest,"
        title = f"{lead} {date_label(monday, lang)}: {items[0][lang]['title']}"
        out += [
            f"[text.{lang}]",
            f"title = {q(title)}",
            f"description = {q(description(items, lang))}",
            f"summary = {q(intro[lang]['summary'])}",
            f"lesson = {q(intro[lang]['lesson'])}",
            "",
        ]
        for i in items:
            t = i[lang]
            heading = f"{sec_label[lang]} · {t['title']}" if i["kind"] == "security" else t["title"]
            if i["kind"] == "security":
                mine = "Por qué importa: " if lang == "es" else "Why it matters: "
            else:
                mine = "En mi servidor: " if lang == "es" else "On my server: "
            idea = "Idea: " if lang == "es" else "Idea: "
            out += [
                f"[[text.{lang}.sections]]",
                f"heading = {q(heading)}",
                f"paragraphs = [{q(t['what'])}, {q(mine + t['means'])}]",
            ]
            if t["idea"]:
                out.append(f"list = [{q(idea + t['idea'])}]")
            out.append(f"links = [{{ title = {q(i['title'])}, url = {q(i['link'])}, source = {q(i['source'])} }}]")
            out.append("")
    return "\n".join(out).rstrip() + "\n"


def valid_tech_ids(repo: Path) -> set[str]:
    site = tomllib.loads((repo / "content/site.toml").read_text())
    return {t["id"] for t in site["tech"]}


# --------------------------------------------------------------------------
# Matrix
# --------------------------------------------------------------------------

def mx(cfg: Config, method: str, path: str, body: dict | None = None) -> dict:
    url = cfg.matrix_homeserver + "/_matrix/client/v3" + path
    data = json.dumps(body).encode() if body is not None else None
    return http_json(url, data=data, method=method, headers={
        "Authorization": f"Bearer {cfg.matrix_token}", "Content-Type": "application/json"})


def room(cfg: Config) -> str:
    return urllib.parse.quote(cfg.matrix_room, safe="")


def mx_send(cfg: Config, text: str, html_body: str | None = None) -> str:
    body = {"msgtype": "m.text", "body": text}
    if html_body:
        body |= {"format": "org.matrix.custom.html", "formatted_body": html_body}
    r = mx(cfg, "PUT", f"/rooms/{room(cfg)}/send/m.room.message/{uuid.uuid4()}", body)
    return r["event_id"]


def mx_replies(cfg: Config, event_id: str) -> list[dict]:
    """Mensajes del dueño en la sala después del borrador, del más antiguo al
    más reciente."""
    ctx = mx(cfg, "GET", f"/rooms/{room(cfg)}/context/{urllib.parse.quote(event_id, safe='')}?limit=0")
    token, out = ctx["end"], []
    for _ in range(10):
        r = mx(cfg, "GET", f"/rooms/{room(cfg)}/messages?dir=f&limit=100&from={urllib.parse.quote(token)}")
        for ev in r.get("chunk", []):
            if ev.get("type") == "m.room.message" and ev.get("sender") == cfg.owner:
                out.append({"event_id": ev["event_id"], "body": ev.get("content", {}).get("body", "")})
        if not r.get("chunk") or not r.get("end") or r["end"] == token:
            break
        token = r["end"]
    return out


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def parse_command(body: str) -> tuple[str, list[int]] | None:
    """«publicar», «descartar», «quitar 2,4». Ignora las líneas citadas de una
    respuesta («> …») y lo que no sea una orden."""
    lines = [l for l in body.splitlines() if l.strip() and not l.lstrip().startswith(">")]
    if not lines:
        return None
    t = norm(lines[0]).strip(" .!¡")
    if re.fullmatch(r"(publicar|publicalo|publica|ok|vale|si|adelante)", t):
        return ("publish", [])
    if re.fullmatch(r"(descartar|descartalo|descarta|no)", t):
        return ("discard", [])
    m = re.fullmatch(r"quita(?:r)?(?: la| las| el| los)?\s+([\d ,y]+)", t)
    if m:
        nums = sorted({int(n) for n in re.findall(r"\d+", m.group(1))})
        return ("remove", nums) if nums else None
    return None


def draft_message(monday: dt.date, items: list[dict], intro: dict) -> tuple[str, str]:
    head = f"📰 Borrador del resumen del lunes {date_label(monday, 'es')} ({len(items)} novedades)"
    plain, rich = [head, "", intro["es"]["summary"], ""], [f"<p><strong>{html.escape(head)}</strong></p>",
                                                          f"<p>{html.escape(intro['es']['summary'])}</p><ol>"]
    for n, i in enumerate(items, 1):
        t = i["es"]
        tag = "[Seguridad] " if i["kind"] == "security" else ""
        mine = "Por qué importa" if i["kind"] == "security" else "En mi servidor"
        plain += [f"{n}. {tag}{t['title']}", f"   {t['what']}", f"   {mine}: {t['means']}"]
        if i["kind"] == "security":
            plain.append("   🔒 Solo para ti (no se publica): comprueba la versión que tienes antes de aprobar.")
        if t["idea"]:
            plain.append(f"   Idea: {t['idea']}")
        plain += [f"   {i['link']}", ""]
        rich.append(
            f"<li><strong>{html.escape(tag + t['title'])}</strong><br>{html.escape(t['what'])}<br>"
            f"<em>{'Por qué importa' if i['kind'] == 'security' else 'En mi servidor'}:</em> {html.escape(t['means'])}"
            + ("<br>🔒 <em>Solo para ti (no se publica): comprueba la versión que tienes antes de aprobar.</em>" if i["kind"] == "security" else "")
            + (f"<br><em>Idea:</em> {html.escape(t['idea'])}" if t["idea"] else "")
            + f"<br><a href=\"{html.escape(i['link'])}\">{html.escape(i['source'])}</a></li>")
    foot = ("Responde «publicar» para que salga el lunes a las 8:00 (o ya, si es más tarde), "
            "«quitar 2» o «quitar 2,4» para sacar alguna, o «descartar». Sin respuesta no se publica.")
    plain.append(foot)
    rich.append(f"</ol><p>{html.escape(foot)}</p>")
    return "\n".join(plain), "".join(rich)


# --------------------------------------------------------------------------
# Estado
# --------------------------------------------------------------------------

def state_path(cfg: Config, monday: dt.date) -> Path:
    return cfg.state / f"{monday.isoformat()}.json"


def load_state(cfg: Config, monday: dt.date) -> dict | None:
    p = state_path(cfg, monday)
    return json.loads(p.read_text()) if p.exists() else None


def save_state(cfg: Config, st: dict):
    cfg.state.mkdir(parents=True, exist_ok=True)
    p = state_path(cfg, dt.date.fromisoformat(st["monday"]))
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, ensure_ascii=False, indent=1))
    tmp.replace(p)


def target_monday(now: dt.datetime) -> dt.date | None:
    """El lunes del resumen que toca preparar ahora: de domingo a las 20:00 a
    lunes a las 8:00."""
    if now.weekday() == 6 and now.hour >= 20:
        return now.date() + dt.timedelta(days=1)
    if now.weekday() == 0 and now.hour < 8:
        return now.date()
    return None


def publish_at(monday: dt.date) -> dt.datetime:
    return dt.datetime.combine(monday, dt.time(8, 0), MADRID)


def expires_at(monday: dt.date) -> dt.datetime:
    return dt.datetime.combine(monday + dt.timedelta(days=1), dt.time(20, 0), MADRID)


# --------------------------------------------------------------------------
# Repositorio y despliegue
# --------------------------------------------------------------------------

def run(cmd: list[str], cwd: Path, env: dict | None = None, timeout: int = 1800) -> str:
    log("$", " ".join(cmd))
    r = subprocess.run(cmd, cwd=cwd, env={**os.environ, **(env or {})}, capture_output=True,
                       text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)} → {r.returncode}\n{(r.stdout + r.stderr)[-1500:]}")
    return r.stdout


def build_env(cfg: Config) -> dict:
    return {"PATH": f"{cfg.cargo_path}:{os.environ.get('PATH', '')}", "SQLX_OFFLINE": "true", "LC_ALL": "C.UTF-8"}


def fresh_repo(cfg: Config):
    """El clon propio del resumen, igual que origin/main. Así nunca pisa la
    copia de trabajo de nadie."""
    if not cfg.remote:
        raise RuntimeError("falta DIGEST_REMOTE (el origen del repositorio)")
    if not (cfg.repo / ".git").exists():
        cfg.repo.parent.mkdir(parents=True, exist_ok=True)
        run(["git", "clone", "-q", cfg.remote, str(cfg.repo)], cfg.repo.parent)
    run(["git", "fetch", "-q", "origin"], cfg.repo)
    run(["git", "checkout", "-q", "main"], cfg.repo)
    run(["git", "reset", "-q", "--hard", "origin/main"], cfg.repo)


def check_article(cfg: Config, toml_text: str, slug: str) -> None:
    """Valida el borrador con las mismas reglas que la web (landing
    check-article), compilando el clon si hace falta."""
    binary = cfg.repo / "target/release/landing"
    run(["cargo", "build", "--release", "-q"], cfg.repo, build_env(cfg))
    tmp = cfg.state / f"{slug}.toml"
    cfg.state.mkdir(parents=True, exist_ok=True)
    tmp.write_text(toml_text)
    run([str(binary), "check-article", str(tmp)], cfg.repo, build_env(cfg))


def publish(cfg: Config, st: dict) -> str:
    monday = dt.date.fromisoformat(st["monday"])
    slug = f"resumen-{monday.isoformat()}"
    fresh_repo(cfg)
    path = cfg.repo / "content/articles" / f"{slug}.toml"
    # Un intento anterior ya lo empujó (y se quedó esperando al despliegue):
    # no hay nada que commitear, solo volver a esperar a verlo en la web.
    if not (path.exists() and path.read_text() == st["toml"]):
        push_article(cfg, st, monday, path)
    return wait_published(slug)


def push_article(cfg: Config, st: dict, monday: dt.date, path: Path) -> None:
    path.write_text(st["toml"])
    env = build_env(cfg)
    run(["cargo", "build", "--release", "-q"], cfg.repo, env)
    run([str(cfg.repo / "target/release/landing"), "check"], cfg.repo, env)
    if Path(cfg.gitleaks).exists():
        run([cfg.gitleaks, "dir", "--no-banner", "-l", "warn", str(path)], cfg.repo)
    run(["git", "add", str(path)], cfg.repo)
    msg = (f"feat(blog): resumen semanal del lunes {date_label(monday, 'es')}\n\n"
           f"{len(st['items'])} novedades de la semana para el homelab: "
           + ", ".join(i["source"] for i in st["items"]) + ".\n"
           "Escrito por tools/digest y aprobado en Matrix.")
    run(["git", *PUBLIC_AUTHOR, "commit", "-q", "-m", msg], cfg.repo)
    try:
        run(["git", "push", "-q", "origin", "HEAD:main"], cfg.repo)
    except RuntimeError:
        run(["git", "pull", "-q", "--rebase", "origin", "main"], cfg.repo)
        run(["git", "push", "-q", "origin", "HEAD:main"], cfg.repo)


def wait_published(slug: str) -> str:
    """El push dispara el CI y, si sale verde, el despliegue continuo (que
    también actualiza la copia pública). Aquí solo se espera a verlo."""
    url = f"{PUBLIC_URL}/es/blog/{slug}/"
    deadline = time.monotonic() + PUBLISH_WAIT
    while time.monotonic() < deadline:
        try:
            http(url, tries=1)
            return url
        except Exception:
            time.sleep(30)
    raise RuntimeError(f"empujado, pero {url} no responde tras {PUBLISH_WAIT // 60} min: mirar el CI")


# --------------------------------------------------------------------------
# Órdenes
# --------------------------------------------------------------------------

def gather(cfg: Config, monday: dt.date, now: dt.datetime) -> list[dict]:
    sources = tomllib.loads(cfg.sources.read_text())
    since = dt.datetime.combine(monday - dt.timedelta(days=7), dt.time(0, 0), MADRID)
    items = collect_security(sources, since, now) + collect_feeds(sources, since, now)
    return pick(items)


def make_draft(cfg: Config, monday: dt.date, now: dt.datetime) -> dict:
    candidates = gather(cfg, monday, now)
    log(f"{len(candidates)} candidatas")
    written = []
    for it in candidates:
        w = write_item(cfg, it)
        if w:
            written.append(w)
        if len(written) == MAX_ITEMS:
            break
    st = {"monday": monday.isoformat(), "created": now.isoformat(), "items": written}
    if not written:
        st["status"] = "empty"
        return st
    st["intro"] = write_intro(cfg, written)
    st["toml"] = build_article(monday, written, st["intro"], valid_tech_ids(cfg.repo))
    st["status"] = "drafted"
    return st


def send_draft(cfg: Config, st: dict):
    monday = dt.date.fromisoformat(st["monday"])
    text, rich = draft_message(monday, st["items"], st["intro"])
    st["draft_event"] = mx_send(cfg, text, rich)


def rebuild(cfg: Config, st: dict):
    monday = dt.date.fromisoformat(st["monday"])
    st["intro"] = write_intro(cfg, st["items"])
    st["toml"] = build_article(monday, st["items"], st["intro"], valid_tech_ids(cfg.repo))
    check_article(cfg, st["toml"], f"resumen-{monday.isoformat()}")


def tick(cfg: Config, now: dt.datetime):
    # Preparar el borrador que toca.
    monday = target_monday(now)
    if monday and not load_state(cfg, monday):
        try:
            fresh_repo(cfg)
            st = make_draft(cfg, monday, now)
            if st["status"] == "drafted":
                check_article(cfg, st["toml"], f"resumen-{monday.isoformat()}")
                send_draft(cfg, st)
            else:
                mx_send(cfg, f"📰 Esta semana no hay novedades que merezcan el resumen del lunes {date_label(monday, 'es')}.")
            save_state(cfg, st)
        except ModelDown as e:
            log("el modelo no responde, se reintenta en el próximo tick:", e)
            if now.weekday() == 0 and now.hour == 7 and now.minute >= 45:
                mx_send(cfg, f"📰 No pude preparar el resumen del lunes {date_label(monday, 'es')}: ningún modelo responde ({str(e)[:200]}).")
                save_state(cfg, {"monday": monday.isoformat(), "status": "failed", "items": [], "error": str(e)})

    # Respuestas, publicación y caducidad de los borradores abiertos.
    for p in sorted(cfg.state.glob("*.json")) if cfg.state.exists() else []:
        st = json.loads(p.read_text())
        monday = dt.date.fromisoformat(st["monday"])
        if st["status"] == "drafted":
            for r in mx_replies(cfg, st["draft_event"]):
                if r["event_id"] in st.get("seen", []):
                    continue
                st.setdefault("seen", []).append(r["event_id"])
                cmd = parse_command(r["body"])
                if not cmd:
                    continue
                if cmd[0] == "publish":
                    st["status"] = "approved"
                    when = publish_at(monday)
                    mx_send(cfg, "👍 Aprobado. Sale " + ("ahora mismo." if now >= when else "el lunes a las 8:00."))
                    break
                if cmd[0] == "discard":
                    st["status"] = "discarded"
                    mx_send(cfg, "🗑️ Descartado: esta semana no hay resumen.")
                    break
                if cmd[0] == "remove":
                    keep = [i for n, i in enumerate(st["items"], 1) if n not in cmd[1]]
                    if not keep:
                        st["status"] = "discarded"
                        mx_send(cfg, "🗑️ Sin novedades que publicar: descartado.")
                        break
                    st["items"] = keep
                    st["rebuild"] = True
                    break
            if st["status"] == "drafted" and st.get("rebuild"):
                try:
                    rebuild(cfg, st)
                    send_draft(cfg, st)
                    st["rebuild"] = False
                    st["seen"] = []
                except ModelDown:
                    if not st.get("rebuild_warned"):
                        mx_send(cfg, "⏳ El modelo local no responde: rehago el borrador en cuanto vuelva.")
                        st["rebuild_warned"] = True
            if st["status"] == "drafted" and now >= expires_at(monday):
                st["status"] = "expired"
                mx_send(cfg, f"⌛ El borrador del lunes {date_label(monday, 'es')} ha caducado sin respuesta: no se publica.")
        if st["status"] == "approved" and now >= publish_at(monday):
            try:
                st["url"] = publish(cfg, st)
                st["status"] = "published"
                mx_send(cfg, f"✅ Publicado: {st['url']}")
            except Exception as e:  # se reintenta en el siguiente tick, hasta tres veces
                st["attempts"] = st.get("attempts", 0) + 1
                log("no se pudo publicar:", e)
                if st["attempts"] >= 3:
                    st["status"] = "failed"
                    mx_send(cfg, f"❌ No pude publicar el resumen del lunes {date_label(monday, 'es')}:\n{str(e)[-800:]}")
        save_state(cfg, st)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("tick", help="lo que lanza el temporizador cada 15 minutos")
    c = sub.add_parser("collect", help="enseña lo recogido, sin modelo ni Matrix")
    c.add_argument("--monday", type=dt.date.fromisoformat)
    d = sub.add_parser("draft", help="prepara el borrador ya")
    d.add_argument("--monday", type=dt.date.fromisoformat)
    d.add_argument("--dry-run", action="store_true", help="escribe el artículo en la salida y no manda nada")
    a = ap.parse_args(argv)

    cfg = Config()
    now = dt.datetime.now(MADRID)
    monday = getattr(a, "monday", None) or (now.date() + dt.timedelta(days=(7 - now.weekday()) % 7 or 7))

    cfg.state.mkdir(parents=True, exist_ok=True)
    with open(cfg.state / ".lock", "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log("otro tick sigue en marcha")
            return 0
        if a.cmd == "collect":
            print(json.dumps(gather(cfg, monday, now), ensure_ascii=False, indent=1, default=str))
        elif a.cmd == "draft":
            if not a.dry_run and not cfg.matrix_ok():
                ap.error("faltan los datos de Matrix (MATRIX_* y DIGEST_OWNER)")
            if not a.dry_run:
                fresh_repo(cfg)
            st = make_draft(cfg, monday, now)
            if a.dry_run:
                print(st.get("toml") or json.dumps(st, ensure_ascii=False, indent=1))
            elif st["status"] == "drafted":
                check_article(cfg, st["toml"], f"resumen-{monday.isoformat()}")
                send_draft(cfg, st)
                save_state(cfg, st)
        else:
            if not cfg.matrix_ok():
                log("faltan los datos de Matrix: no hago nada")
                return 1
            tick(cfg, now)
    return 0


if __name__ == "__main__":
    sys.exit(main())
