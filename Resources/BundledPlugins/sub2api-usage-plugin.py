#!/usr/bin/env python3
# UsageBoardPlugin:
# {
#   "name": "SubAPI",
#   "name@zh-Hans": "SubAPI",
#   "name@en": "SubAPI",
#   "icon": "https://raw.githubusercontent.com/Wei-Shaw/sub2api/main/assets/logo.svg",
#   "description": "自动获取 SubAPI 平台消费、请求、Token 和日/周/月配额",
#   "description@zh-Hans": "自动获取 SubAPI 平台消费、请求、Token 和日/周/月配额",
#   "description@en": "Automatically fetch SubAPI spending, requests, tokens, and daily/weekly/monthly quotas",
#   "parameters": [
#     {"name":"BASE_URL","label":"平台地址","label@zh-Hans":"平台地址","label@en":"Server URL","type":"string","required":true,"defaultValue":"http://localhost:8080","placeholder":"https://sub2api.example.com"},
#     {"name":"ACCESS_TOKEN","label":"访问令牌","label@zh-Hans":"访问令牌","label@en":"Access token","type":"secret","required":false,"placeholder":"JWT（推荐，留空则使用邮箱密码）","placeholder@en":"JWT (recommended; leave blank to use email/password)"},
#     {"name":"EMAIL","label":"邮箱","label@zh-Hans":"邮箱","label@en":"Email","type":"string","required":false,"placeholder":"未填写令牌时使用"},
#     {"name":"PASSWORD","label":"密码","label@zh-Hans":"密码","label@en":"Password","type":"secret","required":false,"placeholder":"未填写令牌时使用"},
#     {"name":"DISPLAY_EMPTY_MODULES","label":"显示空模块","label@zh-Hans":"显示空模块","label@en":"Show empty modules","type":"boolean","required":false,"defaultValue":"false"},
#     {"name":"DISPLAY_ANTHROPIC","label":"显示 Claude","label@zh-Hans":"显示 Claude","label@en":"Show Claude","type":"boolean","required":false,"defaultValue":"true"},
#     {"name":"DISPLAY_OPENAI","label":"显示 OpenAI","label@zh-Hans":"显示 OpenAI","label@en":"Show OpenAI","type":"boolean","required":false,"defaultValue":"true"},
#     {"name":"DISPLAY_GEMINI","label":"显示 Gemini","label@zh-Hans":"显示 Gemini","label@en":"Show Gemini","type":"boolean","required":false,"defaultValue":"true"},
#     {"name":"DISPLAY_ANTIGRAVITY","label":"显示 Antigravity","label@zh-Hans":"显示 Antigravity","label@en":"Show Antigravity","type":"boolean","required":false,"defaultValue":"true"},
#     {"name":"DISPLAY_GROK","label":"显示 grok","label@zh-Hans":"显示 grok","label@en":"Show grok","type":"boolean","required":false,"defaultValue":"true"},
#     {"name":"DISPLAY_OTHER","label":"显示其他平台","label@zh-Hans":"显示其他平台","label@en":"Show other platforms","type":"boolean","required":false,"defaultValue":"true"}
#   ]
# }
# /UsageBoardPlugin

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from _common import color_for, failure, make_translator, numeric, parse_usageboard_params, utc_now_iso


TRANSLATIONS = {
    "missing_auth": {"zh-Hans": "请填写访问令牌，或填写 SubAPI 邮箱和密码", "en": "Enter an access token or your SubAPI email and password."},
    "invalid_url": {"zh-Hans": "平台地址必须以 http:// 或 https:// 开头", "en": "Server URL must start with http:// or https://."},
    "login_failed": {"zh-Hans": "SubAPI 登录失败：{message}", "en": "SubAPI login failed: {message}"},
    "two_factor": {"zh-Hans": "该账号启用了两步验证，请在 SubAPI 网页登录后填写访问令牌", "en": "This account uses 2FA. Sign in on the SubAPI website and enter an access token."},
    "api_failed": {"zh-Hans": "SubAPI 请求失败：{message}", "en": "SubAPI request failed: {message}"},
    "daily": {"zh-Hans": "日", "en": "Day"},
    "weekly": {"zh-Hans": "周", "en": "Week"},
    "monthly": {"zh-Hans": "月（近30天）", "en": "Month (30 days)"},
    "other": {"zh-Hans": "其他", "en": "Other"},
}
translate = make_translator(TRANSLATIONS)

