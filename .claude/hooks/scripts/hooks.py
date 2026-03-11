#!/usr/bin/env python3
"""
Claude Code Hook Handler — Comprehensive Event Processing System
================================================================
Handles all 18 Claude Code hook events with:
  - Sound playback (tool-specific, bash-pattern, event-default, fallback chain)
  - PreToolUse guardrails (block dangerous commands)  [requires async:false]
  - UserPromptSubmit auto-context injection           [requires async:false]
  - Desktop notifications for critical events
  - Debounce / cooldown to prevent sound spam
  - Structured logging with timestamps and rotation
  - Session metrics tracking
  - Agent-specific sound routing (--agent flag)

Hook async note:
  Hooks with "async": true run fire-and-forget — stdout is NOT processed.
  For PreToolUse guardrails (block/allow) and UserPromptSubmit (autoContext),
  set "async": false on those specific hooks in settings.json.

Directory layout:
  .claude/hooks/
    scripts/       ← this file + status_line.py
    sounds/        ← {event}/ folders with .wav/.mp3 files
    config/        ← hooks-config.json, hooks-config.local.json
    logs/          ← hooks-log.jsonl, session-metrics.json

Docs: https://code.claude.com/docs/en/hooks
"""

import sys
import os
import json
import subprocess
import re
import platform
import argparse
import time
from datetime import datetime, timezone
from pathlib import Path

# ─── Platform Setup ──────────────────────────────────────────────────────────

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")

try:
    import winsound
except ImportError:
    winsound = None

# ─── Path Constants ──────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).parent          # .claude/hooks/scripts/
HOOKS_DIR = SCRIPT_DIR.parent               # .claude/hooks/
SOUNDS_DIR = HOOKS_DIR / "sounds"
CONFIG_DIR = HOOKS_DIR / "config"
LOGS_DIR = HOOKS_DIR / "logs"

# ─── Debounce ────────────────────────────────────────────────────────────────

DEBOUNCE_FILE = LOGS_DIR / ".last_sound_ts"
DEFAULT_DEBOUNCE_SECONDS = 0.15  # 150ms — prevents rapid-fire overlap

# ─── Log Rotation ────────────────────────────────────────────────────────────

LOG_FILE = LOGS_DIR / "hooks-log.jsonl"
LOG_MAX_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
LOG_MAX_ROTATED = 3                     # keep up to hooks-log.1.jsonl … .3.jsonl

# ─── Session Metrics ─────────────────────────────────────────────────────────

METRICS_FILE = LOGS_DIR / "session-metrics.json"

# ═════════════════════════════════════════════════════════════════════════════
#  SOUND MAPPINGS
# ═════════════════════════════════════════════════════════════════════════════

# Default event → sound-folder mapping (all 18 hooks)
HOOK_SOUND_MAP = {
    "PreToolUse":          "pretooluse",
    "PermissionRequest":   "permissionrequest",
    "PostToolUse":         "posttooluse",
    "PostToolUseFailure":  "posttoolusefailure",
    "UserPromptSubmit":    "userpromptsubmit",
    "Notification":        "notification",
    "Stop":                "stop",
    "SubagentStart":       "subagentstart",
    "SubagentStop":        "subagentstop",
    "PreCompact":          "precompact",
    "SessionStart":        "sessionstart",
    "SessionEnd":          "sessionend",
    "Setup":               "setup",
    "TeammateIdle":        "teammateidle",
    "TaskCompleted":       "taskcompleted",
    "ConfigChange":        "configchange",
    "WorktreeCreate":      "worktreecreate",
    "WorktreeRemove":      "worktreeremove",
}

# Agent-specific event → sound-folder (6 hooks that fire in agent contexts)
AGENT_HOOK_SOUND_MAP = {
    "PreToolUse":          "agent_pretooluse",
    "PostToolUse":         "agent_posttooluse",
    "PermissionRequest":   "agent_permissionrequest",
    "PostToolUseFailure":  "agent_posttoolusefailure",
    "Stop":                "agent_stop",
    "SubagentStop":        "agent_subagentstop",
}

