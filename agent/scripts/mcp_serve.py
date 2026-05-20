#!/usr/bin/env python3
"""
Hermes MCP server — Sokar execution gateway.

Windsurf Cascade (kimi-k2.6) planifie uniquement.
Toute execution est deleguee a Hermes CLI (deepseek-v4-flash) via execute_task.

Le MCP serveur n'expose QU'UN SEUL outil : execute_task.
Pas de run_shell, read_file, search_files, git_status.
Cascade n'a aucun moyen de faire de l'execution via ce serveur.

AUTO-DÉTECTION : Après chaque tâche, détecte automatiquement le type d'opération
et met à jour la note Obsidian correspondante (API Endpoints, Database Schema,
Dashboard, Voice Pipeline, etc.) SANS intervention humaine.

LOGGING : Chaque tâche est loguée dans Journal.md, Context.md, et la note
Obsidian appropriée est mise à jour automatiquement.
"""

import json
import os
import re
import shlex
import subprocess
import sys
from datetime import datetime
from pathlib import Path

SOKAR_ROOT = os.environ.get("SOKAR_ROOT", str(Path.home() / "Desktop" / "Sokar"))
LOG_FILE = Path.home() / ".hermes" / "logs" / "mcp_serve.log"
SESSION_LOG = Path.home() / ".hermes" / "logs" / "cascade_hermes_bridge.md"
JOURNAL_PATH = Path(SOKAR_ROOT) / "docs" / "obsidian" / "Journal.md"

sys.path.insert(0, str(Path(SOKAR_ROOT) / "agent" / "skills" / "obsidian"))
from auto_doc import update_context, detect_module_from_task

# ── Task classification ──


def classify_task(task: str) -> dict:
    """Detecte le type d'operation a partir de la description de la tache.

    Returns:
        dict avec:
          - type: str (create_route, modify_schema, add_component, voice_pipeline,
                   queue_job, agent_config, documentation, general, etc.)
          - note: str | None (nom de la note Obsidian a mettre a jour)
          - severity: str (info, update, major)
    """
    task_lower = task.lower()

    # Classification par mots-cles
    classifiers = [
        # Routes API
        (r"(?:route|endpoint|api|rest|crud|fastify).*?(?:route|endpoint|api|crud|create|add|post|get|put|patch|delete)",
         "create_route", "API Endpoints.md", "update"),
        (r"(?:route|endpoint).*\.routes\.ts", "modify_route", "API Endpoints.md", "update"),

        # Database
        (r"(?:prisma|schema|model|migration|database|db|pgvector)",
         "modify_schema", "Database Schema.md", "major"),

        # Voice pipeline
        (r"(?:voice|call|stt|tts|deepgram|elevenlabs|cartesia|telnyx|pipeline|agent.state|filler|outcome)",
         "voice_pipeline", "Voice Pipeline.md", "update"),

        # Dashboard / UI
        (r"(?:dashboard|ui|component|next\.js|tailwind|layout|page|app router|react|frontend)",
         "add_component", "Dashboard.md", "update"),

        # Queue / workers
        (r"(?:bullmq|queue|worker|job|scheduler|evening.?report|sms)",
         "queue_job", "BullMQ Jobs.md", "update"),

        # Agent / Hermes
        (r"(?:hermes|agent|skill|mcp|config)",
         "agent_config", "Hermes Agent.md", "info"),

        # Documentation
        (r"(?:doc|readme|obsidian|context|journal|changelog|wiki)",
         "documentation", None, "info"),

        # Auth / Security
        (r"(?:auth|clerk|login|jwt|session|guard|webhook|security|rate.limit|rate_limit)",
         "security", "Security.md", "update"),

        # Analytics
        (r"(?:analytics|kpi|roi|report|metric|posthog|datadog)",
         "analytics", "Analytics.md", "update"),

        # Tests
        (r"(?:test|vitest|jest|coverage|spec|integration)",
         "testing", "Testing Strategy.md", "info"),

        # Configuration / deployment
        (r"(?:deploy|docker|railway|ci|cd|github|infra|railway\.toml|docker-compose)",
         "infrastructure", "Infrastructure.md", "update"),
    ]

    for pattern, task_type, note, severity in classifiers:
        if re.search(pattern, task_lower):
            return {
                "type": task_type,
                "note": note,
                "severity": severity,
                "label": task_type.replace("_", " ").title(),
            }

    # Fallback: use module detection
    module = detect_module_from_task(task)
    note_map = {
        "api": ("API Endpoints.md", "update"),
        "dashboard": ("Dashboard.md", "update"),
        "database": ("Database Schema.md", "update"),
        "voice": ("Voice Pipeline.md", "update"),
        "agent": ("Hermes Agent.md", "info"),
        "docs": (None, "info"),
    }
    note, severity = note_map.get(module, (None, "info"))
    return {
        "type": "general",
        "note": note,
        "severity": severity,
        "label": f"General - {module}",
    }


