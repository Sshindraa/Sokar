#!/usr/bin/env python3
"""
notion_sync — Synchronisation bidirectionnelle Notion ↔ Obsidian.

MAPPING : établit une correspondance entre les notes Obsidian et les pages Notion.
          La carte est stockée dans .notion_map.json dans le vault.

SENS UNIQUE (défaut) : Obsidian → Notion.
    Surveille les modifications dans le vault Obsidian (git diff / filesystem)
    et pousse les mises à jour vers la page Notion correspondante.

BIDIRECTIONNEL (optionnel) : Notion → Obsidian aussi.
    Vérifie périodiquement les pages Notion pour détecter les changements
    et les rapatrie dans le vault.

USAGE:
    python notion_sync.py push              # Obsidian → Notion (push)
    python notion_sync.py pull              # Notion → Obsidian (pull)
    python notion_sync.py sync              # Bidirectionnel
    python notion_sync.py daemon            # Boucle sync toutes les 60s
    python notion_sync.py map               # Affiche la carte de mapping
    python notion_sync.py register <note> <notion_page_id>  # Ajoute un mapping
"""

import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

SOKAR_ROOT = Path(os.environ.get("SOKAR_ROOT", str(Path.home() / "Desktop" / "Sokar")))
VAULT_PATH = SOKAR_ROOT / "docs" / "obsidian"
MAP_FILE = VAULT_PATH / ".notion_map.json"
LOG_FILE = Path.home() / ".hermes" / "logs" / "notion_sync.log"

NOTION_TOKEN = os.environ.get("NOTION_TOKEN", "")
NOTION_HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
}

# ── Configuration ──

DEFAULT_MAP: dict[str, str] = {
    # Obsidian note name → Notion page ID
    # "Context.md": "abc123...",
    # "Sprint 1.md": "def456...",
}

if NOTION_TOKEN:
    DEFAULT_MAP = {}  # La carte est chargée depuis .notion_map.json


# ── Logging ──


def log(msg: str) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    entry = f"[{ts}] {msg}"
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(entry + "\n")
    print(entry)


# ── Carte de mapping ──


