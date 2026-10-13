"""Pruebas del resumen semanal sin red: python3 -m unittest tools/digest/test_digest.py"""

import datetime as dt
import sys
import tomllib
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import digest  # noqa: E402

REPO = Path(__file__).resolve().parents[2]

ATOM = b"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><title>v3.6.0</title><link rel="alternate" href="https://github.com/traefik/traefik/releases/tag/v3.6.0"/>
    <updated>2026-10-15T10:00:00Z</updated><content type="html">&lt;p&gt;New &lt;b&gt;feature&lt;/b&gt;&lt;/p&gt;</content></entry>
  <entry><title>v3.6.0-rc1</title><link rel="alternate" href="https://github.com/traefik/traefik/releases/tag/v3.6.0-rc1"/>
    <updated>2026-10-16T10:00:00Z</updated><content type="html">rc</content></entry>
  <entry><title>v3.5.9</title><link rel="alternate" href="https://github.com/traefik/traefik/releases/tag/v3.5.9"/>
    <updated>2026-09-01T10:00:00Z</updated><content type="html">old</content></entry>
</feed>"""

RSS = b"""<?xml version="1.0"?><rss version="2.0"><channel>
  <item><title>RouterOS 7.24.5 [stable]</title><link>https://mikrotik.com/download?v=7.24.5</link>
  <pubDate>Wed, 14 Oct 2026 09:00:00 +0000</pubDate><description>Fixes &amp; security</description></item>
