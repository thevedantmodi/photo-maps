#!/usr/bin/env python3
"""
One-time migration: upload public/photos/* to R2 and upsert rows into Neon DB.
Safe to rerun — upserts on friendly_name conflict.

Requires: pip install boto3 psycopg2-binary python-dotenv
"""
import json
import os
from pathlib import Path

import boto3
import psycopg2
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env.local")

ENDPOINT = os.environ["R2_ENDPOINT"]
BUCKET = os.environ["R2_BUCKET"]
ACCESS_KEY = os.environ["R2_ACCESS_KEY_ID"]
SECRET_KEY = os.environ["R2_SECRET_ACCESS_KEY"]
DATABASE_URL = os.environ["DATABASE_URL_UNPOOLED"]

DATA_FILE = BASE_DIR / "public" / "data.json"
PHOTOS_DIR = BASE_DIR / "public" / "photos"


def main():
    s3 = boto3.client(
        "s3",
        endpoint_url=ENDPOINT,
        aws_access_key_id=ACCESS_KEY,
        aws_secret_access_key=SECRET_KEY,
        region_name="auto",
    )

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    with open(DATA_FILE, encoding="utf-8") as f:
        photos = json.load(f)

    print(f"Migrating {len(photos)} photos...")

    for photo in photos:
        friendly_name = photo["id"]
        # Strip "/photos/" prefix to get bare filenames as R2 keys
        thumb_name = photo["thumb"].lstrip("/").removeprefix("photos/")
        large_name = photo["large"].lstrip("/").removeprefix("photos/")

        # Upload thumb
        thumb_path = PHOTOS_DIR / thumb_name
        if thumb_path.exists():
            with open(thumb_path, "rb") as f:
                s3.put_object(Bucket=BUCKET, Key=thumb_name, Body=f, ContentType="image/jpeg")
            print(f"  Uploaded {thumb_name}")
        else:
            print(f"  WARNING: {thumb_path} not found, skipping upload")

        # Upload large
        large_path = PHOTOS_DIR / large_name
        if large_path.exists():
            with open(large_path, "rb") as f:
                s3.put_object(Bucket=BUCKET, Key=large_name, Body=f, ContentType="image/jpeg")
            print(f"  Uploaded {large_name}")
        else:
            print(f"  WARNING: {large_path} not found, skipping upload")

        # Parse date — data.json stores ISO strings without timezone
        date_val = photo.get("date") or None

        cur.execute(
            """
            INSERT INTO photos
                (friendly_name, thumb_name, large_name, original_name, lat, lon, caption, date, status)
            VALUES
                (%s, %s, %s, %s, %s, %s, %s, %s, 'published')
            ON CONFLICT (friendly_name) DO UPDATE SET
                thumb_name   = EXCLUDED.thumb_name,
                large_name   = EXCLUDED.large_name,
                original_name = EXCLUDED.original_name,
                lat          = EXCLUDED.lat,
                lon          = EXCLUDED.lon,
                caption      = EXCLUDED.caption,
                date         = EXCLUDED.date,
                status       = 'published'
            """,
            (
                friendly_name,
                thumb_name,
                large_name,
                photo.get("originalName", ""),
                photo.get("lat"),
                photo.get("lng"),   # data.json uses lng; DB column is lon
                photo.get("caption") or None,
                date_val,
            ),
        )

    conn.commit()
    cur.close()
    conn.close()
    print(f"\nDone! {len(photos)} rows upserted.")


if __name__ == "__main__":
    main()
