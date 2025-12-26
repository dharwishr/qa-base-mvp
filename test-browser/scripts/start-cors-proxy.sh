#!/bin/bash
# Simple CORS proxy for CDP
# Listens on port 9224 and proxies to CDP on 9222 with CORS headers

sleep 8

cd /opt
python3 << 'EOF'
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request
import json

class CORSProxy(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        try:
            url = f"http://localhost:9222{self.path}"
            with urllib.request.urlopen(url) as response:
                data = response.read()
                self.send_response(200)
                self.send_cors_headers()
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(data)
        except Exception as e:
            self.send_response(500)
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(str(e).encode())

    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')

    def log_message(self, format, *args):
        pass  # Suppress logging

print("CORS proxy starting on port 9224...")
HTTPServer(('0.0.0.0', 9224), CORSProxy).serve_forever()
EOF
