#!/usr/bin/env python3
"""MCP client for Notion - communicates with @notionhq/notion-mcp-server via stdio."""
import subprocess
import json
import sys
import os

NOTION_TOKEN = os.environ.get("NOTION_TOKEN", "")
if not NOTION_TOKEN:
    raise ValueError("NOTION_TOKEN environment variable is required")

class MCPClient:
    def __init__(self):
        self.proc = subprocess.Popen(
            ["npx", "-y", "@notionhq/notion-mcp-server"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={**os.environ, "NOTION_TOKEN": NOTION_TOKEN, "NODE_NO_WARNINGS": "1"},
            text=True,
            bufsize=1
        )
        self._msg_id = 0
    
    def _send(self, method, params=None):
        self._msg_id += 1
        msg = {
            "jsonrpc": "2.0",
            "id": self._msg_id,
            "method": method,
        }
        if params:
            msg["params"] = params
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()
        # Read response (one line JSON)
        resp = self.proc.stdout.readline()
        return json.loads(resp)
    
    def list_tools(self):
        return self._send("tools/list")
    
    def call_tool(self, name, arguments=None):
        params = {"name": name}
        if arguments:
            params["arguments"] = arguments
        return self._send("tools/call", params)
    
    def close(self):
        self.proc.terminate()
        self.proc.wait()


if __name__ == "__main__":
    client = MCPClient()
    
    # First, list tools to verify connection
    tools_resp = client.list_tools()
    print("=== TOOLS ===")
    print(json.dumps(tools_resp, indent=2)[:2000])
    print()
    
    # Search for "Sokar HQ"
    print("=== SEARCH: Sokar HQ ===")
    search_resp = client.call_tool("API-post-search", {"query": "Sokar HQ"})
    print(json.dumps(search_resp, indent=2)[:5000])
    print()
    
    client.close()
