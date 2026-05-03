const https = require('https');

const queries = [
  'Neu-Ulm Mitte',
  'Neu-Ulm Vorfeld',
  'Neu-Ulm Innenstadt',
  'Wiley, Neu-Ulm',
  'Schwaighofen, Neu-Ulm',
  'Finningen, Neu-Ulm',
  'Offenhausen, Neu-Ulm',
  'Pfuhl, Neu-Ulm',
  'Burlafingen, Neu-Ulm',
  'Steinheim, Neu-Ulm',
  'Ludwigsfeld, Neu-Ulm',
  'Gerlenhofen, Neu-Ulm',
  'Reutti, Neu-Ulm'
];

queries.forEach(q => {
  https.get(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}`, {
    headers: { 'User-Agent': 'AI-Studio-App' }
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      const parsed = JSON.parse(data);
      if (parsed.length > 0) {
        console.log(q, '->', parsed[0].lat, parsed[0].lon);
      } else {
        console.log(q, '-> Not found');
      }
    });
  });
});
