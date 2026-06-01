#!/usr/bin/env python3
from __future__ import annotations
"""
auto_sync — Watcher git + filesystem pour mise à jour automatique du vault Obsidian.

DÉTECTION AUTOMATIQUE :
  Écoute les changements dans le code (git diff / inotify polling) et met à jour
  la note Obsidian correspondante sans intervention humaine.

CARTE NOTE → CHEMIN SOURCE :
  API Endpoints   → apps/api/src/modules/*/*.routes.ts
  Database Schema → packages/database/prisma/schema.prisma
  Voice Pipeline  → apps/api/src/modules/voice/*
  Sprint 1        → apps/api/ (via detection de module)
  Architecture    → packages/*, apps/*
  Dashboard       → apps/dashboard/src/*
  Context.md      → agent/scripts/*, agent/skills/*
  Journal.md      → toute tâche Hermes exécutée

USAGE:
    python auto_sync.py daemon              # Mode daemon (git poll toutes les 30s)
    python auto_sync.py diff                # Analyse git diff en une passe
    python auto_sync.py watch               # Watch filesystem avec watchdog
    python auto_sync.py update <note> [content]  # Mise à jour forcée d'une note
"""

import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

def find_sokar_root() -> Path:
    current = Path(__file__).resolve().parent
    for parent in [current] + list(current.parents):
        if (parent / "package.json").exists() and (parent / "pnpm-workspace.yaml").exists():
            return parent
    return Path(os.environ.get("SOKAR_ROOT", str(Path.home() / "Desktop" / "Sokar")))

SOKAR_ROOT = find_sokar_root()
VAULT_PATH = SOKAR_ROOT / "docs" / "obsidian"
LOG_FILE = Path.home() / ".hermes" / "logs" / "auto_sync.log"

# ── Carte : type de fichier → note Obsidian → extracteur de contenu ──

FILE_TO_NOTE_MAP: list[tuple[re.Pattern, str | None, str | None]] = [
    (re.compile(r"apps/api/src/modules/.*?\.routes\.ts"), "API Endpoints.md", "routes"),
    (re.compile(r"packages/database/prisma/schema\.prisma"), "Database Schema.md", "schema"),
    (re.compile(r"apps/api/src/modules/voice/"), "Voice Pipeline.md", "voice"),
    (re.compile(r"apps/dashboard/"), "Dashboard.md", "dashboard"),
    (re.compile(r"packages/"), "Architecture.md", "packages"),
    (re.compile(r"(?:agent|tools/hermes)/"), "Hermes Agent.md", "agent"),
    (re.compile(r"apps/api/src/modules/(\w+)/"), None, "module"),  # wildcard
]


# ── Logging ──


def log(msg: str) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    entry = f"[{ts}] {msg}"
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(entry + "\n")
    print(entry)


# ── Git diff analysis ──


def get_git_diff() -> list[dict]:
    """Retourne la liste des fichiers modifiés (staged + unstaged) avec leur statut."""
    try:
        result = subprocess.run(
            ["git", "diff", "--name-status", "HEAD"],
            capture_output=True, text=True, cwd=SOKAR_ROOT, timeout=30,
        )
        raw = result.stdout.strip()
        if not raw:
            # Maybe no commits yet → diff against empty tree
            result = subprocess.run(
                ["git", "status", "--porcelain"],
                capture_output=True, text=True, cwd=SOKAR_ROOT, timeout=30,
            )
            raw = result.stdout.strip()

        files = []
        for line in raw.split("\n"):
            line = line.strip()
            if not line:
                continue
            match = re.match(r"^([MADRCU?! ])\s+(.+)$", line)
            if match:
                status = match.group(1).strip()
                fpath = match.group(2).strip()
                files.append({"path": fpath, "status": status})
        return files
    except subprocess.TimeoutExpired:
        log("git diff timeout")
        return []
    except FileNotFoundError:
        log("git not available, falling back to filesystem scan")
        return []


