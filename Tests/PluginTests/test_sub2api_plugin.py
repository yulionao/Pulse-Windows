"""Tests for the Sub2API bundled plugin."""

import importlib.util
import json
import sys
import unittest
from io import StringIO
from pathlib import Path
from unittest.mock import patch


PLUGIN_PATH = Path(__file__).parent.parent.parent / "Resources" / "BundledPlugins" / "sub2api-usage-plugin.py"


def load_plugin():
    plugin_dir = str(PLUGIN_PATH.parent)
    if plugin_dir not in sys.path:
        sys.path.insert(0, plugin_dir)
    spec = importlib.util.spec_from_file_location("sub2api_plugin", PLUGIN_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


plugin = load_plugin()


class TestSub2APIPlugin(unittest.TestCase):
    def test_normalizes_server_url(self):
        self.assertEqual(plugin.normalize_api_base("https://example.com/"), "https://example.com/api/v1")
        self.assertEqual(plugin.normalize_api_base("https://example.com/api/v1"), "https://example.com/api/v1")
        with self.assertRaises(plugin.Sub2APIError):
            plugin.normalize_api_base("example.com")

    def test_unwraps_standard_response(self):
        self.assertEqual(plugin.unwrap_response({"code": 0, "data": {"ok": True}}), {"ok": True})
        with self.assertRaises(plugin.Sub2APIError):
            plugin.unwrap_response({"code": 1, "message": "denied"})

    def test_token_login_builds_automatic_platform_cards(self):
        def fake_request(_base, path, token=None, data=None):
            self.assertEqual(token, "jwt-token")
            if path == "/usage/dashboard/stats":
                return {
                    "total_actual_cost": 115.1664,
                    "today_actual_cost": 44.2629,
                    "by_platform": [{
                        "platform": "openai",
                        "total_actual_cost": 115.1664,
                        "today_actual_cost": 44.2629,
                        "total_requests": 1422,
                        "total_tokens": 127300000,
                    }],
                }
            if path == "/user/profile":
                return {"balance": 1872.11}
            if path == "/user/platform-quotas":
                return {"platform_quotas": [{
                    "platform": "openai",
                    "daily_limit_usd": 100,
                    "weekly_limit_usd": 500,
                    "monthly_limit_usd": 2000,
                    "daily_usage_usd": 44.26,
                    "weekly_usage_usd": 108.44,
                    "monthly_usage_usd": 115.17,
                    "daily_window_resets_at": "2026-08-20T00:00:00+08:00",
                    "weekly_window_resets_at": "2026-08-24T00:00:00+08:00",
                    "monthly_window_resets_at": "2026-09-14T13:08:00+08:00",
                }]}
            raise AssertionError(path)

        argv = [
            "sub2api-usage-plugin.py",
            "--usageboard-param", "BASE_URL=https://sub.example.com",
            "--usageboard-param", "ACCESS_TOKEN=jwt-token",
            "--usageboard-param", "USAGEBOARD_LANGUAGE=en",
        ]
        with patch.object(plugin, "api_request", side_effect=fake_request), patch("sys.argv", argv), patch("sys.stdout", new_callable=StringIO) as output:
            self.assertEqual(plugin.main(), 0)
            result = json.loads(output.getvalue())

        self.assertEqual(result["badge"], "$1872.11")
        self.assertEqual(len(result["items"]), 3)
        self.assertEqual(result["items"][0]["name"], "OpenAI · Day")
        self.assertNotIn("chart", result)
        card = result["platformCards"][0]
        self.assertEqual(card["name"], "OpenAI")
        self.assertEqual(card["totalRequests"], 1422)
        self.assertEqual(card["totalTokens"], 127300000)
        self.assertEqual([quota["id"] for quota in card["quotas"]], ["daily", "weekly", "monthly"])
        self.assertEqual(card["quotas"][0]["used"], 44.26)
        self.assertEqual(card["quotas"][0]["limit"], 100)
        self.assertEqual(card["quotas"][2]["label"], "Month (30 days)")

    def test_platform_cards_include_quota_only_platforms_and_other_usage(self):
        stats = {
            "total_actual_cost": 12,
            "today_actual_cost": 3,
            "by_platform": [{"platform": "openai", "total_actual_cost": 10, "today_actual_cost": 2}],
        }
        quotas = {"platform_quotas": [{
            "platform": "anthropic",
            "daily_limit_usd": 10,
            "daily_usage_usd": 1,
            "weekly_limit_usd": None,
            "monthly_limit_usd": None,
        }]}

        cards = plugin.build_platform_cards(stats, quotas, "zh-Hans")

        self.assertEqual([card["id"] for card in cards], ["anthropic", "openai", "other"])
        self.assertEqual(cards[0]["quotas"][0]["label"], "日")
        self.assertEqual(cards[2]["totalActualCost"], 2)
        self.assertEqual(cards[2]["todayActualCost"], 1)

    def test_platform_module_filters_hide_empty_and_disabled_cards(self):
        cards = [
            {"id": "anthropic", "name": "Claude", "totalActualCost": 0, "todayActualCost": 0, "totalRequests": 0, "totalTokens": 0, "quotas": []},
            {"id": "openai", "name": "OpenAI", "totalActualCost": 10, "todayActualCost": 2, "totalRequests": 3, "totalTokens": 4, "quotas": []},
            {"id": "gemini", "name": "Gemini", "totalActualCost": 0, "todayActualCost": 0, "totalRequests": 0, "totalTokens": 0, "quotas": [{"id": "daily"}]},
        ]

        filtered = plugin.filter_platform_cards(cards, {})
        self.assertEqual([card["id"] for card in filtered], ["openai", "gemini"])

        filtered = plugin.filter_platform_cards(cards, {"DISPLAY_OPENAI": "false"})
        self.assertEqual([card["id"] for card in filtered], ["gemini"])

        filtered = plugin.filter_platform_cards(cards, {"DISPLAY_EMPTY_MODULES": "true", "DISPLAY_GEMINI": "false"})
        self.assertEqual([card["id"] for card in filtered], ["anthropic", "openai"])

    def test_email_login_rejects_two_factor(self):
        with patch.object(plugin, "api_request", return_value={"requires_2fa": True}):
            with self.assertRaisesRegex(plugin.Sub2APIError, "2FA"):
                plugin.authenticate("https://example.com/api/v1", {"EMAIL": "a@example.com", "PASSWORD": "secret"}, "en")


if __name__ == "__main__":
    unittest.main()