PLATFORM_LABELS = {
    "anthropic": "Claude",
    "openai": "OpenAI",
    "gemini": "Gemini",
    "antigravity": "Antigravity",
    "grok": "grok",
}
PLATFORM_ORDER = ("anthropic", "openai", "gemini", "antigravity", "grok")
PLATFORM_DISPLAY_PARAMETERS = {
    "anthropic": "DISPLAY_ANTHROPIC",
    "openai": "DISPLAY_OPENAI",
    "gemini": "DISPLAY_GEMINI",
    "antigravity": "DISPLAY_ANTIGRAVITY",
    "grok": "DISPLAY_GROK",
    "other": "DISPLAY_OTHER",
}


class Sub2APIError(Exception):
    pass


def normalize_api_base(value: str) -> str:
    base = value.strip().rstrip("/")
    parsed = urllib.parse.urlparse(base)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise Sub2APIError("INVALID_URL")
    return base if base.endswith("/api/v1") else base + "/api/v1"


def unwrap_response(payload: Any) -> Any:
    if isinstance(payload, dict) and "code" in payload:
        if payload.get("code") != 0:
            raise Sub2APIError(str(payload.get("message") or "Unknown API error"))
        return payload.get("data")
    return payload


def api_request(api_base: str, path: str, token: str | None = None, data: dict[str, Any] | None = None) -> Any:
    body = json.dumps(data).encode("utf-8") if data is not None else None
    headers = {"Accept": "application/json", "Accept-Language": "zh-CN,en;q=0.8"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(api_base + path, data=body, headers=headers, method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return unwrap_response(json.loads(response.read().decode("utf-8")))
    except urllib.error.HTTPError as error:
        try:
            payload = json.loads(error.read().decode("utf-8"))
            message = payload.get("message") or payload.get("error") or f"HTTP {error.code}"
        except (ValueError, UnicodeDecodeError):
            message = f"HTTP {error.code}"
        raise Sub2APIError(str(message)) from error
    except urllib.error.URLError as error:
        raise Sub2APIError(str(error.reason)) from error
    except (TimeoutError, json.JSONDecodeError) as error:
        raise Sub2APIError(str(error) or "Invalid response") from error


def authenticate(api_base: str, params: dict[str, str], language: str) -> str:
    token = params.get("ACCESS_TOKEN", "").strip()
    if token:
        return token
    email = params.get("EMAIL", "").strip()
    password = params.get("PASSWORD", "")
    if not email or not password:
        raise Sub2APIError(translate(language, "missing_auth"))
    try:
        result = api_request(api_base, "/auth/login", data={"email": email, "password": password})
    except Sub2APIError as error:
        raise Sub2APIError(translate(language, "login_failed", message=str(error))) from error
    if isinstance(result, dict) and result.get("requires_2fa"):
        raise Sub2APIError(translate(language, "two_factor"))
    token = result.get("access_token") if isinstance(result, dict) else None
    if not isinstance(token, str) or not token.strip():
        raise Sub2APIError(translate(language, "login_failed", message="missing access token"))
    return token.strip()


def platform_sort_key(platform: str) -> tuple[int, str]:
    try:
        return PLATFORM_ORDER.index(platform), platform
    except ValueError:
        return len(PLATFORM_ORDER), platform


def build_platform_cards(stats: Any, quota_payload: Any, language: str) -> list[dict[str, Any]]:
    stats = stats if isinstance(stats, dict) else {}
    by_platform: dict[str, dict[str, Any]] = {}
    for entry in stats.get("by_platform", []):
        if not isinstance(entry, dict):
            continue
        platform = str(entry.get("platform") or "").strip().lower()
        if platform:
            by_platform[platform] = entry

    quotas: dict[str, dict[str, Any]] = {}
    raw_quotas = quota_payload.get("platform_quotas", []) if isinstance(quota_payload, dict) else []
    for entry in raw_quotas if isinstance(raw_quotas, list) else []:
        if not isinstance(entry, dict):
            continue
        platform = str(entry.get("platform") or "").strip().lower()
        if platform:
            quotas[platform] = entry

    cards: list[dict[str, Any]] = []
    for platform in sorted(set(by_platform) | set(quotas), key=platform_sort_key):
        stat = by_platform.get(platform, {})
        quota = quotas.get(platform, {})
        windows: list[dict[str, Any]] = []
        for window in ("daily", "weekly", "monthly"):
            raw_limit = quota.get(f"{window}_limit_usd")
            if raw_limit is None:
                continue
            used = max(0.0, numeric(quota.get(f"{window}_usage_usd")))
            limit = max(0.0, numeric(raw_limit))
            windows.append({
                "id": window,
                "label": translate(language, window),
                "used": round(used, 4),
                "limit": round(limit, 4),
                "color": "red" if limit == 0 else color_for(used, limit),
                "resetAt": quota.get(f"{window}_window_resets_at"),
                "disabled": limit == 0,
            })
        cards.append({
            "id": platform,
            "name": PLATFORM_LABELS.get(platform, platform),
            "totalActualCost": round(numeric(stat.get("total_actual_cost")), 4),
            "todayActualCost": round(numeric(stat.get("today_actual_cost")), 4),
            "totalRequests": int(numeric(stat.get("total_requests"))),
            "totalTokens": int(numeric(stat.get("total_tokens"))),
            "quotas": windows,
        })

    accounted_total = sum(card["totalActualCost"] for card in cards)
    accounted_today = sum(card["todayActualCost"] for card in cards)
    other_total = max(0.0, numeric(stats.get("total_actual_cost")) - accounted_total)
    other_today = max(0.0, numeric(stats.get("today_actual_cost")) - accounted_today)
    if other_total > 0.0001 or other_today > 0.0001:
        cards.append({
            "id": "other",
            "name": translate(language, "other"),
            "totalActualCost": round(other_total, 4),
            "todayActualCost": round(other_today, 4),
            "totalRequests": 0,
            "totalTokens": 0,
            "quotas": [],
        })
    return cards


def boolean_parameter(params: dict[str, str], name: str, default: bool) -> bool:
    raw = params.get(name)
    if raw is None or not str(raw).strip():
        return default
    return str(raw).strip().lower() in ("1", "true", "yes", "on")


def card_has_data(card: dict[str, Any]) -> bool:
    return any((
        numeric(card.get("totalActualCost")) > 0,
        numeric(card.get("todayActualCost")) > 0,
        numeric(card.get("totalRequests")) > 0,
        numeric(card.get("totalTokens")) > 0,
        bool(card.get("quotas")),
    ))


def filter_platform_cards(cards: list[dict[str, Any]], params: dict[str, str]) -> list[dict[str, Any]]:
    show_empty = boolean_parameter(params, "DISPLAY_EMPTY_MODULES", False)
    visible = []
    for card in cards:
        display_parameter = PLATFORM_DISPLAY_PARAMETERS.get(str(card.get("id") or ""))
        if display_parameter and not boolean_parameter(params, display_parameter, True):
            continue
        if not show_empty and not card_has_data(card):
            continue
        visible.append(card)
    return visible


def output_success(cards: list[dict[str, Any]], balance: float) -> int:
    legacy_items = []
    for card in cards:
        for quota in card.get("quotas", []):
            legacy_items.append({
                "id": f"{card['id']}-{quota['id']}",
                "name": f"{card['name']} · {quota['label']}",
                "used": quota["used"],
                "limit": quota["limit"],
                "displayStyle": "ratio",
                "color": quota["color"],
                "resetAt": quota.get("resetAt"),
            })
    result = {
        "schemaVersion": 1,
        "updatedAt": utc_now_iso(),
        "items": legacy_items,
        "platformCards": cards,
        "badge": f"${balance:.2f}",
        "badgeColor": "green" if balance > 0 else "gray",
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0


def main() -> int:
    params = parse_usageboard_params(sys.argv[1:])
    language = "en" if params.get("USAGEBOARD_LANGUAGE") == "en" else "zh-Hans"
    try:
        api_base = normalize_api_base(params.get("BASE_URL", ""))
    except Sub2APIError:
        return failure(translate(language, "invalid_url"))
    try:
        token = authenticate(api_base, params, language)
        stats = api_request(api_base, "/usage/dashboard/stats", token=token)
        profile = api_request(api_base, "/user/profile", token=token)
        try:
            quota_payload = api_request(api_base, "/user/platform-quotas", token=token)
        except Sub2APIError:
            quota_payload = {}
    except Sub2APIError as error:
        return failure(translate(language, "api_failed", message=str(error)))

    balance = numeric(profile.get("balance")) if isinstance(profile, dict) else 0
    cards = build_platform_cards(stats, quota_payload, language)
    return output_success(filter_platform_cards(cards, params), balance)


if __name__ == "__main__":
    sys.exit(main())
