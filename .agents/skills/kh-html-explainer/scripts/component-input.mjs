const forbiddenControls = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

export function check(condition, message) {
  if (!condition) throw new Error(message);
}

export function record(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.includes(key));
}

export function label(value, max) {
  return typeof value === 'string' && value.trim() && [...value].length <= max
    && !forbiddenControls.test(value);
}

export function parseInput(source, keys) {
  check(Buffer.byteLength(source) <= 16_384, '入力は16 KiBまでです');
  const value = JSON.parse(source);
  check(record(value, keys), 'フィールドが不正です');
  return value;
}
