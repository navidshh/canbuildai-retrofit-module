#!/usr/bin/env python3
"""
Simple HTTP server that serves index.html for all paths.
This fixes the issue where query parameters cause directory listing.
"""
import http.server
import socketserver
from urllib.parse import urlparse

PORT = 8080

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Disable caching
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()
    
    def do_GET(self):
        # Parse the URL
        parsed_path = urlparse(self.path)
        
        # If the path is root or has query parameters, serve index.html
        if parsed_path.path == '/' or parsed_path.query:
            self.path = '/index.html'
        
        return http.server.SimpleHTTPRequestHandler.do_GET(self)

if __name__ == '__main__':
    with socketserver.TCPServer(("", PORT), MyHTTPRequestHandler) as httpd:
        print(f"Server running at http://localhost:{PORT}/")
        print("Press Ctrl+C to stop")
        httpd.serve_forever()
