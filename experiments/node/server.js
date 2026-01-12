// Archived Node.js prototype server.
// The supported backend entrypoint for this project is server.py.

import express from 'express';
import fetch from 'node-fetch';
import cheerio from 'cheerio';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files (index.html, etc.) from /public
app.use(express.static(path.join(__dirname, 'public')));

// Simple proxy endpoint for species autocomplete
app.get('/api/species', async (req, res) => {
  const search = (req.query.search || '').toString().trim();
  if (!search) {
    return res.json([]);
  }

  const url = new URL('https://www.artsobservasjoner.no/Taxon/PickerSearch');
  url.searchParams.set('search', search);
  url.searchParams.set('returnformat', 'html');
  url.searchParams.set('onlyReportable', 'true');
  url.searchParams.set('dontIncludeSubSpecies', 'true');
  url.searchParams.set('speciesGroup', '8'); // 8 = fugler
  url.searchParams.set('language', '4');     // 4 = norsk

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FugleobservasjonerBot/0.1)',
        'Accept': 'text/html, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://www.artsobservasjoner.no/SubmitSighting/Report'
      }
    });

    if (!response.ok) {
      console.error('Artsobservasjoner error', response.status, await response.text().catch(() => ''));
      return res.status(502).json({ error: 'Feil ved henting fra Artsobservasjoner.' });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const results = [];

    $('span.itemjson').each((_, el) => {
      const jsonText = $(el).text();
      try {
        const data = JSON.parse(jsonText);
        results.push({
          taxonId: data.taxonid,
          taxonName: data.taxonname,
          scientificNameHtml: data.scientificname,
          speciesGroupId: data.speciesgroupid,
          protectionLevelId: data.protectionlevelid,
          leaf: data.leaf === 'true'
        });
      } catch (e) {
        console.error('Kunne ikke parse itemjson', e);
      }
    });

    res.json(results);
  } catch (err) {
    console.error('Feil i proxy /api/species:', err);
    res.status(500).json({ error: 'Intern serverfeil i proxy.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server kjører på http://localhost:${PORT}`);
});
