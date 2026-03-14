import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

export async function GET() {
    const photos = await sql`
    SELECT
      id,
      friendly_name,
      thumb_name,
      large_name,
      original_name,
      lat,
      lon,
      caption,
      date
    FROM photos
    ORDER BY date DESC
  `;

    return Response.json(photos);
}