"""
otterwiki-wysiwyg: a visual (WYSIWYG) editor for An Otter Wiki.

The plugin adds a "visual editor" mode to the page editor. Pages stay
Markdown files in the wiki's git repository: the visual editor reads and
writes the wiki's own Markdown dialect, and leaves every block you did not
edit byte for byte as it was.

The browser side is built from frontend/ into static/: the editor
(wysiwyg.js, wysiwyg.css) injected into the page editor only, and, with the
WYSIWYG_SECTION_EDIT option, the section links (sections.js, sections.css)
injected into the pages being read.
"""

import json
import os
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

from flask import Blueprint, request

from otterwiki.plugins import hookimpl, plugin_manager

try:
    __version__ = version("otterwiki-wysiwyg")
except PackageNotFoundError:  # running from a source checkout
    __version__ = "0.0.0"

STATIC_DIR = Path(__file__).parent / "static"
URL_PREFIX = "/-/wysiwyg"


# Options, in the wiki's settings.cfg or as environment variables. The wiki
# itself only reads its own keys from the environment, so both are read here.
OPTIONS = {
    # pencil links on the headings of a page, to edit one section at a time
    "WYSIWYG_SECTION_EDIT": False,
}


def option(app, key):
    default = OPTIONS[key]
    value = app.config.get(key, os.environ.get(key, default))
    if isinstance(default, bool) and isinstance(value, str):
        return value.strip().lower() in ("true", "1", "on", "yes")
    return value


def is_editor_request():
    """The page editor: /<page>/edit, or a page opened with ?edit."""
    try:
        return request.endpoint == "edit" or "edit" in request.args
    except RuntimeError:  # outside of a request
        return False


def is_page_view():
    """A wiki page being read (the home page included), not one being edited."""
    try:
        return request.endpoint in ("view", "index") and not is_editor_request()
    except RuntimeError:
        return False


class WysiwygPlugin:
    def __init__(self):
        self.options = dict(OPTIONS)

    def asset(self, name):
        return f"{request.script_root}{URL_PREFIX}/static/{name}?v={__version__}"

    @hookimpl
    def setup(self, app, db, storage):
        self.options = {key: option(app, key) for key in OPTIONS}
        # static files of the plugin, versioned in the URL to defeat caches
        bp = Blueprint(
            "otterwiki_wysiwyg",
            __name__,
            static_folder=str(STATIC_DIR),
            static_url_path="/static",
        )
        app.register_blueprint(bp, url_prefix=URL_PREFIX)

    def client_config(self):
        config = {"sectionEdit": bool(self.options["WYSIWYG_SECTION_EDIT"])}
        # </ cannot end the script: json.dumps does not escape "/"
        return json.dumps(config).replace("</", "<\\/")

    @hookimpl
    def template_html_head_inject(self, page):
        if is_editor_request():
            return f'<link rel="stylesheet" href="{self.asset("wysiwyg.css")}">'
        if is_page_view() and self.options["WYSIWYG_SECTION_EDIT"]:
            return f'<link rel="stylesheet" href="{self.asset("sections.css")}">'
        return None

    @hookimpl
    def template_html_body_inject(self, page):
        config = f"<script>window.otterwiki_wysiwyg = {self.client_config()};</script>"
        if is_editor_request():
            return f'{config}<script src="{self.asset("wysiwyg.js")}" defer></script>'
        # a page being read: the section links only (a small script, not the editor)
        if is_page_view() and self.options["WYSIWYG_SECTION_EDIT"]:
            return f'{config}<script src="{self.asset("sections.js")}" defer></script>'
        return None

    @hookimpl
    def info(self):
        return (
            "otterwiki-wysiwyg",
            "Visual (WYSIWYG) editor, pages stay Markdown.",
            "Editor",
        )

    @hookimpl
    def help(self, plugin):
        if plugin != "otterwiki-wysiwyg":
            return None
        text = (
            "The page editor has two tabs. **Visual** edits the page as it "
            "will look, and saves it as Markdown. **Markdown** is the "
            "Markdown editor, with a check of the Markdown under it: click a "
            "problem to go to its line. Your browser remembers the tab you "
            "used last.\n\n"
            "Blocks you do not change are saved exactly as they were. Syntax "
            "the visual editor does not show as such (math, embeddings, "
            "footnotes, abbreviations, HTML...) is kept in grey "
            "*Markdown* boxes, editable as source."
        )
        if self.options["WYSIWYG_SECTION_EDIT"]:
            text += (
                "\n\nThe pencil next to a heading of a page (shown when the "
                "mouse is over it) edits that section only."
            )
        return text


plugin_manager.register(WysiwygPlugin())
