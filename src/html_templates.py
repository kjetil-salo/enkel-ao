"""
HTML templates for fugleobservasjoner.

Genererer HTML-sider for statistikk og login.
"""


def generate_stats_login_page():
    """Generer login-side for statistikk."""
    return """
<html>
<head><meta name='viewport' content='width=device-width,initial-scale=1'><title>Logg inn for statistikk</title></head>
<body style="font-family:system-ui, sans-serif;padding:18px;">
    <h2>Logg inn</h2>
    <p>Oppgi nøkkel for å se statistikk.</p>
    <input id="stats-key" type="text" placeholder="Skriv inn nøkkel" style="padding:8px;font-size:16px;" />
    <button id="stats-go" style="padding:8px 10px;margin-left:8px;">Vis</button>
    <p style="color:#666;margin-top:12px;font-size:0.9rem">Nøkkelen lagres i din nettleser slik at du ikke må skrive den igjen.</p>
    <script>
        (function(){
            const inp = document.getElementById('stats-key');
            const btn = document.getElementById('stats-go');
            const saved = localStorage.getItem('stats_key');
            if (saved) inp.value = saved;
            btn.addEventListener('click', () => {
                const v = inp.value.trim();
                if (!v) return alert('Skriv inn nøkkel');
                localStorage.setItem('stats_key', v);
                location.search = '?key=' + encodeURIComponent(v);
            });
        })();
    </script>
</body>
</html>
"""


def generate_stats_page(recent_ips, per_ua, total, per_device=None, per_os=None, per_browser=None, total_unique_ips=0, source="Supabase"):
    """Generer statistikk-side med data fra enten Supabase eller in-memory."""
    per_device = per_device or {}
    per_os = per_os or {}
    per_browser = per_browser or {}

    # recent_ips er liste av (ip, count) tuples, allerede sortert nyeste først
    ip_rows = ''.join(f'<tr><td><a href="https://ipinfo.io/{ip}" target="_blank" rel="noopener">{ip}</a></td><td>{count}</td></tr>'
                     for ip, count in recent_ips)

    # Device, OS, Browser - kompakte tabeller
    device_rows = ''.join(f'<tr><td>{d}</td><td>{c}</td></tr>'
                         for d, c in sorted(per_device.items(), key=lambda x: -x[1]))
    os_rows = ''.join(f'<tr><td>{o}</td><td>{c}</td></tr>'
                     for o, c in sorted(per_os.items(), key=lambda x: -x[1]))
    browser_rows = ''.join(f'<tr><td>{b}</td><td>{c}</td></tr>'
                          for b, c in sorted(per_browser.items(), key=lambda x: -x[1]))

    # User-agent - vis bare topp 10
    ua_sorted = sorted(per_ua.items(), key=lambda x: -x[1])[:10]
    ua_rows = ''.join(f'<tr><td style="word-break:break-all;max-width:400px">{ua}</td><td>{count}</td></tr>'
                     for ua, count in ua_sorted)

    # Bygg device/os/browser seksjon kun hvis data finnes
    device_section = ""
    if per_device:
        device_section = f"""
        <div class="stats-grid">
            <div class="stats-card">
                <div class="card-title">Enhetstype</div>
                <table>
                    <tr><th>Type</th><th>Antall</th></tr>
                    {device_rows}
                </table>
            </div>
            <div class="stats-card">
                <div class="card-title">Operativsystem</div>
                <table>
                    <tr><th>OS</th><th>Antall</th></tr>
                    {os_rows}
                </table>
            </div>
            <div class="stats-card">
                <div class="card-title">Nettleser</div>
                <table>
                    <tr><th>Browser</th><th>Antall</th></tr>
                    {browser_rows}
                </table>
            </div>
        </div>
        """

    return f"""
<html>
<head>
    <title>Brukerstatistikk ({source})</title>
    <meta name='viewport' content='width=device-width, initial-scale=1'>
    <style>
        body {{ font-family: system-ui, sans-serif; background: #f8f9fa; color: #222; margin: 0; padding: 0; }}
        .container {{ max-width: 900px; margin: 2em auto; background: #fff; border-radius: 10px; box-shadow: 0 2px 8px #0001; padding: 2em; }}
        h1, h2, h3 {{ margin-top: 0; }}
        table {{ border-collapse: collapse; width: 100%; margin-bottom: 1em; }}
        th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
        th {{ background: #f0f0f0; }}
        .stat {{ font-size: 2em; font-weight: bold; margin-bottom: 0.5em; }}
        .section-title {{ margin-top: 2em; margin-bottom: 0.5em; font-size: 1.2em; color: #444; }}
        .source {{ color: #666; font-size: 0.9em; margin-bottom: 1em; }}
        .stats-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1em; margin-bottom: 2em; }}
        .stats-card {{ background: #f8f9fa; border-radius: 8px; padding: 1em; }}
        .card-title {{ font-weight: 600; margin-bottom: 0.5em; color: #333; }}
        .stats-card table {{ margin-bottom: 0; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>Brukerstatistikk</h1>
        <div class="source">Datakilde: {source}</div>
        <div class="stat">{total} sidevisninger</div>
        <div>{total_unique_ips} unike IP-adresser</div>

        {device_section}

        <div class="section-title">User-Agents (topp 10)</div>
        <table>
            <tr><th>User-Agent</th><th>Antall</th></tr>
            {ua_rows}
        </table>

        <div class="section-title">Siste 10 IP-adresser</div>
        <table>
            <tr><th>IP-adresse</th><th>Antall visninger</th></tr>
            {ip_rows}
        </table>
    </div>
</body>
</html>
"""


def generate_error_page(error_msg):
    """Generer feilside for statistikk."""
    return f"""
<html>
<body>
    <h2>Feil ved henting av statistikk fra Supabase:</h2>
    <pre>{error_msg}</pre>
</body>
</html>
"""
