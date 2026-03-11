#!/usr/bin/env python3
"""Claude Code status line — displays session info beneath the input prompt."""

import json
import os
import sys

# Ensure UTF-8 output on Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")


def format_duration(ms):
    """Convert milliseconds to a human-readable duration."""
    if not ms:
        return "0s"
    seconds = int(ms / 1000)
    if seconds < 60:
        return f"{seconds}s"
    minutes = seconds // 60
    secs = seconds % 60
    if minutes < 60:
        return f"{minutes}m{secs:02d}s"
    hours = minutes // 60
    mins = minutes % 60
    return f"{hours}h{mins:02d}m"


def format_cost(usd):
    """Format USD cost."""
    if not usd:
        return "$0.00"
    if usd < 0.01:
        return f"${usd:.4f}"
    return f"${usd:.2f}"


def context_bar(pct, width=12):
    """Render a visual context-window usage bar."""
    pct = int(pct or 0)
    filled = pct * width // 100
    empty = width - filled

    # Color thresholds: green < 60, yellow 60-79, red 80+
    if pct >= 80:
        color = "\033[31m"  # red — compaction imminent
    elif pct >= 60:
        color = "\033[33m"  # yellow
    else:
        color = "\033[32m"  # green
    reset = "\033[0m"

    bar = "▓" * filled + "░" * empty
    return f"{color}{bar} {pct}%{reset}"


def main():
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        print("⏳ waiting…")
        return

    # --- Model ---
    model_info = data.get("model", {})
    model_name = model_info.get("display_name") or model_info.get("id", "unknown")

    # --- Context window ---
    ctx = data.get("context_window", {})
    used_pct = ctx.get("used_percentage") or 0
    bar = context_bar(used_pct)

    # --- Cost & duration ---
    cost_info = data.get("cost", {})
    cost = format_cost(cost_info.get("total_cost_usd"))
    duration = format_duration(cost_info.get("total_duration_ms"))
    api_time = format_duration(cost_info.get("total_api_duration_ms"))

    # --- Lines changed ---
    added = cost_info.get("total_lines_added") or 0
    removed = cost_info.get("total_lines_removed") or 0
    lines = ""
    if added or removed:
        lines = f"  \033[32m+{added}\033[0m/\033[31m-{removed}\033[0m"

    # --- Agent / worktree context ---
    agent = data.get("agent", {})
    agent_name = agent.get("name") if agent else None

    worktree = data.get("worktree", {})
    wt_branch = worktree.get("branch") if worktree else None

    suffix_parts = []
    if agent_name:
        suffix_parts.append(f"agent:{agent_name}")
    if wt_branch:
        suffix_parts.append(f"wt:{wt_branch}")
    suffix = f"  [{' | '.join(suffix_parts)}]" if suffix_parts else ""

    # --- Build output ---
    # Line 1: model + context bar + cost/time
    line1 = f"\033[1m{model_name}\033[0m  {bar}  {cost}  ⏱ {duration} (api {api_time}){lines}{suffix}"

    print(line1)


if __name__ == "__main__":
    main()
