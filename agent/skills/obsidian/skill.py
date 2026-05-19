#!/usr/bin/env python3
"""
Skill Hermes — Obsidian Vault Callyx
Exposes tools to read, write, list and search notes in the Obsidian vault.
"""
import os
import json
import glob
from pathlib import Path
from datetime import datetime

VAULT_PATH = os.environ.get("OBSIDIAN_VAULT", "/Users/hamza/Desktop/Callyx/docs/obsidian")


def _list_notes() -> list[str]:
    """List all markdown files in the vault (excluding .obsidian/)."""
    notes = []
    for root, _, files in os.walk(VAULT_PATH):
        if ".obsidian" in root:
            continue
        for f in files:
            if f.endswith(".md"):
                rel = os.path.relpath(os.path.join(root, f), VAULT_PATH)
                notes.append(rel)
    return sorted(notes)


def _read_note(path: str) -> str:
    """Read a note by relative path or title."""
    if not path.endswith(".md"):
        path += ".md"
    full = os.path.join(VAULT_PATH, path)
    if not os.path.isfile(full):
        # Try to find by title anywhere in vault
        for root, _, files in os.walk(VAULT_PATH):
            if ".obsidian" in root:
                continue
            for f in files:
                if f.lower() == os.path.basename(path).lower():
                    with open(os.path.join(root, f), "r", encoding="utf-8") as fh:
                        return fh.read()
        return f"[ERROR] Note not found: {path}"
    with open(full, "r", encoding="utf-8") as f:
        return f.read()


def _write_note(path: str, content: str) -> str:
    """Write or overwrite a note."""
    if not path.endswith(".md"):
        path += ".md"
    full = os.path.join(VAULT_PATH, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(content)
    return f"Note written: {path}"


def _search_vault(query: str) -> list[dict]:
    """Search for query in all note contents (case-insensitive)."""
    results = []
    for note in _list_notes():
        content = _read_note(note)
        if query.lower() in content.lower():
            # Extract snippet around match
            idx = content.lower().find(query.lower())
            start = max(0, idx - 80)
            end = min(len(content), idx + len(query) + 80)
            snippet = content[start:end].replace("\n", " ")
            results.append({"note": note, "snippet": snippet})
    return results


def _append_to_note(path: str, text: str) -> str:
    """Append text to an existing note."""
    if not path.endswith(".md"):
        path += ".md"
    full = os.path.join(VAULT_PATH, path)
    if not os.path.isfile(full):
        return f"[ERROR] Note not found: {path}"
    with open(full, "a", encoding="utf-8") as f:
        f.write(f"\n\n{text}\n")
    return f"Appended to {path}"


# ── Tool definitions for Hermes ──

def list_notes() -> str:
    """List all notes in the vault."""
    notes = _list_notes()
    return json.dumps(notes, indent=2, ensure_ascii=False)


def read_note(note_path: str) -> str:
    """Read a note by path or title."""
    return _read_note(note_path)


def write_note(note_path: str, content: str) -> str:
    """Write a new note or overwrite an existing one."""
    return _write_note(note_path, content)


def search_vault(query: str) -> str:
    """Search all notes for a keyword."""
    results = _search_vault(query)
    return json.dumps(results, indent=2, ensure_ascii=False)


def append_note(note_path: str, content: str) -> str:
    """Append content to an existing note."""
    return _append_to_note(note_path, content)


def daily_note() -> str:
    """Create or open today's daily note."""
    today = datetime.now().strftime("%Y-%m-%d")
    path = f"Daily/{today}.md"
    full = os.path.join(VAULT_PATH, path)
    if os.path.isfile(full):
        with open(full, "r", encoding="utf-8") as f:
            return f.read()
    content = f"# {today}\n\n## Notes du jour\n\n- \n\n## Tâches\n\n- [ ] \n\n## Liens\n\n"
    return _write_note(path, content)


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python skill.py <command> [args...]")
        print("Commands: list, read <path>, write <path> <content>, search <query>, append <path> <content>, daily")
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "list":
        print(list_notes())
    elif cmd == "read" and len(sys.argv) > 2:
        print(read_note(sys.argv[2]))
    elif cmd == "write" and len(sys.argv) > 3:
        print(write_note(sys.argv[2], sys.argv[3]))
    elif cmd == "search" and len(sys.argv) > 2:
        print(search_vault(sys.argv[2]))
    elif cmd == "append" and len(sys.argv) > 3:
        print(append_note(sys.argv[2], sys.argv[3]))
    elif cmd == "daily":
        print(daily_note())
    else:
        print("Unknown command or missing arguments.")
