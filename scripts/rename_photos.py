#!/usr/bin/env python3
import base64
from pathlib import Path

EXTENSIONS = {".jpg", ".jpeg", ".png", ".JPG", ".JPEG", ".PNG"}


def show_image_iterm2(path):
    with open(path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("ascii")
    print(
        f"\033]1337;File=inline=1;width=auto;height=auto;preserveAspectRatio=1:{encoded}\a",
        flush=True,
    )


def sanitize(name):
    return name.strip().lower().replace(" ", "-")


def main():
    photos = sorted(p for p in Path(".").iterdir() if p.suffix in EXTENSIONS)

    for photo in photos:
        print(f"\n📷 Current file: {photo.name}\n")
        show_image_iterm2(photo)

        new = input("\nregion-landmark (ENTER skip, q quit): ").strip()

        if new == "q":
            break
        if not new:
            continue

        new = sanitize(new)
        target = photo.with_name(f"{new}{photo.suffix}")

        if target.exists():
            print("⚠️ File exists, skipping")
            continue

        photo.rename(target)
        print(f"✅ Renamed → {target.name}")


if __name__ == "__main__":
    main()
