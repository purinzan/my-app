// src/lib/db.ts
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) throw new Error("missing TURSO_DATABASE_URL");
if (!authToken) throw new Error("missing TURSO_AUTH_TOKEN");

export const tursoClient = createClient({ url, authToken });
