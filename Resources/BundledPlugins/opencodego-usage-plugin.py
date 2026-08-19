#!/usr/bin/env python3
# UsageBoardPlugin:
# {
#   "schemaVersion": 1,
#   "name": "OpenCodeGo Plan",
#   "name@zh-Hans": "OpenCodeGo Plan",
#   "name@en": "OpenCodeGo Plan",
#   "icon": "https://opencode.ai/favicon.ico",
#   "description": "查询 OpenCode Go 套餐的 5 小时、周和月用量",
#   "description@zh-Hans": "查询 OpenCode Go 套餐的 5 小时、周和月用量",
#   "description@en": "Query OpenCode Go rolling, weekly, and monthly plan usage",
#   "parameters": [
#     {"name":"API_KEY","label":"Plan API Key","label@zh-Hans":"Plan API Key","label@en":"Plan API Key","type":"secret","required":true,"placeholder":"OPENCODE_GO_API_KEY"},
#     {"name":"BASE_URL","label":"平台地址","label@zh-Hans":"平台地址","label@en":"Server URL","type":"string","required":true,"defaultValue":"https://opencode.ai","placeholder":"https://opencode.ai"}
#   ]
# }
# /UsageBoardPlugin

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from _common import (  # noqa: E402
    app_language,
    color_for_pct,
    failure,
    handle_http_error,
    handle_url_error,
    make_translator,
    numeric,
    parse_usageboard_params,
    status_for,
    success,
)


TRANSLATIONS = {
    "rolling": {"zh-Hans": "5 小时用量", "en": "5-hour usage"},
    "weekly": {"zh-Hans": "周用量", "en": "Weekly usage"},
    "monthly": {"zh-Hans": "月用量", "en": "Monthly usage"},
    "invalid_url": {"zh-Hans": "平台地址必须以 http:// 或 https:// 开头", "en": "Server URL must start with http:// or https://."},
    "malformed": {"zh-Hans": "OpenCodeGo 返回了无效的套餐用量数据", "en": "OpenCodeGo returned malformed plan usage data."},
}
translate = make_translator(TRANSLATIONS)


def usage_url(value: str) -> str:
    base = value.strip().rstrip("/")
    parsed = urllib.parse.urlparse(base)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("invalid URL")
    if parsed.path.rstrip("/").endswith("/zen/go/v1/usage"):
        return base
    if parsed.path.rstrip("/").endswith("/zen/go/v1"):
        return base + "/usage"
    origin = f"{parsed.scheme}://{parsed.netloc}"
    return origin + "/zen/go/v1/usage"


def fetch_usage(base_url: str, api_key: str) -> dict[str, Any]:
    request = urllib.request.Request(
        usage_url(base_url),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "User-Agent": "Pulse/0.1.40",
        },
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        payload = json.loads(response.read().decode("utf-8"))
    usage = payload.get("usage") if isinstance(payload, dict) else None
    if not isinstance(usage, dict):
        raise ValueError("missing usage")
    return usage


def build_items(usage: dict[str, Any], language: str) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for window_name in ("rolling", "weekly", "monthly"):
        window = usage.get(window_name)
        if not isinstance(window, dict) or not isinstance(window.get("percent"), (int, float)):
            raise ValueError(f"malformed {window_name} window")
        percent = max(0.0, numeric(window.get("percent")))
        item = {
            "id": f"opencodego-{window_name}",
            "name": translate(language, window_name),
            "used": percent,
            "limit": 100,
            "displayStyle": "percent",
            "status": status_for(percent, 100),
            "color": color_for_pct(percent),
        }
        reset_at = window.get("resetsAt")
        if isinstance(reset_at, str) and reset_at.strip():
            item["resetAt"] = reset_at.strip()
        output.append(item)
    return output


def main() -> int:
    params = parse_usageboard_params(sys.argv[1:])
    language = app_language(params)
    api_key = params.get("API_KEY", "").strip()
    if not api_key:
        return failure(translate(language, "missing_api_key"))
    try:
        endpoint = usage_url(params.get("BASE_URL", "https://opencode.ai"))
    except ValueError:
        return failure(translate(language, "invalid_url"))
    try:
        usage = fetch_usage(endpoint, api_key)
        items = build_items(usage, language)
    except urllib.error.HTTPError as error:
        return handle_http_error(error, translate, language)
    except urllib.error.URLError as error:
        return handle_url_error(error, translate, language)
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return failure(translate(language, "malformed"))
    return success(items, badge="Go Plan", badgeColor="green")


if __name__ == "__main__":
    sys.exit(main())
