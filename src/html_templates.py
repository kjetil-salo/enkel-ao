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


def generate_stats_page(per_ip, per_ua, total, source="Supabase"):
    """Generer statistikk-side med data fra enten Supabase eller in-memory."""
    ip_rows = ''.join(f'<tr><td>{ip}</td><td>{count}</td></tr>' 
                     for ip, count in sorted(per_ip.items(), key=lambda x: -x[1]))
    ua_rows = ''.join(f'<tr><td>{ua}</td><td>{count}</td></tr>' 
                     for ua, count in sorted(per_ua.items(), key=lambda x: -x[1]))
    
    return f"""
<html>
<head>
    <title>Brukerstatistikk ({source})</title>
    <meta name='viewport' content='width=device-width, initial-scale=1'>
    <style>
        body {{ font-family: system-ui, sans-serif; background: #f8f9fa; color: #222; margin: 0; padding: 0; }}
        .container {{ max-width: 600px; margin: 2em auto; background: #fff; border-radius: 10px; box-shadow: 0 2px 8px #0001; padding: 2em; }}
        h1, h2, h3 {{ margin-top: 0; }}
        table {{ border-collapse: collapse; width: 100%; margin-bottom: 2em; }}
        th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
        th {{ background: #f0f0f0; }}
        .stat {{ font-size: 2em; font-weight: bold; margin-bottom: 0.5em; }}
        .section-title {{ margin-top: 2em; margin-bottom: 0.5em; font-size: 1.2em; color: #444; }}
        .source {{ color: #666; font-size: 0.9em; margin-bottom: 1em; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>Brukerstatistikk</h1>
        <div class="source">Datakilde: {source}</div>
        <div class="stat">{total} sidevisninger</div>
        <div>{len(per_ip)} unike IP-adresser</div>

        <div class="section-title">Sidevisninger per IP</div>
        <table>
            <tr><th>IP-adresse</th><th>Antall</th></tr>
            {ip_rows}
        </table>

        <div class="section-title">User-Agents</div>
        <table>
            <tr><th>User-Agent</th><th>Antall</th></tr>
            {ua_rows}
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