# Tool-specific PreToolUse sounds (checked before event default)
# Sound file: .claude/hooks/sounds/pretooluse/pretooluse-{suffix}.wav
TOOL_SOUND_MAP = {
    "Bash":         "pretooluse-bash",
    "Write":        "pretooluse-write",
    "Edit":         "pretooluse-edit",
    "Read":         "pretooluse-read",
    "Agent":        "pretooluse-agent",
    "WebFetch":     "pretooluse-web",
    "WebSearch":    "pretooluse-web",
    "Grep":         "pretooluse-search",
    "Glob":         "pretooluse-search",
    "NotebookEdit": "pretooluse-notebook",
    "TodoWrite":    "pretooluse-todo",
    "Skill":        "pretooluse-skill",
    "ToolSearch":   "pretooluse-toolsearch",
}

# Tool-specific PostToolUse sounds
POST_TOOL_SOUND_MAP = {
    "Bash":         "posttooluse-bash",
    "Write":        "posttooluse-write",
    "Edit":         "posttooluse-edit",
    "Agent":        "posttooluse-agent",
}

# ═════════════════════════════════════════════════════════════════════════════
#  BASH COMMAND PATTERNS  (checked in order — first match wins)
# ═════════════════════════════════════════════════════════════════════════════

BASH_PATTERNS = [
    # Git operations
    (r"git\s+commit",                              "pretooluse-git-committing"),
    (r"git\s+push",                                "pretooluse-git-pushing"),
    (r"git\s+pull|git\s+fetch",                    "pretooluse-git-pulling"),
    (r"git\s+merge|git\s+rebase",                  "pretooluse-git-merging"),
    (r"git\s+stash",                               "pretooluse-git-stashing"),
    (r"git\s+checkout|git\s+switch",               "pretooluse-git-switching"),
    (r"gh\s+pr\s+create",                          "pretooluse-git-pr"),
    (r"gh\s+issue\s+create",                       "pretooluse-git-issue"),
    # Package management
    (r"(npm|yarn|pnpm|bun)\s+install",             "pretooluse-installing"),
    (r"(pip|pip3)\s+install",                       "pretooluse-installing"),
    (r"(npm|yarn|pnpm|bun)\s+add",                 "pretooluse-installing"),
    # Testing
    (r"(npm\s+test|npx\s+jest|pytest|vitest|mocha|cargo\s+test)", "pretooluse-testing"),
    # Building
    (r"(npm\s+run\s+build|npx\s+tsc|webpack|vite\s+build|cargo\s+build)", "pretooluse-building"),
    # Linting / formatting
    (r"(npm\s+run\s+lint|eslint|prettier|ruff|black|cargo\s+clippy)", "pretooluse-linting"),
    # Docker
    (r"docker\s+(build|run|compose|push)",         "pretooluse-docker"),
    # Deployment
    (r"(npm\s+run\s+deploy|netlify\s+deploy|vercel|fly\s+deploy)", "pretooluse-deploying"),
    # Server / start
    (r"(npm\s+start|npm\s+run\s+dev|node\s+server|python.*manage\.py\s+runserver)", "pretooluse-starting"),
]

# ═════════════════════════════════════════════════════════════════════════════
#  GUARDRAIL PATTERNS  (PreToolUse — block dangerous commands)
#  Only effective when PreToolUse hook has "async": false
# ═════════════════════════════════════════════════════════════════════════════

DANGEROUS_BASH_PATTERNS = [
    # Filesystem destruction
    (r"rm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+/\s*$",
     "Blocked: recursive forced delete from root (/)"),
    (r"rm\s+-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*\s+/\s*$",
     "Blocked: recursive forced delete from root (/)"),
    (r"rm\s+-rf\s+~/?$",
     "Blocked: recursive delete of home directory"),
    (r"rm\s+-rf\s+\.\s*$",
     "Blocked: recursive delete of current directory"),
    # Fork bomb
    (r":\(\)\s*\{.*:\|:.*\}",
     "Blocked: fork bomb detected"),
    # Raw disk operations
    (r"dd\s+.*of=/dev/[sh]d",
     "Blocked: raw disk write via dd"),
    (r"mkfs\.\w+\s+/dev/",
     "Blocked: filesystem format command"),
    # Remote code execution piped to privileged shell
    (r"(curl|wget)\s+.*\|\s*sudo\s+(ba)?sh",
     "Blocked: piping remote content to sudo shell"),
    # Database destruction (SQL in bash via cli tools)
    (r"(mysql|psql|sqlite3).*DROP\s+(DATABASE|TABLE)\s+",
     "Blocked: DROP DATABASE/TABLE via CLI"),
    # System-level destruction
    (r">\s*/dev/sd[a-z]",
     "Blocked: raw disk overwrite via redirect"),
]

