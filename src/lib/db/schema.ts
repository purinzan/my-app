import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";

export const pricesDaily = sqliteTable(
  "prices_daily",
  {
    code: text("code").notNull(), // 例: "7203"
    date: text("date").notNull(), // "YYYY-MM-DD"
    open: real("open"),
    high: real("high"),
    low: real("low"),
    close: real("close"),
    volume: integer("volume"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.code, t.date] }),
  })
);