def update_relevant_note(task: str, result: str) -> None:
    """Met à jour la note Obsidian appropriée en fonction du type de tâche.

    Après chaque tâche Hermes :
    1) Détecte le type (route, schema, component, voice, etc.)
    2) Ajoute un timestamp + résumé dans la section "Mises à jour automatiques"
       de la note Obsidian correspondante
    3) Log dans Journal.md et Context.md (déjà fait dans tool_execute_task)
    """
    classification = classify_task(task)
    note_name = classification.get("note")
    task_type = classification.get("type")
    severity = classification.get("severity")
    label = classification.get("label")

    if not note_name:
        return  # Pas de note cible

    note_path = Path(SOKAR_ROOT) / "docs" / "obsidian" / note_name

    # Préparer l'entrée de log
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    result_short = (result.strip().split("\n")[0] if result and result.strip() else "(empty)")[:100]

    emoji = {"major": "🔴", "update": "🟡", "info": "🔵"}.get(severity, "⚪")
    entry = (
        f"\n### {emoji} {ts} — {label}\n"
        f"\n**Tâche**: {task.strip()[:120]}\n"
        f"**Résultat**: {result_short}\n"
        f"**Type**: `{task_type}` | **Severité**: {severity}\n"
        f"\n---\n"
    )

    try:
        note_path.parent.mkdir(parents=True, exist_ok=True)

        if note_path.is_file():
            content = note_path.read_text(encoding="utf-8")
        else:
            content = f"# {note_name.replace('.md', '')}\n\n## Mises à jour automatiques\n\n"
            note_path.write_text(content, encoding="utf-8")
            content = note_path.read_text(encoding="utf-8")

        # Chercher/creer section "Mises à jour automatiques"
        section_pattern = re.compile(r"^## Mises à jour automatiques\s*$", re.MULTILINE)
        match = section_pattern.search(content)

        if match:
            # Insérer après l'en-tête de section
            insert_pos = match.end()
            content = content[:insert_pos] + "\n" + entry + content[insert_pos:]
        else:
            # Ajouter la section à la fin
            content = content.rstrip() + "\n\n## Mises à jour automatiques\n" + entry + "\n"

        note_path.write_text(content, encoding="utf-8")
        log(f"update_relevant_note: {note_name} mis à jour ({task_type})")

    except Exception as e:
        log(f"update_relevant_note error: {e}")