# Dangerous patterns for Write/Edit tool paths
DANGEROUS_WRITE_PATHS = [
    (r"^/etc/passwd$",      "Blocked: write to /etc/passwd"),
    (r"^/etc/shadow$",      "Blocked: write to /etc/shadow"),
    (r"^/etc/sudoers$",     "Blocked: write to /etc/sudoers"),
    (r"^~?/\.ssh/",         "Blocked: write to SSH directory"),
    (r"^~?/\.gnupg/",       "Blocked: write to GPG directory"),
    (r"^/boot/",            "Blocked: write to /boot"),
    (r"^C:\\Windows\\System32\\", "Blocked: write to System32"),
]

# ═════════════════════════════════════════════════════════════════════════════
#  NOTIFICATION EVENTS  (trigger desktop notifications)
# ═════════════════════════════════════════════════════════════════════════════

NOTIFY_EVENTS = {
    "Stop":           "Claude has stopped",
    "TaskCompleted":  "Task completed",
    "SessionEnd":     "Session ended",
    "Notification":   None,  # uses the notification message from hook data
}

# ═════════════════════════════════════════════════════════════════════════════
#  CONFIG SYSTEM
# ═════════════════════════════════════════════════════════════════════════════


def _load_config_files():
    """Load and merge config with fallback: local → default.

    Returns:
        Merged config dict (local values override default values).
    """
    default_config = {}
    local_config = {}

    default_path = CONFIG_DIR / "hooks-config.json"
    local_path = CONFIG_DIR / "hooks-config.local.json"

    if default_path.exists():
        try:
            with open(default_path, "r", encoding="utf-8") as f:
                default_config = json.load(f)
        except Exception as e:
            _err(f"Error reading {default_path.name}: {e}")

    if local_path.exists():
        try:
            with open(local_path, "r", encoding="utf-8") as f:
                local_config = json.load(f)
        except Exception as e:
            _err(f"Error reading {local_path.name}: {e}")

    # Merge: local overrides default
    merged = {**default_config, **local_config}
    return merged


# Cache config per process invocation (loaded once)
_config_cache = None


def get_config():
    """Get merged config (cached for this process)."""
    global _config_cache
    if _config_cache is None:
        _config_cache = _load_config_files()
    return _config_cache


def get_config_value(key, default=None):
    """Get a single config value with fallback default."""
    return get_config().get(key, default)


def is_hook_disabled(event_name):
    """Check if a specific hook event is disabled via config.

    Config key: disable{EventName}Hook (e.g., disablePreToolUseHook)
    """
    return bool(get_config_value(f"disable{event_name}Hook", False))


def is_feature_enabled(feature, default=True):
    """Check if a feature is enabled.

    Features: sounds, logging, notifications, guardrails, autoContext,
              debounce, metrics
    Config key: disable{Feature} (e.g., disableSounds, disableNotifications)
    """
    return not bool(get_config_value(f"disable{feature.title()}", not default))


# ═════════════════════════════════════════════════════════════════════════════
#  LOGGING SYSTEM
# ═════════════════════════════════════════════════════════════════════════════


def _err(msg):
    """Print to stderr (non-blocking, won't disrupt Claude)."""
    print(msg, file=sys.stderr)


def rotate_logs():
    """Rotate log file if it exceeds LOG_MAX_SIZE_BYTES.

    Keeps up to LOG_MAX_ROTATED archived copies:
      hooks-log.jsonl → hooks-log.1.jsonl → … → hooks-log.{N}.jsonl (deleted)
    """
    if not LOG_FILE.exists():
        return
    try:
        if LOG_FILE.stat().st_size < LOG_MAX_SIZE_BYTES:
            return

        # Shift existing rotated files
        for i in range(LOG_MAX_ROTATED, 0, -1):
            src = LOGS_DIR / f"hooks-log.{i}.jsonl"
            if i == LOG_MAX_ROTATED:
                # Delete the oldest
                if src.exists():
                    src.unlink()
            else:
                dst = LOGS_DIR / f"hooks-log.{i + 1}.jsonl"
                if src.exists():
                    src.rename(dst)

        # Rotate current → .1
        LOG_FILE.rename(LOGS_DIR / "hooks-log.1.jsonl")
    except Exception as e:
        _err(f"Log rotation failed: {e}")


