#!/usr/bin/env python3
"""
Sokar voice pipeline healthcheck — Telnyx, Deepgram, Cartesia.

Runs every 30 min. Exits 0 if all OK, 1 if any provider degraded.
Stdout empty = silent (no user noise). Non-zero = alert message.

Reconstruit depuis le .pyc original (juin 2026) — même logique,
mêmes endpoints, mêmes clés Redis.
"""
import json
import os
import re
import socket
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

# ── env loading (VPS order) ────────────────────────────────────────────
def _load_env_file(path):
    """Parse KEY=VALUE lines. Returns dict. Missing file = {}."""
    out = {}
    try:
        with open(os.path.expanduser(path)) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                m = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$', line)
                if not m:
                    continue
                key, val = m.group(1), m.group(2).strip()
                if val.startswith('"') and val.endswith('"'):
                    val = val[1:-1]
                elif val.startswith("'") and val.endswith("'"):
                    val = val[1:-1]
                out[key] = val
    except OSError:
        pass
    return out


def _load_env():
    env = {}
    for path in ("~/.hermes/.env", "/opt/sokar/apps/api/.env",
                 "~/Desktop/Sokar/apps/api/.env",
                 "/etc/sokar/voice-health.env"):
        env.update(_load_env_file(path))
    env.update(os.environ)  # OS env wins (wrapper cron sets it)
    return env