def _load_map() -> dict[str, str]:
    """Charge la carte Obsidian → Notion depuis .notion_map.json."""
    if MAP_FILE.is_file():
        try:
            return json.loads(MAP_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log("⚠️  .notion_map.json corrompu, réinitialisation")
    # Créer la carte par défaut
    MAP_FILE.parent.mkdir(parents=True, exist_ok=True)
    MAP_FILE.write_text(json.dumps(DEFAULT_MAP, indent=2) + "\n", encoding="utf-8")
    return dict(DEFAULT_MAP)


def _save_map(mapping: dict[str, str]) -> None:
    """Sauvegarde la carte."""
    MAP_FILE.write_text(json.dumps(mapping, indent=2) + "\n", encoding="utf-8")


def register_mapping(obsidian_note: str, notion_page_id: str) -> str:
    """Ajoute un mapping Obsidian → Notion."""
    if not obsidian_note.endswith(".md"):
        obsidian_note += ".md"
    mapping = _load_map()
    mapping[obsidian_note] = notion_page_id
    _save_map(mapping)
    log(f"Mapping enregistré: {obsidian_note} → {notion_page_id}")
    return f"✅ Mapping: {obsidian_note} → {notion_page_id}"


def show_map() -> str:
    """Affiche la carte de mapping."""
    mapping = _load_map()
    if not mapping:
        return "ℹ️  Aucun mapping enregistré. Utilisez `register <note> <page_id>`."
    lines = ["📋 Carte Notion ↔ Obsidian:\n"]
    for note, page_id in mapping.items():
        lines.append(f"  {note:30s} → {page_id}\n")
    return "".join(lines)


# ── API Notion helpers ──


def _notion_get_page(page_id: str) -> dict | None:
    """Récupère le contenu d'une page Notion."""
    import urllib.request
    import urllib.error

    if not NOTION_TOKEN:
        log("NOTION_TOKEN non configuré, impossible de lire Notion")
        return None

    url = f"https://api.notion.com/v1/pages/{page_id}"
    req = urllib.request.Request(url, headers=NOTION_HEADERS, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        log(f"Notion API error {e.code}: {e.reason}")
        return None
    except Exception as e:
        log(f"Notion request error: {e}")
        return None


def _notion_get_block_children(block_id: str) -> list[dict] | None:
    """Récupère les blocks enfants d'un block/page Notion (paginated)."""
    import urllib.request
    import urllib.error

    if not NOTION_TOKEN:
        return None

    all_blocks = []
    cursor = None
    while True:
        url = f"https://api.notion.com/v1/blocks/{block_id}/children?page_size=100"
        if cursor:
            url += f"&start_cursor={cursor}"
        req = urllib.request.Request(url, headers=NOTION_HEADERS, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode())
        except Exception as e:
            log(f"Erreur récupération blocks Notion: {e}")
            return None

        all_blocks.extend(data.get("results", []))
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
    return all_blocks


def _blocks_to_markdown(blocks: list[dict]) -> str:
    """Convertit des blocks Notion en markdown simple."""
    md_parts = []
    for block in blocks:
        btype = block.get("type", "paragraph")
        rich_text = block.get(btype, {}).get("rich_text", [])
        text = "".join(t.get("plain_text", "") for t in rich_text)

        if btype == "heading_1":
            md_parts.append(f"# {text}\n\n")
        elif btype == "heading_2":
            md_parts.append(f"## {text}\n\n")
        elif btype == "heading_3":
            md_parts.append(f"### {text}\n\n")
        elif btype == "bulleted_list_item":
            md_parts.append(f"- {text}\n")
        elif btype == "numbered_list_item":
            md_parts.append(f"1. {text}\n")
        elif btype == "to_do":
            checked = block.get("to_do", {}).get("checked", False)
            prefix = "[x]" if checked else "[ ]"
            md_parts.append(f"- {prefix} {text}\n")
        elif btype == "code":
            lang = block.get("code", {}).get("language", "")
            md_parts.append(f"```{lang}\n{text}\n```\n\n")
        elif btype == "quote":
            md_parts.append(f"> {text}\n\n")
        elif btype == "callout":
            md_parts.append(f"> 💡 {text}\n\n")
        elif btype == "divider":
            md_parts.append("---\n\n")
        else:
            md_parts.append(f"{text}\n\n")
    return "".join(md_parts)


def _notion_update_page(page_id: str, content: str) -> bool:
    """Met à jour le contenu texte d'une page Notion (ajoute des blocks)."""
    import urllib.request
    import urllib.error

    if not NOTION_TOKEN:
        return False

    # Notion API: on ajoute des blocks enfants à la page
    url = f"https://api.notion.com/v1/blocks/{page_id}/children"

    # Convertir le markdown en blocks Notion (simplifié)
    blocks = _markdown_to_notion_blocks(content)
    if not blocks:
        return True  # Rien à ajouter

    payload = json.dumps({"children": blocks}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers=NOTION_HEADERS, method="PATCH")
    try:
        with urllib.request.urlopen(req, timeout=15):
            log(f"Page Notion mise à jour: {page_id}")
            return True
    except urllib.error.HTTPError as e:
        log(f"Erreur mise à jour Notion {page_id}: {e.code} {e.read().decode()[:200]}")
        return False
    except Exception as e:
        log(f"Erreur réseau Notion: {e}")
        return False


def _markdown_to_notion_blocks(markdown: str) -> list[dict]:
    """Convertit un markdown simple en blocks Notion (approximatif)."""
    blocks = []
    for line in markdown.split("\n"):
        line = line.strip()
        if not line:
            continue

        # Headings
        hm = re.match(r"^(#{1,3})\s+(.+)$", line)
        if hm:
            level = len(hm.group(1))
            text = hm.group(2)
            btype = f"heading_{level}"
            blocks.append({
                "object": "block",
                "type": btype,
                btype: {
                    "rich_text": [{"type": "text", "text": {"content": text[:2000]}}],
                },
            })
            continue

        # Bullet list
        if line.startswith("- ") or line.startswith("* "):
            text = line[2:]
            blocks.append({
                "object": "block",
                "type": "bulleted_list_item",
                "bulleted_list_item": {
                    "rich_text": [{"type": "text", "text": {"content": text[:2000]}}],
                },
            })
            continue

        # Code block
        if line.startswith("```"):
            # Skip code fence lines, just add the content
            continue

        # Divider
        if line in ("---", "***", "___"):
            blocks.append({"object": "block", "type": "divider", "divider": {}})
            continue

        # Default: paragraph
        blocks.append({
            "object": "block",
            "type": "paragraph",
            "paragraph": {
                "rich_text": [{"type": "text", "text": {"content": line[:2000]}}],
            },
        })

    return blocks


# ── Synchro Obsidian → Notion (push) ──


def push_all() -> list[str]:
    """Pousse toutes les obsidian notes modifiées vers Notion."""
    if not NOTION_TOKEN:
        return ["❌ NOTION_TOKEN non configuré. Impossible de push vers Notion."]

    mapping = _load_map()
    if not mapping:
        return ["ℹ️  Aucun mapping. Utilisez `register` d'abord."]

    results = []
    for note_name, page_id in mapping.items():
        note_path = VAULT_PATH / note_name
        if not note_path.is_file():
            results.append(f"⚠️  Note introuvable: {note_name}")
            continue

        content = note_path.read_text(encoding="utf-8")
        # Ajouter un timestamp de synchronisation
        ts = datetime.now().strftime("%Y-%m-%d %H:%M")
        synced_line = f"\n\n_Dernière sync Notion: {ts}_"

        success = _notion_update_page(page_id, content + synced_line)
        if success:
            results.append(f"✅ {note_name} → Notion OK")
            log(f"Push OK: {note_name} → {page_id}")
        else:
            results.append(f"❌ {note_name} → Notion ÉCHEC")
            log(f"Push ÉCHEC: {note_name} → {page_id}")

    return results


# ── Synchro Notion → Obsidian (pull) ──


def pull_all() -> list[str]:
    """Rapatrie les pages Notion modifiées vers le vault Obsidian."""
    if not NOTION_TOKEN:
        return ["❌ NOTION_TOKEN non configuré. Impossible de pull depuis Notion."]

    mapping = _load_map()
    if not mapping:
        return ["ℹ️  Aucun mapping. Utilisez `register` d'abord."]

    results = []
    for note_name, page_id in mapping.items():
        page = _notion_get_page(page_id)
        if page is None:
            results.append(f"❌ {note_name}: impossible de lire Notion")
            continue

        blocks = _notion_get_block_children(page_id)
        if blocks is None:
            results.append(f"❌ {note_name}: impossible de lire les blocks")
            continue

        md_content = _blocks_to_markdown(blocks)
        if not md_content.strip():
            results.append(f"⚠️  {note_name}: page Notion vide")
            continue

        # Ajouter frontmatter
        ts = datetime.now().strftime("%Y-%m-%d %H:%M")
        full_content = (
            f"---\n"
            f"title: {note_name.replace('.md', '')}\n"
            f"notion_id: {page_id}\n"
            f"last_synced: {ts}\n"
            f"---\n\n"
            f"{md_content}\n"
            f"\n_Synchronisé depuis Notion le {ts}_\n"
        )

        note_path = VAULT_PATH / note_name
        note_path.write_text(full_content, encoding="utf-8")
        results.append(f"✅ Notion → {note_name} OK")
        log(f"Pull OK: {page_id} → {note_name}")

    return results


# ── Entries bidirectionnelles ──


def sync_bidirectional() -> list[str]:
    """Sync bidirectionnelle: pull puis push."""
    results = []
    log("=== Sync bidirectionnelle démarrée ===")
    results.append("--- Pull Notion → Obsidian ---")
    results.extend(pull_all())
    results.append("--- Push Obsidian → Notion ---")
    results.extend(push_all())
    log("=== Sync bidirectionnelle terminée ===")
    return results


def daemon_loop(interval: int = 60) -> None:
    """Boucle daemon: sync bidirectionnelle toutes les N secondes."""
    log(f"🚀 Daemon notion_sync démarré (intervalle={interval}s)")
    log(f"   Vault : {VAULT_PATH}")
    if NOTION_TOKEN:
        log("   Notion : connecté ✅")
    else:
        log("   Notion : TOKEN NON CONFIGURÉ ❌ (définir NOTION_TOKEN)")

    while True:
        try:
            results = sync_bidirectional()
            for r in results:
                log(r)
            log(f"Cycle terminé — {len(results)} opération(s)")
        except KeyboardInterrupt:
            log("Daemon arrêté par utilisateur")
            break
        except Exception as e:
            log(f"Erreur dans daemon: {e}")
        time.sleep(interval)


# ── CLI ──


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "push":
        results = push_all()
        for r in results:
            print(r)
    elif cmd == "pull":
        results = pull_all()
        for r in results:
            print(r)
    elif cmd == "sync":
        results = sync_bidirectional()
        for r in results:
            print(r)
    elif cmd == "daemon":
        interval = int(sys.argv[2]) if len(sys.argv) > 2 else 60
        daemon_loop(interval)
    elif cmd == "map":
        print(show_map())
    elif cmd == "register" and len(sys.argv) >= 4:
        print(register_mapping(sys.argv[2], sys.argv[3]))
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()