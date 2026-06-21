// One-shot helper: opens the live ledger and calls the existing seedAccounts()
// function. seedAccounts uses INSERT OR IGNORE, so existing accounts stay
// untouched and only the newly-added rows in src/core/ledger.ts get inserted.
// Sanctioned mutation path — same function init uses — without the destructive
// reset of running init again. Delete this file after the rows are in.
import { openDb, migrate } from "../src/core/db";
import { seedAccounts } from "../src/core/ledger";
import { companyPaths } from "../src/core/paths";

const companyRoot = process.argv[2];
if (!companyRoot) {
  console.error("usage: bun run scripts/one-shot-seed-accounts.ts <company-root>");
  process.exit(2);
}
const db = openDb(companyPaths(companyRoot).db);
migrate(db);
const before = db.query("SELECT COUNT(*) AS n FROM accounts").get() as { n: number };
seedAccounts(db);
const after = db.query("SELECT COUNT(*) AS n FROM accounts").get() as { n: number };
console.log(JSON.stringify({ ok: true, accountsBefore: before.n, accountsAfter: after.n, added: after.n - before.n }, null, 2));
db.close();