def detect_note_for_file(file_path: str) -> tuple[str | None, str | None]:
    """Trouve quelle note Obsidian correspond à un fichier modifié.

    Returns:
        (note_name, extractor_type) ou (None, None) si non mappé.
    """
    for pattern, note, extractor in FILE_TO_NOTE_MAP:
        m = pattern.search(file_path)
        if m and note:
            return note, extractor
        if m and note is None and extractor == "module":
            module_name = m.group(1)
            note_name = f"{module_name.capitalize()}.md"
            return note_name, "module"
    return None, None


# ── Extractors de contenu pour chaque type de note ──


def extract_routes(file_path: str) -> str | None:
    """Extrait les routes Fastify d'un fichier .routes.ts."""
    full = SOKAR_ROOT / file_path
    if not full.is_file():
        return None
    try:
        content = full.read_text(encoding="utf-8")
    except Exception:
        return None

    routes = []
    # Fastify patterns: app.get(...), app.post(...), etc.
    for m in re.finditer(
        r'(?:app|router|server)\.(get|post|put|patch|delete|options)\s*\(\s*["\']([^"\']+)["\']',
        content,
    ):
        routes.append(f"  {m.group(1).upper():7s} {m.group(2)}")

    if not routes:
        # Fallback: export const patterns
        for m in re.finditer(r'url\s*[=:]\s*["\']([^"\']+)["\']', content):
            routes.append(f"  ?       {m.group(1)}")

    if routes:
        module_name = Path(file_path).stem.replace(".routes", "").replace(".", "")
        lines = [
            f"\n### {module_name} ({datetime.now().strftime('%Y-%m-%d')})\n",
            "```\n",
        ]
        lines.extend(r + "\n" for r in routes)
        lines.append("```\n")
        return "".join(lines)
    return None


def extract_schema(file_path: str) -> str | None:
    """Extrait les modèles Prisma d'un schema.prisma."""
    full = SOKAR_ROOT / file_path
    if not full.is_file():
        return None
    try:
        content = full.read_text(encoding="utf-8")
    except Exception:
        return None

    models = []
    current_name = None
    for line in content.split("\n"):
        if line.startswith("model "):
            current_name = line.replace("model ", "").replace("{", "").strip()
        elif line.startswith("enum "):
            current_name = line.replace("enum ", "").replace("{", "").strip()
        elif line.strip() == "}" and current_name:
            models.append(current_name)
            current_name = None

    if models:
        lines = [
            f"\n### Modèles (mis à jour {datetime.now().strftime('%Y-%m-%d %H:%M')})\n\n"
        ]
        for m in models:
            lines.append(f"- `{m}`\n")
        return "".join(lines)
    return None


def extract_voice(file_dir: str) -> str | None:
    """Liste les fichiers du module voice."""
    full = SOKAR_ROOT / file_dir
    if not full.is_dir():
        full = SOKAR_ROOT / "apps/api/src/modules/voice"
    if not full.is_dir():
        return None
    files = sorted(full.glob("*"))
    if not files:
        return None
    lines = [
        f"\n### Voice Pipeline Files ({datetime.now().strftime('%Y-%m-%d %H:%M')})\n\n"
        "| Fichier | Rôle |\n"
        "|---------|------|\n",
    ]
    for f in files:
        name = f.name
        # Try to guess role from name
        role_map = {
            "pipeline": "Orchestrateur",
            "outcome": "Détection outcome",
            "tools": "Fonctions outils",
            "prompts": "Prompts système",
            "fillers": "Fillers vocaux",
            "agent-state": "Machine d'état",
        }
        role = next((v for k, v in role_map.items() if k in name), "—")
        lines.append(f"| {name} | {role} |\n")
    return "".join(lines)


# ── Note update engine ──


