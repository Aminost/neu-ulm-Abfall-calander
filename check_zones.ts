import { ZONES } from './src/lib/zones';
const zone7 = ZONES.find(z => z.id === 7);
console.log('Zone 7 has ' + zone7?.polygons.length + ' polygons');
