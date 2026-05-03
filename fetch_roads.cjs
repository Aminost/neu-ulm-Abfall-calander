const fs = require('fs');
const https = require('https');

function queryOverpass(query) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'overpass-api.de',
      path: '/api/interpreter',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve(data);
      });
    });
    req.on('error', reject);
    req.write('data=' + encodeURIComponent(query));
    req.end();
  });
}

async function main() {
  const query = `
    [out:json];
    area["name"="Neu-Ulm"]->.searchArea;
    (
      way["name"="Memminger Straße"](area.searchArea);
      way["name"="Reuttier Straße"](area.searchArea);
      way["name"="Leipheimer Straße"](area.searchArea);
      way["railway"="rail"](area.searchArea);
    );
    out geom;
  `;
  
  const data = await queryOverpass(query);
  fs.writeFileSync('roads.json', data);
  console.log('Saved roads.json');
}

main();
