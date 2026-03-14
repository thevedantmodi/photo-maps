import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL)

await sql`
    CREATE TABLE IF NOT EXISTS photos (
        id SERIAL PRIMARY KEY,
        friendly_name TEXT NOT NULL,
        thumb_name TEXT NOT NULL,
        large_name TEXT NOT NULL,
        original_name TEXT NOT NULL,
        lat NUMERIC,
        lon NUMERIC,
        caption TEXT,
        date TIMESTAMP
    )
`

console.log("done!")