def log_hook_data(hook_data, agent_name=None):
    """Log hook event with ISO timestamp to hooks-log.jsonl.

    Skips if logging is disabled in config.
    Rotates the log file if it exceeds the size limit.
    """
    if not is_feature_enabled("logging"):
        return

    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)

        # Rotate before writing
        rotate_logs()

        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "hook_event_name": hook_data.get("hook_event_name"),
            "tool_name": hook_data.get("tool_name"),
            "session_id": hook_data.get("session_id"),
        }

        # Include tool_input for PreToolUse (useful for debugging)
        if hook_data.get("hook_event_name") == "PreToolUse":
            tool_input = hook_data.get("tool_input", {})
            # For Bash, log the command; for others, log file_path if present
            if hook_data.get("tool_name") == "Bash":
                log_entry["command"] = tool_input.get("command", "")[:500]
            else:
                fp = tool_input.get("file_path")
                if fp:
                    log_entry["file_path"] = fp

        # Include tool output summary for PostToolUse
        if hook_data.get("hook_event_name") == "PostToolUse":
            output = hook_data.get("tool_output", "")
            if isinstance(output, str) and len(output) > 200:
                log_entry["tool_output_preview"] = output[:200] + "…"
            elif output:
                log_entry["tool_output_preview"] = str(output)[:200]

        # Include error info for failures
        if hook_data.get("hook_event_name") == "PostToolUseFailure":
            log_entry["tool_error"] = str(hook_data.get("tool_error", ""))[:500]

        # Include notification message
        if hook_data.get("hook_event_name") == "Notification":
            log_entry["message"] = hook_data.get("message", "")[:500]

        if agent_name:
            log_entry["invoked_by_agent"] = agent_name

        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(log_entry, ensure_ascii=False) + "\n")

    except Exception as e:
        _err(f"Failed to log hook data: {e}")


# ═════════════════════════════════════════════════════════════════════════════
#  SESSION METRICS
# ═════════════════════════════════════════════════════════════════════════════


def load_metrics():
    """Load session metrics from disk."""
    if METRICS_FILE.exists():
        try:
            with open(METRICS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_metrics(metrics):
    """Persist session metrics to disk."""
    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        with open(METRICS_FILE, "w", encoding="utf-8") as f:
            json.dump(metrics, f, indent=2, ensure_ascii=False)
    except Exception as e:
        _err(f"Failed to save metrics: {e}")


def increment_metric(key, amount=1):
    """Atomically increment a metric counter."""
    if not is_feature_enabled("metrics", default=True):
        return
    try:
        metrics = load_metrics()
        metrics[key] = metrics.get(key, 0) + amount

        # Track per-tool counts
        save_metrics(metrics)
    except Exception as e:
        _err(f"Failed to increment metric '{key}': {e}")


def record_tool_metric(event_name, tool_name):
    """Record a per-tool metric for Pre/PostToolUse events."""
    if not is_feature_enabled("metrics", default=True):
        return
    if not tool_name:
        return
    try:
        metrics = load_metrics()
        tools = metrics.setdefault("tools", {})
        tools[tool_name] = tools.get(tool_name, 0) + 1
        save_metrics(metrics)
    except Exception as e:
        _err(f"Failed to record tool metric: {e}")


# ═════════════════════════════════════════════════════════════════════════════
#  DEBOUNCE SYSTEM
# ═════════════════════════════════════════════════════════════════════════════


def should_debounce():
    """Check if we should skip this sound due to rapid-fire invocations.

    Uses a timestamp file to track the last time a sound was played.
    Returns True if the last sound was played less than DEBOUNCE_SECONDS ago.
    """
    if not is_feature_enabled("debounce", default=True):
        return False

    debounce_secs = get_config_value("debounceSeconds", DEFAULT_DEBOUNCE_SECONDS)

    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)

        if DEBOUNCE_FILE.exists():
            last_ts = float(DEBOUNCE_FILE.read_text(encoding="utf-8").strip())
            elapsed = time.time() - last_ts
            if elapsed < debounce_secs:
                return True

        # Update timestamp
        DEBOUNCE_FILE.write_text(str(time.time()), encoding="utf-8")
        return False
    except Exception:
        # On any error, don't debounce
        return False


# ═════════════════════════════════════════════════════════════════════════════
#  SOUND SYSTEM
# ═════════════════════════════════════════════════════════════════════════════