</channel></rss>"""


def fake_item(unit="traefik", kind="release", score=2, date="2026-10-15T10:00:00+00:00", src="Traefik"):
    it = digest.item(kind, {"name": src, "unit": unit, "tech": ["traefik"]}, "v3.6.0",
                     "https://github.com/traefik/traefik/releases/tag/v3.6.0", date, "notas", score)
    for lang in ("es", "en"):
        it[lang] = {"title": "Traefik 3.6 trae «algo» nuevo", "what": 'Sale con "comillas" y \\ barras.',
                    "means": "Es la puerta de entrada.", "idea": "Leer las notas antes de actualizar."}
    return it


class Feeds(unittest.TestCase):
    def test_atom(self):
        e = digest.parse_feed(ATOM)
        self.assertEqual(len(e), 3)
        self.assertEqual(e[0]["text"], "New feature")
        self.assertEqual(e[0]["date"].year, 2026)

    def test_rss(self):
        e = digest.parse_feed(RSS)
        self.assertEqual(e[0]["title"], "RouterOS 7.24.5 [stable]")
        self.assertEqual(e[0]["text"], "Fixes & security")

    def test_prereleases_are_skipped(self):
        self.assertTrue(digest.PRERELEASE.search("v3.6.0-rc1"))
        self.assertTrue(digest.PRERELEASE.search("2.0.0 beta 3"))
        self.assertTrue(digest.PRERELEASE.search("v2.22.0rc1"))
        self.assertFalse(digest.PRERELEASE.search("Fixes for devices"))
        self.assertFalse(digest.PRERELEASE.search("v3.6.0"))
        self.assertFalse(digest.PRERELEASE.search("RouterOS 7.24.5 [stable]"))

    def test_release_score(self):
        self.assertEqual(digest.release_score("v3.6.0", ""), 2)
        self.assertEqual(digest.release_score("v3.5.9", ""), 1)
        self.assertEqual(digest.release_score("v3.5.9", "fixes CVE-2026-1234"), 3)

    def test_pick_limits_per_kind(self):
        items = [fake_item(unit=f"u{n}", kind="security", score=5) for n in range(6)]
        items += [fake_item(unit=f"r{n}", score=1) for n in range(3)]
        kinds = [i["kind"] for i in digest.pick(items)]
        self.assertEqual(kinds.count("security"), digest.QUOTA["security"])
        self.assertEqual(kinds.count("release"), 3)

    def test_pick_limits_per_unit(self):
        items = [fake_item(score=s) for s in (5, 4, 3)] + [fake_item(unit="dns", score=1)]
        picked = digest.pick(items)
        self.assertEqual([i["unit"] for i in picked], ["traefik", "traefik", "dns"])


class Commands(unittest.TestCase):
    def test_commands(self):
        p = digest.parse_command
        self.assertEqual(p("Publicar"), ("publish", []))
        self.assertEqual(p("ok!"), ("publish", []))
        self.assertEqual(p("> cita del borrador\nsí"), ("publish", []))
        self.assertEqual(p("descártalo"), ("discard", []))
        self.assertEqual(p("quitar 2, 4 y 5"), ("remove", [2, 4, 5]))
        self.assertEqual(p("quita la 3"), ("remove", [3]))
        self.assertIsNone(p("qué tal"))
        self.assertIsNone(p("publicar mañana no, mejor el martes"))

    def test_status_claims_are_caught(self):
        for bad in ["Mi servidor está actualizado", "ya lo tengo parcheado", "My server is patched", "this doesn't affect me"]:
            self.assertTrue(digest.STATUS_CLAIM.search(bad), bad)
        for ok in ["Afecta a la puerta de entrada de un homelab", "Conviene leer las notas"]:
            self.assertFalse(digest.STATUS_CLAIM.search(ok), ok)


class Models(unittest.TestCase):
    def test_gemini_schema_uppercases_types(self):
        g = digest.gemini_schema(digest.ITEM_SCHEMA)
        self.assertEqual(g["type"], "OBJECT")
        self.assertEqual(g["properties"]["keep"]["type"], "BOOLEAN")
        self.assertEqual(g["properties"]["es"]["properties"]["title"]["type"], "STRING")
        self.assertEqual(g["required"], ["keep", "es", "en"])

    def test_key_file(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "k").write_text("clave-de-prueba\n")
            cfg = digest.Config({"HOME": d, "DIGEST_GEMINI_KEY_FILE": str(Path(d) / "k")})
            self.assertEqual(cfg.gemini_key, "clave-de-prueba")
            self.assertEqual(digest.Config({"HOME": d}).gemini_key, "")


class Schedule(unittest.TestCase):
    def at(self, y, m, d, h):
        return dt.datetime(y, m, d, h, 0, tzinfo=digest.MADRID)

    def test_window(self):
        # 18-10-2026 es domingo y 19-10-2026, lunes.
        self.assertIsNone(digest.target_monday(self.at(2026, 10, 18, 19)))
        self.assertEqual(digest.target_monday(self.at(2026, 10, 18, 20)), dt.date(2026, 10, 19))
        self.assertEqual(digest.target_monday(self.at(2026, 10, 19, 7)), dt.date(2026, 10, 19))
        self.assertIsNone(digest.target_monday(self.at(2026, 10, 19, 8)))
        self.assertEqual(digest.publish_at(dt.date(2026, 10, 19)).hour, 8)
        self.assertEqual(digest.expires_at(dt.date(2026, 10, 19)).date(), dt.date(2026, 10, 20))


class Article(unittest.TestCase):
    def test_article_is_valid_toml(self):
        items = [fake_item(), fake_item(unit="dns", kind="security", src="Technitium DNS")]
        intro = {l: {"summary": "Dos novedades.", "lesson": "Leer antes de actualizar."} for l in ("es", "en")}
        src = digest.build_article(dt.date(2026, 10, 19), items, intro, digest.valid_tech_ids(REPO))
        a = tomllib.loads(src)
        self.assertEqual(a["slug"], "resumen-2026-10-19")
        self.assertEqual(a["kind"], "digest")
        self.assertEqual(a["tech"], ["traefik"])
        es = a["text"]["es"]
        self.assertTrue(es["title"].startswith("Resumen del lunes 19 de octubre: "))
        self.assertLessEqual(len(es["description"]), 170)
        self.assertEqual(es["sections"][1]["heading"], "Seguridad · Traefik 3.6 trae «algo» nuevo")
        self.assertEqual(es["sections"][0]["paragraphs"][0], 'Sale con "comillas" y \\ barras.')
        self.assertEqual(es["sections"][0]["links"][0]["url"], "https://github.com/traefik/traefik/releases/tag/v3.6.0")
        self.assertTrue(a["text"]["en"]["sections"][0]["paragraphs"][1].startswith("On my server: "))

    def test_description_is_cut_at_a_word(self):
        items = [fake_item(src=f"Proyecto con nombre largo {n}") for n in range(12)]
        d = digest.description(items, "es")
        self.assertLessEqual(len(d), 170)
        self.assertTrue(d.endswith("…"))


if __name__ == "__main__":
    unittest.main()