def log_to_journal(task: str, result: str) -> None:
    """Append une ligne markdown au Journal Sokar."""
    try:
        JOURNAL_PATH.parent.mkdir(parents=True, exist_ok=True)
        date = datetime.now().strftime("%Y-%m-%d %H:%M")
        task_short = task.strip().replace("|", "/")[:60]
        summary = (result.strip().split("\n")[0] if result and result.strip() else "(empty)")[:80]
        summary = summary.replace("|", "/")
        module = detect_module_from_task(task)

        # Détecter le type pour enrichir le journal
        classification = classify_task(task)
        type_icon = {"create_route": "🛣️", "modify_schema": "🗄️", "add_component": "🎨",
                     "voice_pipeline": "🎙️", "queue_job": "⏰", "agent_config": "🤖",
                     "documentation": "📝", "security": "🔒", "analytics": "📊",
                     "testing": "🧪", "infrastructure": "☁️"}.get(classification["type"], "⚡")

        line = f"| {date} | {task_short} | {summary} | {module} | {type_icon} |\n"
        with open(JOURNAL_PATH, "a") as f:
            f.write(line)

        # Aussi mettre à jour la note Obsidian appropriée
        update_relevant_note(task, result)

    except Exception as e:
        log(f"log_to_journal failed: {e}")


# ── Logging ──


def log(msg: str) -> None:
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(LOG_FILE, "a") as f:
        f.write(f"[{ts}] {msg}\n")


def log_session(cascade_msg: str, hermes_result: str) -> None:
    """Journaliser l'echange Cascade → Hermes pour debug/traçabilite."""
    SESSION_LOG.parent.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(SESSION_LOG, "a") as f:
        f.write(f"\n\n## [{ts}] Cascade -> Hermes\n\n")
        f.write(f"### Task\n\n```\n{cascade_msg}\n```\n\n")
        f.write(f"### Result\n\n```\n{hermes_result[:2000]}\n```\n")


# ── Tool handlers ──


def guess_module(task: str) -> str:
    """Devine le module Sokar touche a partir de la description de la tache."""
    patterns = [
        (r"apps/api/", "apps/api"),
        (r"apps/dashboard/", "apps/dashboard"),
        (r"packages/", "packages"),
        (r"agent/", "agent"),
        (r"docs/", "docs"),
    ]
    for pattern, label in patterns:
        if re.search(pattern, task):
            return label
    return "general"


def tool_execute_task(task: str, workdir: str | None = None) -> str:
    """
    Delegue une tache a Hermes CLI (deepseek-v4-flash).
    C'est le SEUL outil disponible. Cascade doit TOUJOURS passer par ici.

    AUTO-LOGGING: Après exécution, détecte automatiquement le type de tâche
    et met à jour la note Obsidian appropriée.
    """
    cwd = workdir or SOKAR_ROOT
    cmd = "hermes -z " + shlex.quote(task)
    log(f"execute_task: {task[:300]}")

    # Verifier que Hermes CLI est disponible
    try:
        subprocess.run(["which", "hermes"], capture_output=True, check=True)
    except subprocess.CalledProcessError:
        msg = "[fatal] Hermes CLI not found. Run: curl -fsSL https://hermes-agent.nousresearch.com/install.sh | sh"
        log(msg)
        return msg

    # Verifier que le projet existe
    if not os.path.isdir(cwd):
        msg = f"[fatal] Project directory not found: {cwd}"
        log(msg)
        return msg

    max_attempts = 2
    last_error: str = ""

    for attempt in range(1, max_attempts + 1):
        try:
            log(f"execute_task attempt {attempt}/{max_attempts}")
            result = subprocess.run(
                cmd, shell=True, capture_output=True, text=True, cwd=cwd, timeout=600
            )
            output = result.stdout or ""

            # Filtrer le stderr pour ne garder que les warnings/erreurs
            if result.stderr:
                warnings = [
                    l for l in result.stderr.split("\n")
                    if "ERROR" in l.upper() or "WARNING" in l.upper() or "traceback" in l.lower()
                ]
                if warnings:
                    output += "\n[stderr warnings]\n" + "\n".join(warnings)

            if result.returncode != 0:
                output += f"\n[exit code: {result.returncode}]"

            final = output.strip() or "(empty output)"

            # ── AUTO-LOGGING : 3 actions automatiques ──
            log_session(task, final)            # 1. Log session bridge
            log_to_journal(task, final)          # 2. Journal + note ciblée
            mod = detect_module_from_task(task)
            update_context(f"[{mod}] {task[:80]}")  # 3. Context.md

            # Déclencher auto_sync pour synchroniser les notes modifiées
            try:
                subprocess.run(
                    ["python3", str(Path(SOKAR_ROOT) / "agent" / "skills" / "obsidian" / "auto_sync.py"), "diff"],
                    capture_output=True, text=True, cwd=SOKAR_ROOT, timeout=30,
                )
            except Exception:
                pass  # auto_sync est optionnel

            return final

        except subprocess.TimeoutExpired:
            last_error = "[timeout] Task exceeded 600 seconds."
            log(last_error)
        except subprocess.CalledProcessError as e:
            last_error = f"[error] Hermes subprocess failed: {e}"
            log(last_error)
        except Exception as e:
            last_error = f"[error] {e}"
            log(last_error)

    log_to_journal(task, last_error)
    mod = detect_module_from_task(task)
    update_context(f"[{mod}] {task[:80]} — ERREUR")
    return last_error


