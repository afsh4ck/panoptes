/**
 * Spanish for the route sentences the step formatter (routeSteps.js) and the
 * flight planner build from street names: whole-sentence patterns, so the
 * street name passes through untouched. Also the ROUTE drawer's progress
 * fragments ("4 min left", "160 m done"…).
 */

const DIRECTIONS = Object.freeze({
  left: 'a la izquierda',
  right: 'a la derecha',
  'slightly left': 'ligeramente a la izquierda',
  'slightly right': 'ligeramente a la derecha',
  'sharply left': 'bruscamente a la izquierda',
  'sharply right': 'bruscamente a la derecha',
  straight: 'recto',
  around: 'en sentido contrario',
});
const SIDES = Object.freeze({ left: 'a la izquierda', right: 'a la derecha' });
const DIR =
  '(left|right|slightly left|slightly right|sharply left|sharply right|straight|around)';
const onto = (road) => (road ? ` por ${road}` : '');
const dir = (word) => DIRECTIONS[word] || word;
const ordinal = (n) => `${Number.parseInt(n, 10)}.ª`;
/** "4 min", "1 h 5 min", "160 m", "1.6 km", "20 s". */
const QUANTITY = String.raw`(\d[\d.,]*\s*(?:s|min|h|m|km)(?: \d+ min)?)`;

/** [pattern, replacer] pairs, tried in order on the whole sentence. */
export const ROUTE_INSTRUCTION_PATTERNS = Object.freeze([
  [/^Head out on (.+)$/, (_, road) => `Sal por ${road}`],
  [/^Head out$/, () => 'Sal'],
  [
    /^Arrive at your destination, on the (left|right)$/,
    (_, side) => `Llegas a tu destino, ${SIDES[side]}`,
  ],
  [/^Arrive at your destination$/, () => 'Llegas a tu destino'],
  [
    /^Make a U-turn(?: onto (.+))?$/,
    (_, road) => `Cambia de sentido${onto(road)}`,
  ],
  [
    /^Continue straight(?: onto (.+))?$/,
    (_, road) => `Sigue recto${onto(road)}`,
  ],
  [
    new RegExp(`^Continue ${DIR}(?: onto (.+))?$`),
    (_, d, road) => `Continúa ${dir(d)}${onto(road)}`,
  ],
  [/^Continue(?: onto (.+))?$/, (_, road) => `Continúa${onto(road)}`],
  [
    new RegExp(`^Turn ${DIR}(?: onto (.+))?$`),
    (_, d, road) => `Gira ${dir(d)}${onto(road)}`,
  ],
  [/^Turn(?: onto (.+))?$/, (_, road) => `Gira${onto(road)}`],
  [
    new RegExp(`^At the end of the road, turn ${DIR}(?: onto (.+))?$`),
    (_, d, road) => `Al final de la calle, gira ${dir(d)}${onto(road)}`,
  ],
  [
    /^At the end of the road, continue(?: onto (.+))?$/,
    (_, road) => `Al final de la calle, continúa${onto(road)}`,
  ],
  [
    new RegExp(`^Keep ${DIR} at the fork(?: onto (.+))?$`),
    (_, d, road) => `En la bifurcación, mantente ${dir(d)}${onto(road)}`,
  ],
  [
    /^Continue at the fork(?: onto (.+))?$/,
    (_, road) => `En la bifurcación, continúa${onto(road)}`,
  ],
  [
    new RegExp(`^Merge ${DIR}(?: onto (.+))?$`),
    (_, d, road) => `Incorpórate ${dir(d)}${onto(road)}`,
  ],
  [/^Merge(?: onto (.+))?$/, (_, road) => `Incorpórate${onto(road)}`],
  [
    new RegExp(`^Take the ramp on the ${DIR}(?: onto (.+))?$`),
    (_, d, road) => `Toma el acceso ${dir(d)}${onto(road)}`,
  ],
  [
    /^Take the ramp(?: onto (.+))?$/,
    (_, road) => `Toma el acceso${onto(road)}`,
  ],
  [
    new RegExp(`^Take the exit on the ${DIR}(?: onto (.+))?$`),
    (_, d, road) => `Toma la salida ${dir(d)}${onto(road)}`,
  ],
  [
    /^Take the exit(?: onto (.+))?$/,
    (_, road) => `Toma la salida${onto(road)}`,
  ],
  [
    /^At the roundabout, take the (\d+)(?:st|nd|rd|th) exit(?: onto (.+))?$/,
    (_, n, road) => `En la rotonda, toma la ${ordinal(n)} salida${onto(road)}`,
  ],
  [
    /^Enter the roundabout(?: onto (.+))?$/,
    (_, road) => `Entra en la rotonda${onto(road)}`,
  ],
  [
    new RegExp(`^At the roundabout, turn ${DIR}(?: onto (.+))?$`),
    (_, d, road) => `En la rotonda, gira ${dir(d)}${onto(road)}`,
  ],
  [
    /^At the roundabout, continue(?: onto (.+))?$/,
    (_, road) => `En la rotonda, continúa${onto(road)}`,
  ],
  [
    /^Exit the roundabout(?: onto (.+))?$/,
    (_, road) => `Sal de la rotonda${onto(road)}`,
  ],
  [
    new RegExp(`^Use the ${DIR} lane(?: onto (.+))?$`),
    (_, d, road) =>
      `Usa el carril ${dir(d).replace(/^a la /, 'de la ')}${onto(road)}`,
  ],
  // Flight plan steps.
  [
    /^Take off from (.+) and climb$/,
    (_, from) => `Despega de ${from} y asciende`,
  ],
  [/^Cruise at (FL\d+)$/, (_, fl) => `Crucero a ${fl}`],
  [/^Descend towards (.+)$/, (_, to) => `Desciende hacia ${to}`],
  [/^Land at (.+)$/, (_, to) => `Aterriza en ${to}`],
  // Progress fragments of the ROUTE drawer (numeric quantities only, so a
  // label that merely ends in "left" or "done" is never caught).
  [new RegExp(`^${QUANTITY} elapsed$`), (_, v) => `${v} transcurridos`],
  [new RegExp(`^${QUANTITY} left$`), (_, v) => `quedan ${v}`],
  [new RegExp(`^${QUANTITY} done$`), (_, v) => `${v} recorridos`],
  [new RegExp(`^${QUANTITY} to go$`), (_, v) => `faltan ${v}`],
]);

/** Spanish for one route sentence, or null when it is not one. */
export function translateRouteInstruction(text) {
  const sentence = String(text || '').trim();
  if (!sentence) return null;
  for (const [pattern, replace] of ROUTE_INSTRUCTION_PATTERNS) {
    if (pattern.test(sentence)) return sentence.replace(pattern, replace);
  }
  return null;
}
