const fs = require('fs');
const turf = require('@turf/turf');

const geojson = JSON.parse(fs.readFileSync('neu-ulm-districts.geojson', 'utf8'));

const BEZIRKE_MAPPING = {
  "Neu-Ulm": 1, // This might need refinement based on actual GeoJSON names
  "Vorfeld": 1,
  "Mitte": 1,
  "Illerbrücke": 1,
  "Innenstadt": 2,
  "Wiley": 3,
  "Schwaighofen": 3,
  "Finningen": 3,
  "Pfuhl-Süd": 3, // Assuming Pfuhl-Süd is part of Pfuhl in GeoJSON
  "Offenhausen": 4,
  "Pfuhl": 5, // Pfuhl-Nord and Pfuhl-Süd might be combined under "Pfuhl"
  "Gerlenhofen": 6,
  "Hausen": 6,
  "Jedelhausen": 6,
  "Reutti": 6,
  "Holzschwang": 6,
  "Burlafingen": 7,
  "Steinheim": 7,
  "Ludwigsfeld": 8
};

let rawZones = [];

geojson.features.forEach(feature => {
  const name = feature.properties.name;
  const id = BEZIRKE_MAPPING[name];

  if (id) {
    let existingZone = rawZones.find(zone => zone.id === id);
    if (!existingZone) {
      existingZone = {
        id: id,
        color: "#000000", // Placeholder color, will be replaced later
        polys: []
      };
      rawZones.push(existingZone);
    }

    if (feature.geometry.type === 'Polygon') {
      existingZone.polys.push(turf.polygon(feature.geometry.coordinates));
    } else if (feature.geometry.type === 'MultiPolygon') {
      feature.geometry.coordinates.forEach(coords => {
        existingZone.polys.push(turf.polygon(coords));
      });
    }
  }
});

// Assign colors based on BEZIRKE constant
const BEZIRKE_COLORS = {
  1: "#a855f7",
  2: "#f97316",
  3: "#84cc16",
  4: "#eab308",
  5: "#ec4899",
  6: "#6b7280",
  7: "#ef4444",
  8: "#14b8a6"
};

rawZones.forEach(zone => {
  zone.color = BEZIRKE_COLORS[zone.id];
});

// Process for overlaps (similar to generate_zones_turf.cjs)
const priorityOrder = [2, 1, 4, 8, 3, 5, 6, 7]; // This order might need adjustment based on actual overlaps

let processedZones = [];
let accumulatedPolygons = [];

for (const zoneId of priorityOrder) {
  const zoneDef = rawZones.find(z => z.id === zoneId);
  if (!zoneDef) continue;

  let currentZonePolys = [];

  for (let poly of zoneDef.polys) {
    let clippedPoly = poly;
    for (const accPoly of accumulatedPolygons) {
      if (!clippedPoly) break;
      try {
        const difference = turf.difference(clippedPoly, accPoly);
        if (difference) {
          clippedPoly = difference;
        } else {
          clippedPoly = null; // Polygon was completely subtracted
        }
      } catch (e) {
        console.warn(`Turf difference failed for zone ${zoneId}:`, e.message);
        // If difference fails, we might keep the original poly or skip it
        // For now, let's keep it to avoid losing data, but this might cause overlaps
      }
    }

    if (clippedPoly) {
      if (clippedPoly.geometry.type === 'Polygon') {
        currentZonePolys.push(clippedPoly);
      } else if (clippedPoly.geometry.type === 'MultiPolygon') {
        clippedPoly.geometry.coordinates.forEach(coords => {
          currentZonePolys.push(turf.polygon(coords));
        });
      }
    }
  }

  accumulatedPolygons.push(...currentZonePolys);

  const finalCoords = currentZonePolys.map(p => {
    // Ensure coordinates are [lat, lng] for the app
    return p.geometry.coordinates[0].map(coord => [coord[1], coord[0]]);
  });

  processedZones.push({
    id: zoneDef.id,
    color: zoneDef.color,
    polygons: finalCoords
  });
}

processedZones.sort((a, b) => a.id - b.id);

fs.writeFileSync('src/lib/zones.json', JSON.stringify(processedZones, null, 2));
console.log('Generated src/lib/zones.json from neu-ulm-districts.geojson.');
