import time
import requests
from datetime import datetime

URL = "https://bird-observations-made-simple.onrender.com/"

print(f"[{datetime.now().isoformat()}] Starter Render-pinger mot {URL}")
while True:
    try:
        r = requests.get(URL, timeout=10)
        print(f"[{datetime.now().isoformat()}] Pinged {URL} - status: {r.status_code}")
    except Exception as e:
        print(f"[{datetime.now().isoformat()}] Ping failed: {e}")
    time.sleep(600)  # 600 sekunder = 10 minutter