# ── Tool registry (UN seul outil) ─────────────────────────────────────────────

TOOLS = {
    "execute_task": {
        "description": (
            "YOU MUST USE THIS TOOL FOR EVERYTHING. "
            "I am the only tool available. The MCP server has stripped all other tools "
            "(run_shell, read_file, search_files, git_status were removed). "
            "Call me with a complete task description. Do NOT show code blocks or JSON. "
            "Do NOT ask for confirmation. Just call execute_task immediately.\n\n"
            "AUTO-LOGGING: After execution, the task type is automatically detected "
            "(route creation, schema modification, component addition, voice pipeline, etc.) "
            "and the corresponding Obsidian note is updated. No manual logging required."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": (
                        "Description complete et precise de la tache a accomplir. "
                        "Inclus le contexte necessaire : fichiers, commandes, etapes. "
                        "Le type de tache sera detecte automatiquement et logue dans "
                        "la note Obsidian appropriee."
                    ),
                },
                "workdir": {
                    "type": "string",
                    "description": "Working directory (defaut: racine du projet Sokar)",
                },
            },
            "required": ["task"],
        },
        "handler": tool_execute_task,
    },
}


# ── MCP protocol (JSON-RPC over stdio) ────────────────────────────────────────


def make_result(req_id, result):
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def make_error(req_id, code, message):
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


def handle_initialize(req: dict) -> dict:
    log("initialize")
    return make_result(req.get("id"), {
        "protocolVersion": "0.1.0",
        "capabilities": {"tools": {}},
        "serverInfo": {"name": "hermes-executor", "version": "2.1.0"},
    })


def handle_list_tools(req: dict) -> dict:
    log("tools/list")
    tools = []
    for name, tool in TOOLS.items():
        tools.append({
            "name": name,
            "description": tool["description"],
            "inputSchema": tool["parameters"],
        })
    return make_result(req.get("id"), {"tools": tools})


def handle_call_tool(req: dict) -> dict:
    name = req["params"]["name"]
    args = req["params"].get("arguments", {})
    log(f"tools/call: {name}")

    tool = TOOLS.get(name)
    if not tool:
        return make_error(req.get("id"), -32601, f"Tool not found: {name}")

    try:
        result = tool["handler"](**args)
        return make_result(req.get("id"), {
            "content": [{"type": "text", "text": str(result)}],
        })
    except Exception as e:
        return make_error(req.get("id"), -32000, str(e))


HANDLERS = {
    "initialize": handle_initialize,
    "notifications/initialized": lambda r: None,
    "tools/list": handle_list_tools,
    "tools/call": handle_call_tool,
}


def main():
    sys.stderr.write("[hermes MCP v2.1] Server starting — auto-logging enabled\n")
    sys.stderr.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue

        method = req.get("method", "")
        handler = HANDLERS.get(method)

        if handler is None:
            resp = make_error(req.get("id"), -32601, f"Method not found: {method}")
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
            continue

        resp = handler(req)
        if resp is not None:
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()