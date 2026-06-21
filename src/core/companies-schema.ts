// Schema helpers for the `companies` table. Kept out of `db.ts` so callers
// like `periods.ts` can use them without pulling `db.ts`'s wider import
// graph (which transitively reaches `company.ts` via `retention.ts`).

import type { Database } from "bun:sqlite";

/**
 * Ensure `companies.vat_period_type` exists AND is nullable.
 *
 * The column was added in #289 as `NOT NULL DEFAULT 'quarter'` from a
 * defensive helper outside `migrate()`. A non-VAT-registered company has no
 * meaningful cadence — `null` is the canonical "not registered" state — so
 * the column must allow NULL. SQLite cannot relax a NOT NULL in place, so
 * for an older ledger we rebuild the `companies` row with the relaxed CHECK
 * and copy every stored column across. Idempotent: a fresh ledger gets the
 * column added nullable from the start; a ledger that already carries the
 * nullable column is a no-op.
 *
 * Called both from `migrate()` and from `setCompanyVatPeriodType` so a
 * caller that forgot to run `migrate(db)` still gets the correct shape.
 */
export function ensureNullableVatPeriodColumn(db: Database) {
  const cols = db.query("PRAGMA table_info(companies)").all() as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>;
  const existing = cols.find((c) => c.name === "vat_period_type");
  if (!existing) {
    db.exec(
      "ALTER TABLE companies ADD COLUMN vat_period_type TEXT " +
        "CHECK(vat_period_type IS NULL OR vat_period_type IN ('month', 'quarter', 'half-year'));",
    );
    return;
  }
  if (existing.notnull === 0) return;

  // Older ledger: column carries the legacy NOT NULL DEFAULT 'quarter'
  // definition. Rebuild the table to relax it. The new column list is
  // derived from PRAGMA so the rebuild is forward-compatible with any other
  // column an earlier migration step has already appended (mail_alias, …).
  const newColumns = cols
    .map((c) => {
      if (c.name === "vat_period_type") {
        return "vat_period_type TEXT CHECK(vat_period_type IS NULL OR vat_period_type IN ('month', 'quarter', 'half-year'))";
      }
      const pk = c.pk === 1 ? " PRIMARY KEY" : "";
      const notnull = c.notnull === 1 ? " NOT NULL" : "";
      const dflt = c.dflt_value !== null ? ` DEFAULT ${c.dflt_value}` : "";
      return `${c.name} ${c.type || "TEXT"}${pk}${notnull}${dflt}`;
    })
    .join(",\n        ");
  const columnList = cols.map((c) => c.name).join(", ");

  db.transaction(() => {
    db.exec("DROP TABLE IF EXISTS companies_vat_period_rebuild;");
    db.exec(`CREATE TABLE companies_vat_period_rebuild (\n        ${newColumns}\n      );`);
    db.exec(
      `INSERT INTO companies_vat_period_rebuild (${columnList}) SELECT ${columnList} FROM companies;`,
    );
    db.exec("DROP TABLE companies;");
    db.exec("ALTER TABLE companies_vat_period_rebuild RENAME TO companies;");
  })();
}
