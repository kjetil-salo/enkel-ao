// Varsler brukere på Fly.io om at appen flytter til ao.efugl.no.
// Fjerner seg selv permanent når hostnavnet ikke lenger er *.fly.dev.
(function () {
  if (!window.location.hostname.endsWith('.fly.dev')) return;

  var DISMISS_KEY = 'migrationBannerDismissedUntil';
  var dismissedUntil = Number(localStorage.getItem(DISMISS_KEY) || 0);
  if (Date.now() < dismissedUntil) return;

  var bar = document.createElement('div');
  bar.setAttribute('role', 'status');
  bar.style.cssText =
    'position:sticky;top:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
    'gap:10px;flex-wrap:wrap;padding:8px 14px;font-size:0.85rem;text-align:center;' +
    'background:var(--color-accent-soft,rgba(59,130,246,0.15));color:var(--color-text,#e5e7eb);' +
    'border-bottom:1px solid var(--color-border,#1f2937);';
  bar.innerHTML =
    '<span>⚡ <strong>ao.efugl.no</strong> er ny hovedadresse — raskere og alltid oppdatert. Denne siden (fly.dev) beholdes som reserve.</span>' +
    '<a href="https://ao.efugl.no" style="color:var(--color-accent,#3b82f6);font-weight:600;text-decoration:underline;">Bytt dit nå</a>' +
    '<button type="button" style="border:none;background:transparent;color:var(--color-muted,#b0b8c1);cursor:pointer;font-size:1rem;line-height:1;padding:2px 6px;">✕</button>';

  bar.querySelector('button').addEventListener('click', function () {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + 24 * 60 * 60 * 1000));
    bar.remove();
  });

  document.body.prepend(bar);
})();
