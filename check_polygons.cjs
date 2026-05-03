const fs = require('fs');
const data = JSON.parse(fs.readFileSync('polygons.json', 'utf8'));

for (const key in data) {
  console.log(key, data[key].type);
}