def _read_note(note_name: str) -> str | None:
    """Lit une note Obsidian par nom."""
    path = VAULT_PATH / note_name
    if path.is_file():
        return path.read_text(encoding="utf-8")
    # Fuzzy search
    for f in VAULT_PATH.rglob("*.md"):
        if f.name.lower() == note_name.lower() and ".obsidian" not in str(f):
            return f.read_text(encoding="utf-8")
    return None


def _find_update_section(content: str, section_header: str) -> tuple[int, int] | None:
    """Trouve (start, end) d'une section dans le markdown."""
    pattern = re.compile(rf"^##\s+{re.escape(section_header)}\s*$", re.MULTILINE)
    m = pattern.search(content)
    if not m:
        return None
    start = m.end()
    # Find next section or end
    next_section = re.search(r"^##\s", content[start:], re.MULTILINE)
    end = start + next_section.start() if next_section else len(content)
    return (start, end)


def _ensure_section_exists(note_name: str, section_header: str) -> str:
    """Assure qu'une section existe dans la note, la crée si besoin."""
    content = _read_note(note_name)
    if content is None:
        content = f"# {note_name.replace('.md', '')}\n\n"
    bounds = _find_update_section(content, section_header)
    if bounds:
        return content
    # Append new section
    content = content.rstrip() + f"\n\n## {section_header}\n\n\n"
    path = VAULT_PATH / note_name
    path.write_text(content, encoding="utf-8")
    return content


def update_note(note_name: str, extractor_type: str, file_path: str) -> str:
    """Met à jour la note Obsidian avec les données extraites du fichier source."""
    note_path = VAULT_PATH / note_name

    # Extraire le contenu selon le type
    content_block = None
    if extractor_type == "routes":
        content_block = extract_routes(file_path)
    elif extractor_type == "schema":
        content_block = extract_schema(file_path)
    elif extractor_type == "voice":
        content_block = extract_voice(file_path)
    elif extractor_type == "dashboard":
        content_block = f"\n- Mise à jour: `{file_path}` ({datetime.now().strftime('%Y-%m-%d %H:%M')})\n"
    elif extractor_type in ("packages", "agent", "module"):
        content_block = f"\n- Modification détectée: `{file_path}` — {datetime.now().strftime('%Y-%m-%d %H:%M')}\n"

    if content_block is None:
        content_block = f"\n- Changement automatique: `{file_path}` ({datetime.now().strftime('%Y-%m-%d %H:%M')})\n"

    # Lire ou créer la note
    if note_path.is_file():
        existing = note_path.read_text(encoding="utf-8")
    else:
        existing = f"# {note_name.replace('.md', '')}\n\n## Mises à jour automatiques\n\n"
        VAULT_PATH.mkdir(parents=True, exist_ok=True)

    # Ajouter le contenu dans une section "Mises à jour automatiques"
    auto_section = "## Mises à jour automatiques"
    bounds = _find_update_section(existing, "Mises à jour automatiques")

    if bounds:
        start, end = bounds
        new_text = existing[:start].rstrip() + "\n\n" + content_block.lstrip() + "\n\n" + existing[end:].lstrip()
    else:
        # Append at end
        new_text = existing.rstrip() + f"\n\n{auto_section}\n\n{content_block}\n"

    note_path.write_text(new_text, encoding="utf-8")
    log(f"✅ Note mise à jour: {note_name} (depuis {file_path})")
    return f"Updated {note_name} from {file_path}"


def sync_all_from_git() -> list[str]:
    """Analyse git diff et met à jour toutes les notes concernées."""
    files = get_git_diff()
    if not files:
        log("Aucun changement détecté dans git diff")
        return ["no changes"]

    results = []
    for f in files:
        fpath = f["path"]
        note_name, extractor = detect_note_for_file(fpath)
        if note_name:
            try:
                result = update_note(note_name, extractor, fpath)
                results.append(result)
            except Exception as e:
                err = f"❌ Erreur mise à jour {note_name}: {e}"
                log(err)
                results.append(err)

    if not results:
        log("Changements détectés mais aucune note correspondante trouvée")
        results = [f"{len(files)} fichier(s) modifié(s), 0 note(s) mise(s) à jour"]

    return results