def get_audio_player():
    """Detect the appropriate audio player for the current platform.

    Returns:
        List of command+args for playing audio, or None if unavailable.
        Special value ["WINDOWS"] means use winsound module.
    """
    system = platform.system()

    if system == "Darwin":
        return ["afplay"]
    elif system == "Linux":
        players = [
            ["paplay"],
            ["aplay"],
            ["ffplay", "-nodisp", "-autoexit"],
            ["mpg123", "-q"],
        ]
        for player in players:
            try:
                subprocess.run(
                    ["which", player[0]],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=True,
                )
                return player
            except (subprocess.CalledProcessError, FileNotFoundError):
                continue
        return None
    elif system == "Windows":
        return ["WINDOWS"]
    return None


def play_sound(sound_name):
    """Play a sound file with the fallback chain:

       tool-specific → bash-pattern → event-default → generic fallback

    Sound lookup: .claude/hooks/sounds/{folder}/{sound_name}.{wav|mp3}
    The folder is derived from the sound_name prefix (before first '-').

    Returns True if sound played, False otherwise.
    """
    if not is_feature_enabled("sounds"):
        return False

    # Security: prevent directory traversal
    if "/" in sound_name or "\\" in sound_name or ".." in sound_name:
        _err(f"Invalid sound name: {sound_name}")
        return False

    audio_player = get_audio_player()
    if not audio_player:
        return False

    is_windows = audio_player[0] == "WINDOWS"

    # Determine folder from prefix (e.g., "pretooluse-git-committing" → "pretooluse")
    folder_name = sound_name.split("-")[0]
    sounds_dir = SOUNDS_DIR / folder_name

    extensions = [".wav"] if is_windows else [".wav", ".mp3"]

    for ext in extensions:
        file_path = sounds_dir / f"{sound_name}{ext}"
        if file_path.exists():
            return _play_file(file_path, audio_player, is_windows)

    # Fallback: try the base event sound (e.g., "pretooluse" if we tried "pretooluse-bash")
    if "-" in sound_name:
        base_name = folder_name  # e.g., "pretooluse"
        for ext in extensions:
            file_path = sounds_dir / f"{base_name}{ext}"
            if file_path.exists():
                return _play_file(file_path, audio_player, is_windows)

    # No sound file found — silent
    return False


