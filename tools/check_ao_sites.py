#!/usr/bin/env python3
import sys
import time
import json
import urllib.request
import threading
from http.server import HTTPServer

REPO_ROOT = '.'
sys.path.insert(0, REPO_ROOT)
from server import Handler

def main():
    port = 38030
    server = HTTPServer(('', port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.05)

    url = f'http://127.0.0.1:{port}/api/ao-sites?lat=59.9139&lon=10.7522&size=1000'
    with urllib.request.urlopen(url) as resp:
        body = resp.read().decode('utf-8')
    data = json.loads(body)
    sites = data.get('sites', [])
    visible = [s for s in sites if s.get('name')]

    def sort_key(a):
        aSuper = 1 if a.get('isSuper') else 0
        is_private = a.get('raw', {}).get('isPrivate') in (True, 'true', 'True')
        return (-aSuper, is_private)

    visible_sorted = sorted(visible, key=sort_key)
    print('Total sites:', len(sites))
    print('Sites with isSuper/parentId:', len([s for s in sites if s.get('isSuper') or s.get('parentId')]))
    print('\nFørste 10 etter sort (isSuper, isPrivate, name):')
    for s in visible_sorted[:10]:
        print(s.get('isSuper'), s.get('raw', {}).get('isPrivate'), s.get('name'))

    server.shutdown()

if __name__ == '__main__':
    main()
