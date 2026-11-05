"""Sirve el sitio generado por `landing dump-site` con la CSP de producción."""
import http.server
import os
import sys

CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; "
       "connect-src 'self'; frame-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; manifest-src 'self'")


class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def translate_path(self, path):
        return super().translate_path(path.split("?")[0])

    def log_message(self, *a):
        pass


os.chdir(sys.argv[1])
http.server.ThreadingHTTPServer(("127.0.0.1", 8099), H).serve_forever()
