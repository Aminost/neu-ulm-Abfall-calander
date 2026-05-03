const https = require('https');

https.get('https://nu.neu-ulm.de/buerger-service/leben-in-neu-ulm/abfall-sauberkeit/abfallkalender/', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    const regex = /href="([^"]+\.ics[^"]*)"/g;
    let match;
    while ((match = regex.exec(data)) !== null) {
      console.log(match[1]);
    }
  });
}).on('error', (err) => {
  console.log('Error: ' + err.message);
});
