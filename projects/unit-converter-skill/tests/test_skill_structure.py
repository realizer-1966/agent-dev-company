"""Skill structure validation tests — TDD RED phase.

Validates that the Edge AI Gallery skill artifacts (SKILL.md, scripts/index.html,
assets/webview.html) exist and conform to the expected format.
"""

import re
from pathlib import Path

import pytest

# Skill root is <project>/skill/unit-converter/
SKILL_DIR = Path(__file__).resolve().parent.parent / "skill" / "unit-converter"


class TestSkillDirectory:
    def test_skill_dir_exists(self):
        assert SKILL_DIR.is_dir(), f"Skill directory not found: {SKILL_DIR}"

    def test_skill_md_exists(self):
        assert (SKILL_DIR / "SKILL.md").is_file(), "SKILL.md is missing"

    def test_scripts_dir_exists(self):
        assert (SKILL_DIR / "scripts").is_dir(), "scripts/ directory is missing"

    def test_index_html_exists(self):
        assert (SKILL_DIR / "scripts" / "index.html").is_file(), \
            "scripts/index.html is missing"

    def test_assets_dir_exists(self):
        assert (SKILL_DIR / "assets").is_dir(), "assets/ directory is missing"

    def test_webview_html_exists(self):
        assert (SKILL_DIR / "assets" / "webview.html").is_file(), \
            "assets/webview.html is missing"


class TestSkillMd:
    @pytest.fixture(scope="class")
    def skill_md(self):
        path = SKILL_DIR / "SKILL.md"
        if not path.is_file():
            pytest.skip("SKILL.md not yet created")
        return path.read_text(encoding="utf-8")

    def test_has_frontmatter(self, skill_md):
        assert skill_md.startswith("---"), "SKILL.md must start with --- frontmatter"

    def test_has_name(self, skill_md):
        # Extract frontmatter
        match = re.match(r'^---\n(.*?)\n---', skill_md, re.DOTALL)
        assert match, "No frontmatter block found"
        frontmatter = match.group(1)
        assert re.search(r'^name:\s*unit-converter', frontmatter, re.MULTILINE), \
            "Frontmatter must contain 'name: unit-converter'"

    def test_has_description(self, skill_md):
        match = re.match(r'^---\n(.*?)\n---', skill_md, re.DOTALL)
        assert match
        frontmatter = match.group(1)
        assert re.search(r'^description:\s*\S', frontmatter, re.MULTILINE), \
            "Frontmatter must contain a description"

    def test_mentions_run_js(self, skill_md):
        assert "run_js" in skill_md, "SKILL.md must instruct the LLM to call run_js"

    def test_mentions_categories(self, skill_md):
        # Should mention at least temperature and length
        assert "temperature" in skill_md.lower()
        assert "length" in skill_md.lower()


class TestIndexHtml:
    @pytest.fixture(scope="class")
    def index_html(self):
        path = SKILL_DIR / "scripts" / "index.html"
        if not path.is_file():
            pytest.skip("scripts/index.html not yet created")
        return path.read_text(encoding="utf-8")

    def test_has_entry_function(self, index_html):
        assert "ai_edge_gallery_get_result" in index_html, \
            "index.html must define window['ai_edge_gallery_get_result']"

    def test_returns_json_string(self, index_html):
        assert "JSON.stringify" in index_html, \
            "index.html must return JSON.stringify(...)"

    def test_has_error_handling(self, index_html):
        assert "error" in index_html.lower(), \
            "index.html must handle errors and return error field"

    def test_parses_data(self, index_html):
        assert "JSON.parse" in index_html, \
            "index.html must parse the incoming data string"


class TestWebviewHtml:
    @pytest.fixture(scope="class")
    def webview_html(self):
        path = SKILL_DIR / "assets" / "webview.html"
        if not path.is_file():
            pytest.skip("assets/webview.html not yet created")
        return path.read_text(encoding="utf-8")

    def test_is_valid_html(self, webview_html):
        assert "<html" in webview_html.lower() or "<!DOCTYPE" in webview_html.upper()
        assert "</html>" in webview_html.lower()

    def test_has_interactive_elements(self, webview_html):
        # Should have input fields for value and unit selection
        assert "<input" in webview_html.lower() or "<select" in webview_html.lower()

    def test_has_javascript(self, webview_html):
        assert "<script" in webview_html.lower(), \
            "webview.html must contain JavaScript for interactivity"