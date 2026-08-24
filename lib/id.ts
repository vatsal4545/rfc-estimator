let counter = 0;

export function newId(prefix = "row"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}
