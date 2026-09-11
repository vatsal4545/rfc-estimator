"use client";

export function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      {children}
      {hint && <span className="text-xs text-zinc-400">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

export const selectCls = inputCls;

export function Grid({ cols = 3, children }: { cols?: 2 | 3 | 4; children: React.ReactNode }) {
  const colClass = cols === 2 ? "sm:grid-cols-2" : cols === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3";
  return <div className={`grid grid-cols-1 gap-4 ${colClass}`}>{children}</div>;
}

export function Pill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        ok
          ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
          : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
      }`}
    >
      {children}
    </span>
  );
}

export function FlagBadge({ flag }: { flag: string }) {
  if (flag === "OK" || flag === "") {
    return <Pill ok>OK</Pill>;
  }
  const warn = flag.startsWith("Design min") || flag.startsWith("Manual") || flag.startsWith("Voltage");
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        warn
          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
          : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
      }`}
      title={flag}
    >
      {flag}
    </span>
  );
}

/**
 * Wrapper for a data table whose header should stay put while you scroll it.
 *
 * The height cap is what makes the freeze possible: `position: sticky` resolves
 * against the nearest scrolling ancestor, and these wrappers already set
 * `overflow-x` for wide tables — which forces `overflow-y: auto` too. Without a
 * height the box never scrolls vertically, the page does, and a sticky header
 * inside it has nothing to stick to. Capping the height moves the vertical
 * scroll into the box, where the header can hold its position — Excel's freeze
 * panes, in the place the rows actually move. Short tables never reach the cap
 * and look exactly as they did.
 */
export const tableWrapCls =
  "max-h-[70vh] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800";

/**
 * The header row of such a table. Opaque, because the body scrolls underneath
 * it, and carrying its bottom rule as an inset shadow — a border on a sticky
 * header scrolls away with the cell it belongs to.
 */
export const theadCls =
  "sticky top-0 z-10 bg-zinc-50 shadow-[inset_0_-1px_0_#e4e4e7] dark:bg-zinc-900 dark:shadow-[inset_0_-1px_0_#27272a]";