# ── generic HTTP helper ────────────────────────────────────────────────
def http_check(url, headers, method="GET", body=None, timeout=10):
    """Return (status_code, body_excerpt) or ('ERR', error_msg)."""
    data = None
    if body is not None:
        data = body.encode() if isinstance(body, str) else body
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return (resp.status, resp.read(300).decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        return (e.code, e.read(200).decode("utf-8", "replace"))
    except Exception as e:
        return ("ERR", str(e))


# ── provider checks ────────────────────────────────────────────────────
def check_telnyx(env):
    # /v2/messages → 404 depuis ~juil. 2026 (endpoint changé). /v2/balance
    # retourne 200 + solde = preuve d'auth valide (fix appliqué 2026-08-09).
    code, body = http_check(
        "https://api.telnyx.com/v2/balance",
        {"Authorization": f"Bearer {env.get('TELNYX_API_KEY', '')}"},
    )
    if code == 200:
        return "OK", f"Telnyx auth valid (HTTP {code})"
    if code in (401, 403):
        return "FAIL", f"Telnyx auth rejected: HTTP {code}"
    return "DEGRADED", f"Telnyx HTTP {code}: {body[:80]}"


def check_deepgram(env):
    code, body = http_check(
        "https://api.deepgram.com/v1/projects",
        {"Authorization": f"Token {env.get('DEEPGRAM_API_KEY', '')}"},
    )
    if code == 200:
        return "OK", f"Deepgram auth valid (HTTP {code})"
    if code in (401, 403):
        return "FAIL", f"Deepgram auth rejected: HTTP {code}"
    return "DEGRADED", f"Deepgram HTTP {code}: {body[:80]}"


def check_cartesia(env):
    code, body = http_check("https://api.cartesia.ai/", {})
    if code == 200 and '"ok":true' in body:
        return "OK", "Cartesia API up"
    if code == 200:
        return "DEGRADED", "Cartesia API up but unexpected body"
    return "FAIL", f"Cartesia HTTP {code}: {body[:80]}"


# ── minimal Redis client (RESP) ────────────────────────────────────────
_REDIS_HOST = "localhost"
_REDIS_PORT = 6379


def _redis_cmd(*args):
    """Send one RESP command, return parsed reply."""
    try:
        s = socket.create_connection((_REDIS_HOST, _REDIS_PORT), timeout=5)
    except Exception as e:
        return ("ERR", f"[redis] connect fail: {e}")
    payload = "*%d\r\n" % len(args)
    for a in args:
        a = str(a).encode()
        payload += "$%d\r\n%s\r\n" % (len(a), a)
    try:
        s.sendall(payload.encode())
        buf = b""
        while True:
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
            parsed = _parse_reply(buf)
            if parsed is not None:
                s.close()
                return parsed
    except socket.timeout:
        s.close()
        return ("ERR", f"[redis] recv timeout, buf={buf[:60]!r}")
    except Exception as e:
        s.close()
        return ("ERR", f"[redis] {e}")
    s.close()
    return ("ERR", "[redis] no reply")


def _reply_complete(buf):
    """Best-effort: is the response in buf a complete RESP reply?"""
    if not buf:
        return False
    tag = buf[0:1]
    if tag in (b"+", b"-", b":") or (tag == b"$" and buf.startswith(b"$-1")):
        return b"\r\n" in buf
    if tag == b"$":
        head, _, rest = buf.partition(b"\r\n")
        try:
            n = int(head[1:])
        except ValueError:
            return False
        return len(rest) >= n + 2
    if tag == b"*":
        head, _, _ = buf.partition(b"\r\n")
        try:
            count = int(head[1:])
        except ValueError:
            return False
        return count == 0 or len(buf) > len(head)
    return False


def _parse_reply(buf):
    """Parse a single RESP reply from buf. Returns python value or None."""
    if not _reply_complete(buf):
        return None
    tag = buf[0:1]
    head, sep, rest = buf.partition(b"\r\n")
    if tag == b"+":
        return ("OK", head[1:].decode())
    if tag == b"-":
        return ("ERR", head[1:].decode())
    if tag == b":":
        return ("INT", int(head[1:]))
    if tag == b"$":
        n = int(head[1:])
        if n == -1:
            return ("NIL", None)
        body = rest[:n]
        return ("BULK", body.decode("utf-8", "replace"))
    return ("ERR", "[redis] unexpected reply")


def cache_get(key):
    return _redis_cmd("GET", key)


def cache_setex(key, ttl_seconds, value):
    return _redis_cmd("SETEX", key, int(ttl_seconds), value)


# ── Cartesia quota check (Redis-cached, ~22 credits on miss) ───────────
_CARTESIA_QUOTA_KEY = "voice:cartesia:quota_check"
_CARTESIA_VOICE_ID = "a249eaff-1e96-4d2c-b23b-12efa4f66f41"


def check_cartesia_quota(env):
    """Daily quota check, Redis-cached. Costs ~22 credits on cache miss only.

    Returns ("OK"|"FAIL"|"SKIP"|"DEGRADED", detail).
    """
    cached = cache_get(_CARTESIA_QUOTA_KEY)
    if cached and cached[0] in ("BULK", "OK") and cached[1]:
        try:
            data = json.loads(cached[1])
            age = int(time.time()) - int(data.get("ts", 0))
            age_human = f"{age // 3600}h" if age >= 3600 else f"{age // 60}m"
            detail = f"[cached {age_human}] {data.get('status')}"
            return (data.get("status", "DEGRADED"), detail)
        except Exception:
            pass

    payload = {
        "model_id": "sonic-3.5",
        "transcript": "a",
        "voice": {"mode": "id", "id": _CARTESIA_VOICE_ID},
        "output_format": {"container": "raw", "encoding": "pcm_s16le",
                          "sample_rate": 8000},
    }
    code, body = http_check(
        "https://api.cartesia.ai/tts/bytes",
        {"Authorization": f"Bearer {env.get('CARTESIA_API_KEY', '')}",
         "Cartesia-Version": "2026-03-01",
         "Content-Type": "application/json"},
        method="POST",
        body=json.dumps(payload),
    )
    if code == 200:
        cache_setex(_CARTESIA_QUOTA_KEY, 86400,
                    json.dumps({"status": "OK", "ts": int(time.time())}))
        return "OK", "synthesis OK, quota healthy"
    if code == 402:
        cache_setex(_CARTESIA_QUOTA_KEY, 14400,
                    json.dumps({"status": "FAIL", "ts": int(time.time())}))
        return "FAIL", "HTTP 402 quota_exceeded"
    if code in (401, 403):
        cache_setex(_CARTESIA_QUOTA_KEY, 3600,
                    json.dumps({"status": "FAIL", "ts": int(time.time())}))
        return "FAIL", f"Cartesia auth rejected: HTTP {code}"
    return "DEGRADED", f"Cartesia auth/quota check returned HTTP {code}: {body[:80]}"


# ── Telegram alert ─────────────────────────────────────────────────────
def send_telegram(env, msg):
    token = env.get("TELEGRAM_BOT_TOKEN", "")
    chat = env.get("TELEGRAM_ALLOWED_CHAT_ID", "")
    if not token or not chat:
        return
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        http_check(url,
                   {"Content-Type": "application/json"},
                   method="POST",
                   body=json.dumps({"chat_id": chat, "text": msg,
                                    "parse_mode": "HTML"}))
    except Exception:
        pass


# ── main ───────────────────────────────────────────────────────────────
def main():
    env = _load_env()
    checks = [
        ("Telnyx", check_telnyx(env)),
        ("Deepgram", check_deepgram(env)),
        ("Cartesia", check_cartesia(env)),
        ("Cartesia quota", check_cartesia_quota(env)),
    ]
    failures = []
    degraded = []
    skipped = []
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [f"🔴 <b>Sokar voice pipeline alert</b> — {now}"]
    for name, (status, detail) in checks:
        icon = {"OK": "✓", "FAIL": "✗", "DEGRADED": "⚠", "SKIP": "—"}.get(status, "?")
        lines.append(f"{icon} <b>{name}</b> — {detail}")
        if status == "FAIL":
            failures.append(name)
        elif status == "DEGRADED":
            degraded.append(name)
        elif status == "SKIP":
            skipped.append(name)

    if failures or degraded:
        msg = "\n".join(lines)
        send_telegram(env, msg)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