# ── Filesystem watching (fallback sans git) ──


def scan_filesystem() -> list[dict]:
    """Scan récursif des derniers fichiers modifiés dans les dossiers sources."""
    watched_dirs = [
        "apps/api/src/modules",
        "apps/dashboard/src",
        "packages/database/prisma",
        "tools/hermes/skills",
        "tools/hermes/scripts",
        "agent/skills",
        "agent/scripts",
    ]
    now = time.time()
    recent = []
    for rel_dir in watched_dirs:
        full = SOKAR_ROOT / rel_dir
        if not full.is_dir():
            continue
        for f in full.rglob("*"):
            if f.is_file() and f.suffix in (".ts", ".py", ".prisma", ".tsx", ".js"):
                mtime = f.stat().st_mtime
                if now - mtime < 60:  # modifié dans la dernière minute
                    recent.append({"path": str(f.relative_to(SOKAR_ROOT)), "status": "M"})
    return recent


# ── Daemon mode ──


def daemon_loop(interval: int = 30) -> None:
    """Boucle principale : vérifie git diff toutes les `interval` secondes."""
    log(f"🚀 Daemon auto_sync démarré (intervalle={interval}s)")
    log(f"   Vault : {VAULT_PATH}")
    log(f"   Root  : {SOKAR_ROOT}")

    while True:
        try:
            files = get_git_diff()
            if not files:
                # Fallback filesystem scan
                files = scan_filesystem()

            if files:
                for f in files:
                    note_name, extractor = detect_note_for_file(f["path"])
                    if note_name:
                        update_note(note_name, extractor, f["path"])
                log(f"Sync terminé: {len(files)} fichier(s) traité(s)")
            else:
                log("Sync: aucun changement")

            # Auto-update Context.md with heartbeat
            try:
                skills_path = SOKAR_ROOT / "tools" / "hermes" / "skills" / "obsidian"
                if not skills_path.exists():
                    skills_path = SOKAR_ROOT / "agent" / "skills" / "obsidian"
                sys.path.insert(0, str(skills_path))
                from auto_doc import update_context  # type: ignore

                update_context(f"[auto_sync] Daemon heartbeat — {len(files)} changement(s)")
            except ImportError:
                pass

        except KeyboardInterrupt:
            log("Daemon arrêté par utilisateur")
            break
        except Exception as e:
            log(f"Erreur dans la boucle daemon: {e}")

        time.sleep(interval)


# ── CLI entry point ──


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "daemon":
        interval = int(sys.argv[2]) if len(sys.argv) > 2 else 30
        daemon_loop(interval)
    elif cmd == "diff":
        results = sync_all_from_git()
        for r in results:
            print(r)
    elif cmd == "watch":
        log("Filesystem watch mode — fallback si watchdog non installé")
        try:
            while True:
                files = scan_filesystem()
                for f in files:
                    note_name, extractor = detect_note_for_file(f["path"])
                    if note_name:
                        update_note(note_name, extractor, f["path"])
                time.sleep(15)
        except KeyboardInterrupt:
            log("Watch arrêté")
    elif cmd == "update" and len(sys.argv) >= 3:
        note_name = sys.argv[2]
        content = sys.argv[3] if len(sys.argv) > 3 else "Mise à jour automatique"
        update_note(note_name, "manual", content)
        print(f"Note mise à jour: {note_name}")
    elif cmd == "map":
        # Affiche la carte fichier → note
        print("Carte de détection auto_sync:\n")
        for pattern, note, extractor in FILE_TO_NOTE_MAP:
            p = pattern.pattern
            n = note or f"<module_detected>.md"
            print(f"  {p:55s} → {n:25s} ({extractor})")
    else:
        print("Commandes: daemon [interval], diff, watch, update <note> [content], map")
        sys.exit(1)


if __name__ == "__main__":
    main()