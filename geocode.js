const https = require('https');

https.get('https://nominatim.openstreetmap.org/search?format=json&q=Lupinenweg+25,+Neu-Ulm', {
  headers: { 'User-Agent': 'AI-Studio-App' }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(JSON.parse(data));
  });
});
