const https = require('https');
const fs = require('fs');

const queries = [
  'Vorfeld, Neu-Ulm',
  'Wiley, Neu-Ulm',
  'Illerbrücke, Neu-Ulm',
  'Innenstadt, Neu-Ulm'
];

async function fetchPolygons() {
  const results = JSON.parse(fs.readFileSync('polygons.json', 'utf8'));
  for (const q of queries) {
    await new Promise(resolve => {
      https.get(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&polygon_geojson=1`, {
        headers: { 'User-Agent': 'AI-Studio-App' }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.length > 0 && parsed[0].geojson) {
              results[q] = parsed[0].geojson;
              console.log(`Got polygon for ${q}: ${parsed[0].geojson.type}`);
            } else {
              console.log(`No polygon for ${q}`);
            }
          } catch (e) {
            console.log(`Error parsing ${q}`);
          }
          setTimeout(resolve, 1000); // rate limit
        });
      });
    });
  }
  fs.writeFileSync('polygons.json', JSON.stringify(results, null, 2));
}

fetchPolygons();
