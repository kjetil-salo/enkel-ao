import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
import random

import argparse

DEFAULT_URLS = [
    'http://localhost:3000/',
    'http://localhost:3000/api/species?search=mus',
    'http://localhost:3000/api/reverse?lat=59.91&lon=10.75',
]

TOTAL_REQUESTS = 1000
CONCURRENCY = 50
GENTLE_DELAY = 0.05  # seconds between requests per worker when in gentle mode

def worker(url, gentle=False, gentle_delay=GENTLE_DELAY):
    try:
        if gentle:
            # small jitter to avoid hitting external services hard
            time.sleep(gentle_delay * random.random())
        r = requests.get(url, timeout=10)
        return r.status_code
    except Exception as e:
        return str(e)

def main(mode='mixed', total=TOTAL_REQUESTS, concurrency=CONCURRENCY, gentle_delay=GENTLE_DELAY):
    urls = DEFAULT_URLS if mode == 'mixed' else ['http://localhost:3000/']

    total = int(total)
    concurrency = int(concurrency)
    gentle_delay = float(gentle_delay)

    start = time.time()
    results = {}
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        futures = []

        if mode == 'ramp':
            # Gradually increase concurrency over the run
            step = max(1, total // 10)
            for i in range(total):
                url = urls[i % len(urls)]
                # small sleep to ramp up
                time.sleep(0.01)
                futures.append(ex.submit(worker, url, gentle=False))

        elif mode == 'soak':
            # Run a low-rate continuous test for 'total' seconds (use total as seconds)
            end_time = time.time() + float(total)
            while time.time() < end_time:
                url = urls[random.randrange(len(urls))]
                futures.append(ex.submit(worker, url, gentle=True, gentle_delay=gentle_delay))
                # little pause to keep rate low
                time.sleep(0.1)

        elif mode == 'spike':
            # Send bursts: several short bursts of requests
            bursts = 5
            burst_size = max(1, total // (bursts or 1))
            for b in range(bursts):
                for i in range(burst_size):
                    url = urls[i % len(urls)]
                    futures.append(ex.submit(worker, url, gentle=False))
                # short gap between bursts
                time.sleep(0.5)

        elif mode == 'smoke':
            # A few sanity checks (defaults to 5 requests)
            smoke_count = min(10, total)
            for i in range(smoke_count):
                url = urls[i % len(urls)]
                futures.append(ex.submit(worker, url, gentle=True, gentle_delay=gentle_delay))

        else:
            for i in range(total):
                url = urls[i % len(urls)]
                futures.append(ex.submit(worker, url, gentle=(mode=='gentle'), gentle_delay=gentle_delay))

        for f in as_completed(futures):
            res = f.result()
            results[res] = results.get(res, 0) + 1

    elapsed = time.time() - start
    print(f"Requests: {total}, Concurrency: {concurrency}, Time: {elapsed:.2f}s")
    print("Results summary:")
    for k, v in sorted(results.items(), key=lambda x: (str(x[0]), -x[1])):
        print(f"  {k}: {v}")


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--mode', choices=['mixed', 'static', 'gentle', 'ramp', 'soak', 'spike', 'smoke'], default='mixed')
    p.add_argument('--requests', type=int, default=TOTAL_REQUESTS)
    p.add_argument('--concurrency', type=int, default=CONCURRENCY)
    p.add_argument('--delay', type=float, default=GENTLE_DELAY, help='gentle per-request jitter multiplier')
    args = p.parse_args()
    main(mode=args.mode, total=args.requests, concurrency=args.concurrency, gentle_delay=args.delay)