def _play_file(file_path, audio_player, is_windows):
    """Low-level: play a single audio file."""
    try:
        if is_windows:
            if winsound:
                winsound.PlaySound(
                    str(file_path),
                    winsound.SND_FILENAME | winsound.SND_NODEFAULT,
                )
                return True
            return False
        else:
            subprocess.Popen(
                audio_player + [str(file_path)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            return True
    except Exception as e:
        _err(f"Error playing {file_path.name}: {e}")
        return False


def detect_bash_command_sound(command):
    """Match a bash command against known patterns for specialized sounds.

    Returns sound name string or None.
    """
    if not command:
        return None
    cmd = command.strip()
    for pattern, sound_name in BASH_PATTERNS:
        if re.search(pattern, cmd, re.IGNORECASE):
            return sound_name
    return None


def resolve_sound_name(hook_data, agent_name=None):
    """Resolve the sound to play using the full fallback chain:

    1. Agent-specific sound (if --agent flag)
    2. Bash command pattern match (PreToolUse + Bash only)
    3. Tool-specific sound (PreToolUse/PostToolUse)
    4. Event-default sound
    """
    event_name = hook_data.get("hook_event_name", "")
    tool_name = hook_data.get("tool_name", "")

    # 1. Agent-specific
    if agent_name:
        return AGENT_HOOK_SOUND_MAP.get(event_name)

    # 2. Bash command patterns (PreToolUse + Bash)
    if event_name == "PreToolUse" and tool_name == "Bash":
        command = hook_data.get("tool_input", {}).get("command", "")
        pattern_sound = detect_bash_command_sound(command)
        if pattern_sound:
            return pattern_sound

    # 3. Tool-specific sounds
    if event_name == "PreToolUse" and tool_name in TOOL_SOUND_MAP:
        return TOOL_SOUND_MAP[tool_name]
    if event_name == "PostToolUse" and tool_name in POST_TOOL_SOUND_MAP:
        return POST_TOOL_SOUND_MAP[tool_name]

    # 4. MCP tool sound (any mcp__* tool gets a generic MCP sound)
    if event_name == "PreToolUse" and tool_name.startswith("mcp__"):
        return "pretooluse-mcp"

    # 5. Event default
    return HOOK_SOUND_MAP.get(event_name)


# ═════════════════════════════════════════════════════════════════════════════
#  NOTIFICATION SYSTEM
# ═════════════════════════════════════════════════════════════════════════════


def send_notification(title, message):
    """Send a desktop notification (best-effort, cross-platform).

    Skipped if notifications are disabled in config.
    """
    if not is_feature_enabled("notifications", default=True):
        return

    system = platform.system()
    try:
        if system == "Windows":
            # PowerShell toast notification (Windows 10+)
            # Escape single quotes in title and message for PowerShell
            safe_title = title.replace("'", "''")
            safe_msg = message.replace("'", "''")
            ps_script = (
                "[Windows.UI.Notifications.ToastNotificationManager, "
                "Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; "
                "$template = [Windows.UI.Notifications.ToastNotificationManager]::"
                "GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::"
                "ToastText02); "
                "$textNodes = $template.GetElementsByTagName('text'); "
                f"$textNodes.Item(0).AppendChild($template.CreateTextNode('{safe_title}')) | Out-Null; "
                f"$textNodes.Item(1).AppendChild($template.CreateTextNode('{safe_msg}')) | Out-Null; "
                "$toast = [Windows.UI.Notifications.ToastNotification]::new($template); "
                "[Windows.UI.Notifications.ToastNotificationManager]::"
                "CreateToastNotifier('Claude Code').Show($toast)"
            )
            subprocess.Popen(
                ["powershell", "-WindowStyle", "Hidden", "-Command", ps_script],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        elif system == "Darwin":
            subprocess.Popen(
                [
                    "osascript", "-e",
                    f'display notification "{message}" with title "{title}"',
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        elif system == "Linux":
            subprocess.Popen(
                ["notify-send", title, message],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
    except Exception as e:
        _err(f"Notification failed: {e}")


# ═════════════════════════════════════════════════════════════════════════════
#  GUARDRAIL SYSTEM  (PreToolUse)
# ═════════════════════════════════════════════════════════════════════════════


def check_guardrails(hook_data):
    """Check if a tool call should be blocked by safety guardrails.

    NOTE: This only works when PreToolUse has "async": false in settings.json.
    With "async": true, stdout output is ignored by Claude Code.

    Returns:
        None if allowed, or dict {"decision": "block", "reason": "..."} to block.
    """
    if not is_feature_enabled("guardrails", default=True):
        return None

    tool_name = hook_data.get("tool_name", "")
    tool_input = hook_data.get("tool_input", {})

    # Check Bash commands
    if tool_name == "Bash":
        command = tool_input.get("command", "")
        for pattern, reason in DANGEROUS_BASH_PATTERNS:
            if re.search(pattern, command, re.IGNORECASE):
                _err(f"GUARDRAIL: {reason} — command: {command[:200]}")
                return {"decision": "block", "reason": reason}

    # Check file write paths (Write, Edit tools)
    if tool_name in ("Write", "Edit"):
        file_path = tool_input.get("file_path", "")
        for pattern, reason in DANGEROUS_WRITE_PATHS:
            if re.search(pattern, file_path, re.IGNORECASE):
                _err(f"GUARDRAIL: {reason} — path: {file_path}")
                return {"decision": "block", "reason": reason}

    return None


# ═════════════════════════════════════════════════════════════════════════════
#  AUTO-CONTEXT SYSTEM  (UserPromptSubmit)
# ═════════════════════════════════════════════════════════════════════════════


def build_auto_context(hook_data):
    """Build auto-context entries to inject when the user submits a prompt.

    NOTE: This only works when UserPromptSubmit has "async": false in settings.

    Returns:
        dict with "autoContext" list, or None if nothing to inject.
    """
    if not is_feature_enabled("autoContext", default=False):
        return None

    context_items = []

    # Git status context
    if get_config_value("autoContextIncludeGitStatus", False):
        git_ctx = _get_git_context()
        if git_ctx:
            context_items.append({
                "type": "text",
                "title": "Git Status",
                "content": git_ctx,
            })

    # Session metrics context
    if get_config_value("autoContextIncludeSessionStats", False):
        metrics = load_metrics()
        if metrics:
            stats_lines = []
            for k, v in metrics.items():
                if k != "tools":
                    stats_lines.append(f"  {k}: {v}")
            if stats_lines:
                context_items.append({
                    "type": "text",
                    "title": "Session Stats",
                    "content": "\n".join(stats_lines),
                })

    if context_items:
        return {"autoContext": context_items}
    return None


def _get_git_context():
    """Get a concise git status summary."""
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain", "--branch"],
            capture_output=True,
            text=True,
            timeout=3,
            cwd=os.environ.get("CLAUDE_PROJECT_DIR"),
        )
        if result.returncode == 0 and result.stdout.strip():
            lines = result.stdout.strip().split("\n")
            branch_line = lines[0] if lines else ""
            changed = len(lines) - 1  # subtract branch line
            return f"{branch_line}\n{changed} file(s) changed"
    except Exception:
        pass
    return None


# ═════════════════════════════════════════════════════════════════════════════
#  HOOK HANDLERS
# ═════════════════════════════════════════════════════════════════════════════


def handle_pre_tool_use(hook_data, agent_name=None):
    """Handle PreToolUse: guardrails → sound → metrics."""
    # Guardrails (output JSON to stdout if blocking — requires async:false)
    block = check_guardrails(hook_data)
    if block:
        # Log the block
        increment_metric("guardrail_blocks")
        # Output block decision to stdout (only effective if async:false)
        print(json.dumps(block))
        return

    # Sound
    sound = resolve_sound_name(hook_data, agent_name)
    if sound and not should_debounce():
        play_sound(sound)

    # Metrics
    tool_name = hook_data.get("tool_name", "")
    increment_metric("pretooluse_count")
    record_tool_metric("PreToolUse", tool_name)


def handle_post_tool_use(hook_data, agent_name=None):
    """Handle PostToolUse: sound → metrics."""
    sound = resolve_sound_name(hook_data, agent_name)
    if sound and not should_debounce():
        play_sound(sound)

    tool_name = hook_data.get("tool_name", "")
    increment_metric("posttooluse_count")
    record_tool_metric("PostToolUse", tool_name)


def handle_post_tool_use_failure(hook_data, agent_name=None):
    """Handle PostToolUseFailure: sound → metrics → notification."""
    sound = resolve_sound_name(hook_data, agent_name)
    if sound:
        play_sound(sound)

    increment_metric("tool_failures")

    tool_name = hook_data.get("tool_name", "")
    error = hook_data.get("tool_error", "unknown error")
    if get_config_value("notifyOnToolFailure", False):
        send_notification(
            "Tool Failed",
            f"{tool_name}: {str(error)[:100]}",
        )


def handle_user_prompt_submit(hook_data, agent_name=None):
    """Handle UserPromptSubmit: auto-context → sound → metrics."""
    # Auto-context injection (only effective if async:false)
    ctx = build_auto_context(hook_data)
    if ctx:
        print(json.dumps(ctx))

    sound = resolve_sound_name(hook_data, agent_name)
    if sound:
        play_sound(sound)

    increment_metric("prompts_submitted")


def handle_notification(hook_data, agent_name=None):
    """Handle Notification: desktop notification → sound."""
    message = hook_data.get("message", "Notification from Claude")

    send_notification("Claude Code", message)

    sound = resolve_sound_name(hook_data, agent_name)
    if sound:
        play_sound(sound)

    increment_metric("notifications")


def handle_session_start(hook_data, agent_name=None):
    """Handle SessionStart: initialize metrics → sound."""
    # Initialize fresh session metrics
    session_id = hook_data.get("session_id", "unknown")
    metrics = {
        "session_id": session_id,
        "session_start": datetime.now(timezone.utc).isoformat(),
        "pretooluse_count": 0,
        "posttooluse_count": 0,
        "tool_failures": 0,
        "guardrail_blocks": 0,
        "prompts_submitted": 0,
        "notifications": 0,
        "compactions": 0,
        "sounds_played": 0,
        "tools": {},
    }
    save_metrics(metrics)

    sound = resolve_sound_name(hook_data, agent_name)
    if sound:
        play_sound(sound)


def handle_session_end(hook_data, agent_name=None):
    """Handle SessionEnd: finalize metrics → notification → sound."""
    # Finalize metrics with end time
    metrics = load_metrics()
    metrics["session_end"] = datetime.now(timezone.utc).isoformat()

    if metrics.get("session_start"):
        try:
            start = datetime.fromisoformat(metrics["session_start"])
            end = datetime.fromisoformat(metrics["session_end"])
            duration = (end - start).total_seconds()
            metrics["session_duration_seconds"] = round(duration, 1)
        except Exception:
            pass

    save_metrics(metrics)

    # Summary notification
    duration = metrics.get("session_duration_seconds", 0)
    tools_used = metrics.get("pretooluse_count", 0)
    failures = metrics.get("tool_failures", 0)
    blocks = metrics.get("guardrail_blocks", 0)

    summary = f"Duration: {_format_duration(duration)} | Tools: {tools_used}"
    if failures:
        summary += f" | Failures: {failures}"
    if blocks:
        summary += f" | Blocked: {blocks}"

    send_notification("Session Ended", summary)

    sound = resolve_sound_name(hook_data, agent_name)
    if sound:
        play_sound(sound)


def handle_pre_compact(hook_data, agent_name=None):
    """Handle PreCompact: log compaction event → sound."""
    increment_metric("compactions")

    sound = resolve_sound_name(hook_data, agent_name)
    if sound:
        play_sound(sound)


def handle_stop(hook_data, agent_name=None):
    """Handle Stop: notification → sound."""
    send_notification("Claude Code", "Claude has stopped")

    sound = resolve_sound_name(hook_data, agent_name)
    if sound:
        play_sound(sound)


def handle_task_completed(hook_data, agent_name=None):
    """Handle TaskCompleted: notification → sound."""
    send_notification("Claude Code", "Task completed!")

    sound = resolve_sound_name(hook_data, agent_name)
    if sound:
        play_sound(sound)


def handle_default(hook_data, agent_name=None):
    """Handle any hook without a specialized handler: sound → metrics."""
    event_name = hook_data.get("hook_event_name", "")

    sound = resolve_sound_name(hook_data, agent_name)
    if sound and not should_debounce():
        play_sound(sound)

    increment_metric(f"{event_name.lower()}_count")


# ─── Handler Dispatch Table ──────────────────────────────────────────────────

HOOK_HANDLERS = {
    "PreToolUse":          handle_pre_tool_use,
    "PostToolUse":         handle_post_tool_use,
    "PostToolUseFailure":  handle_post_tool_use_failure,
    "UserPromptSubmit":    handle_user_prompt_submit,
    "Notification":        handle_notification,
    "SessionStart":        handle_session_start,
    "SessionEnd":          handle_session_end,
    "PreCompact":          handle_pre_compact,
    "Stop":                handle_stop,
    "TaskCompleted":       handle_task_completed,
}

# ═════════════════════════════════════════════════════════════════════════════
#  UTILITIES
# ═════════════════════════════════════════════════════════════════════════════


def _format_duration(seconds):
    """Human-readable duration from seconds."""
    if not seconds or seconds < 0:
        return "0s"
    seconds = int(seconds)
    if seconds < 60:
        return f"{seconds}s"
    minutes = seconds // 60
    secs = seconds % 60
    if minutes < 60:
        return f"{minutes}m{secs:02d}s"
    hours = minutes // 60
    mins = minutes % 60
    return f"{hours}h{mins:02d}m"


# ═════════════════════════════════════════════════════════════════════════════
#  MAIN ENTRY POINT
# ═════════════════════════════════════════════════════════════════════════════


def parse_arguments():
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(
        description="Claude Code Hook Handler — comprehensive event processing"
    )
    parser.add_argument(
        "--agent",
        type=str,
        default=None,
        help="Agent name for agent-specific sounds (used by agent frontmatter hooks)",
    )
    return parser.parse_args()


def main():
    """Main entry point — reads hook event JSON from stdin, dispatches to handler."""
    try:
        args = parse_arguments()

        stdin_content = sys.stdin.read().strip()
        if not stdin_content:
            sys.exit(0)

        hook_data = json.loads(stdin_content)
        event_name = hook_data.get("hook_event_name", "")

        # Validate event name
        if not event_name:
            _err("Hook data missing hook_event_name")
            sys.exit(0)

        # Log all events (with timestamp, rotation)
        log_hook_data(hook_data, agent_name=args.agent)

        # Check if this specific hook is disabled
        if not args.agent and is_hook_disabled(event_name):
            sys.exit(0)

        # Dispatch to specialized handler or default
        handler = HOOK_HANDLERS.get(event_name, handle_default)
        handler(hook_data, agent_name=args.agent)

        sys.exit(0)

    except json.JSONDecodeError as e:
        _err(f"JSON parse error: {e}")
        sys.exit(0)
    except Exception as e:
        _err(f"Unexpected error: {e}")
        sys.exit(0)


if __name__ == "__main__":
    main()
