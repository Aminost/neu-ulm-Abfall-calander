const https = require('https');

const queries = [
  'Breitenhofstraße 64, Neu-Ulm',
  'Leipheimer Str., Pfuhl, Neu-Ulm',
  'Hausener Str., Gerlenhofen, Neu-Ulm',
  'Breslauer Str., Ludwigsfeld, Neu-Ulm',
  'Grüngutsammelstelle, Neu-Ulm'
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
