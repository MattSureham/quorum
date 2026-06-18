// Tiny monotonic, sortable id (no external ulid dependency).
let last = 0;
let counter = 0;
export function ulid(): string {
  const t = Date.now();
  if (t === last) counter++;
  else { last = t; counter = 0; }
  const rand = Math.random().toString(36).slice(2, 10);
  return `${t.toString(36)}-${counter.toString(36).padStart(3, "0")}-${rand}`;
}
