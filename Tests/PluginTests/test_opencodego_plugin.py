"""Tests for the OpenCodeGo bundled plugin."""

import importlib.util
import json
import sys
import unittest
from io import StringIO
from pathlib import Path
from unittest.mock import patch


PLUGIN_PATH = Path(__file__).parent.parent.parent / "Resources" / "BundledPlugins" / "opencodego-usage-plugin.py"


def load_plugin():
    plugin_dir = str(PLUGIN_PATH.parent)
    if plugin_dir not in sys.path:
        sys.path.insert(0, plugin_dir)
    spec = importlib.util.spec_from_file_location("opencodego_plugin", PLUGIN_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


plugin = load_plugin()


class TestOpenCodeGoPlugin(unittest.TestCase):
    def test_normalizes_official_usage_url(self):
        expected = "https://opencode.ai/zen/go/v1/usage"
        self.assertEqual(plugin.usage_url("https://opencode.ai"), expected)
        self.assertEqual(plugin.usage_url("https://opencode.ai/zen/go/v1"), expected)
        self.assertEqual(plugin.usage_url(expected), expected)
        with self.assertRaises(ValueError):
            plugin.usage_url("opencode.ai")

    def test_builds_all_plan_windows(self):
        items = plugin.build_items({
            "rolling": {"status": "ok", "percent": 8, "resetsAt": "2026-08-19T18:00:00Z"},
            "weekly": {"status": "ok", "percent": 62, "resetsAt": "2026-08-24T00:00:00Z"},
            "monthly": {"status": "warn", "percent": 91, "resetsAt": "2026-09-01T00:00:00Z"},
        }, "zh-Hans")
        self.assertEqual([item["id"] for item in items], [
            "opencodego-rolling", "opencodego-weekly", "opencodego-monthly",
        ])
        self.assertEqual(items[0]["name"], "5 小时用量")
        self.assertEqual(items[1]["color"], "yellow")
        self.assertEqual(items[2]["status"], "critical")

    def test_main_outputs_plan_badge(self):
        usage = {
            "rolling": {"status": "ok", "percent": 1},
            "weekly": {"status": "ok", "percent": 12},
            "monthly": {"status": "ok", "percent": 35},
        }
        argv = ["opencodego-usage-plugin.py", "--usageboard-param", "API_KEY=secret"]
        with patch("sys.argv", argv), patch.object(plugin, "fetch_usage", return_value=usage), patch("sys.stdout", new_callable=StringIO) as output:
            self.assertEqual(plugin.main(), 0)
        result = json.loads(output.getvalue())
        self.assertEqual(result["badge"], "Go Plan")
        self.assertEqual(len(result["items"]), 3)

    def test_missing_key_outputs_error(self):
        with patch("sys.argv", ["opencodego-usage-plugin.py"]), patch("sys.stdout", new_callable=StringIO) as output:
            self.assertEqual(plugin.main(), 0)
        self.assertIn("error", json.loads(output.getvalue()))


if __name__ == "__main__":
    unittest.main()
