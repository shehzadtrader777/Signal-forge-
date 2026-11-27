"""
Signal Forge — Secret-Safe Discord Notification Dispatcher (Webhook & Bot REST).

Reads credentials strictly from server-side environment variables
(`DISCORD_WEBHOOK_URL` or `DISCORD_BOT_TOKEN` + `DISCORD_CHANNEL_ID`).
Never accepts or persists plaintext credentials inside repository config files
or CLI arguments.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

DISCORD_WEBHOOK_RE = re.compile(
    r"^https://(?:ptb\.|canary\.)?discord(?:app)?\.com/api/webhooks/[0-9]{15,22}/[A-Za-z0-9_\-]+$"
)
DISCORD_CHANNEL_ID_RE = re.compile(r"^[0-9]{15,22}$")


@dataclass(frozen=True)
class DiscordNotifierConfig:
    enabled: bool = False
    webhook_url_env: str = "DISCORD_WEBHOOK_URL"
    bot_token_env: str = "DISCORD_BOT_TOKEN"
    channel_id_env: str = "DISCORD_CHANNEL_ID"
    timeout_seconds: float = 8.0


class DiscordNotifier:
    """Dispatches sanitized Signal Forge trade & containment alerts to Discord."""

    def __init__(self, config: Optional[DiscordNotifierConfig] = None) -> None:
        self._config = config or DiscordNotifierConfig()

    def _resolve_transport(self) -> Tuple[Optional[str], Optional[Dict[str, str]], str]:
        webhook_url = os.environ.get(self._config.webhook_url_env, "").strip()
        if webhook_url:
            if not DISCORD_WEBHOOK_RE.match(webhook_url):
                return None, None, "INVALID_DISCORD_WEBHOOK_URL"
            return (
                webhook_url,
                {
                    "Content-Type": "application/json",
                    "User-Agent": "SignalForge-Core/1.0",
                },
                "WEBHOOK",
            )

        bot_token = os.environ.get(self._config.bot_token_env, "").strip()
        channel_id = os.environ.get(self._config.channel_id_env, "").strip()
        if bot_token and channel_id:
            if not DISCORD_CHANNEL_ID_RE.match(channel_id):
                return None, None, "INVALID_DISCORD_CHANNEL_ID"
            return (
                f"https://discord.com/api/v10/channels/{channel_id}/messages",
                {
                    "Content-Type": "application/json",
                    "Authorization": f"Bot {bot_token}",
                    "User-Agent": "SignalForge-Core/1.0",
                },
                "BOT_REST",
            )

        return None, None, "UNCONFIGURED"

    def status(self) -> Dict[str, Any]:
        _, _, mode = self._resolve_transport()
        return {
            "enabled": self._config.enabled,
            "transport": mode,
            "configured": mode in ("WEBHOOK", "BOT_REST"),
            "webhook_env": self._config.webhook_url_env,
            "bot_token_env": self._config.bot_token_env,
            "channel_id_env": self._config.channel_id_env,
        }

    def send_alert(self, title: str, body: str, *, dry_run: bool = False) -> Tuple[bool, str]:
        content = f"**{title.strip()[:120]}**\n{body.strip()[:1750]}"
        if not self._config.enabled:
            return False, "DISCORD_NOTIFIER_DISABLED"

        url, headers, mode = self._resolve_transport()
        if not url or not headers:
            return False, f"DISCORD_NOT_READY:{mode}"

        if dry_run:
            return True, f"DRY_RUN_VALIDATED:{mode}"

        payload = json.dumps({"content": content}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=self._config.timeout_seconds) as resp:
                if 200 <= resp.status < 300:
                    return True, f"DISPATCHED:{mode}:{resp.status}"
                return False, f"HTTP_ERROR:{resp.status}"
        except urllib.error.HTTPError as exc:
            return False, f"HTTP_ERROR:{exc.code}"
        except urllib.error.URLError:
            return False, "NETWORK_UNREACHABLE"
