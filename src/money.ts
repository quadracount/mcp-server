const formatter = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });

export function formatPesos(amount: number): string {
  return `$${formatter.format(Math.abs(amount))}`;
}

export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}
