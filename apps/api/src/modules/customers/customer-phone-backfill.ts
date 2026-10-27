import { normalizeCustomerPhone } from './customer-crm.service';

export type PhoneBackfillRow = { id: string; phone: string; active: boolean };

export type PhoneBackfillPlan = {
  /** Customers whose stored phone becomes E.164. */
  updates: { id: string; from: string; to: string }[];
  /** Left untouched: the target number is already used, or two customers would share it. */
  collisions: { id: string; from: string; to: string; otherId: string }[];
  /** Phones that cannot be normalised (erased, foreign junk): never modified. */
  unparseable: number;
};

/**
 * Plans the E.164 backfill for one restaurant. `phone` is unique per restaurant across archived
 * rows too, so every row counts as an occupant; only active customers are ever rewritten.
 */
export function planPhoneBackfill(rows: PhoneBackfillRow[]): PhoneBackfillPlan {
  const owners = new Map(rows.map((row) => [row.phone, row.id]));
  const plan: PhoneBackfillPlan = { updates: [], collisions: [], unparseable: 0 };
  for (const row of rows) {
    if (!row.active) continue;
    const to = normalizeCustomerPhone(row.phone);
    if (!to) {
      plan.unparseable += 1;
      continue;
    }
    if (to === row.phone) continue;
    const otherId = owners.get(to);
    if (otherId && otherId !== row.id) {
      plan.collisions.push({ id: row.id, from: row.phone, to, otherId });
      continue;
    }
    owners.set(to, row.id);
    plan.updates.push({ id: row.id, from: row.phone, to });
  }
  return plan;
}
