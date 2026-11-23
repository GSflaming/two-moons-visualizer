export const EPS = 1e-7;

export function floorIndex(items, value, field) {
  let left = 0;
  let right = items.length;
  while (left < right) {
    const middle = (left + right) >> 1;
    const candidate = field === undefined ? items[middle] : items[middle][field];
    if (candidate <= value + EPS) left = middle + 1;
    else right = middle;
  }
  return left - 1;
}

export function makeTiming(tempoMap, timeSignatureMap, beatZeroSeconds = 0) {
  let previous = { beat: 0, sec: beatZeroSeconds, bpm: tempoMap[0].bpm };
  const tempo = tempoMap.map(item => {
    previous = { ...item, sec: previous.sec + (item.beat - previous.beat) * 60 / previous.bpm };
    return previous;
  });
  let priorMeter;
  const meters = timeSignatureMap.map(item => {
    const bar = priorMeter ? priorMeter.bar + Math.round((item.beat - priorMeter.beat) / priorMeter.length) : 1;
    priorMeter = { ...item, bar, pulse: 4 / item.denominator, length: item.numerator * 4 / item.denominator };
    return priorMeter;
  });
  return {
    tempo, meters,
    seconds(beat) {
      const node = tempo[Math.max(0, floorIndex(tempo, beat, 'beat'))];
      return node.sec + (beat - node.beat) * 60 / node.bpm;
    },
    beat(seconds) {
      const node = tempo[Math.max(0, floorIndex(tempo, seconds, 'sec'))];
      return node.beat + (seconds - node.sec) * node.bpm / 60;
    },
    position(beat) {
      const node = meters[Math.max(0, floorIndex(meters, beat, 'beat'))];
      const bars = Math.floor((beat - node.beat + EPS) / node.length);
      const start = node.beat + bars * node.length;
      const count = Math.max(0, (beat - start) / node.pulse);
      return { bar: node.bar + bars, pulse: 1 + count, start, end: start + node.length, unit: node.pulse };
    },
    grid(from, to, limit = 1600) {
      const lines = [];
      for (let beat = from - EPS; beat <= to + EPS && lines.length < limit;) {
        const position = this.position(beat);
        const next = position.start + Math.ceil(position.pulse - 1 - EPS) * position.unit;
        const point = this.position(next);
        if (next <= to + EPS) lines.push({ beat: next, bar: point.bar, pulse: point.pulse });
        beat = next + point.unit;
      }
      return lines;
    },
  };
}
