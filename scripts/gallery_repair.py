#!/usr/bin/env python3
"""
Fleet-wide gallery repair script.
For each salon with gallery entries, checks if referenced files exist.
Missing files are replaced with stock images from the stock library.
"""

import json
import os
import sys
import hashlib
from datetime import datetime, timezone

SITES_DIR = "/opt/enrich-cms/sites"
STOCK_BASE_URL = "https://cms.enrichco.us/stock"
STOCK_FS_BASE = "/var/www/stock-images"

CATEGORIES_POOL = [
    "nail-art", "manicures", "pedicures", "french-tips", "chrome-nails",
    "glazed-donut", "editorial", "minimalist", "full-set-acrylic", "cat-eye",
    "aura-nails", "butter-yellow", "bold-color", "french-variations"
]

DRY_RUN = "--dry-run" in sys.argv
SINGLE = None
for i, a in enumerate(sys.argv):
    if a == "--single" and i + 1 < len(sys.argv):
        SINGLE = sys.argv[i + 1]

# Pre-load stock files per category
STOCK_FILES = {}
for cat in CATEGORIES_POOL:
    cat_dir = os.path.join(STOCK_FS_BASE, cat)
    if os.path.isdir(cat_dir):
        files = sorted([
            f for f in os.listdir(cat_dir)
            if not f.startswith('_') and not f.startswith('.') and f != 'index.html'
        ])
        STOCK_FILES[cat] = files
    else:
        STOCK_FILES[cat] = []

def hash_int(s):
    return int(hashlib.md5(s.encode()).hexdigest(), 16)

def pick_stock_image(slug, slot_index, used_urls):
    """Pick a stock image for a slot. Cycle categories based on slug hash, pick file by slot hash."""
    cat_start = hash_int(slug) % len(CATEGORIES_POOL)

    # Try categories in rotation order until we find one with an unused image
    for cat_offset in range(len(CATEGORIES_POOL)):
        cat = CATEGORIES_POOL[(cat_start + slot_index + cat_offset) % len(CATEGORIES_POOL)]
        files = STOCK_FILES.get(cat, [])
        if not files:
            continue

        # Try files in hash-based order
        file_start = hash_int(slug + str(slot_index)) % len(files)
        for file_offset in range(len(files)):
            fname = files[(file_start + file_offset) % len(files)]
            url = f"{STOCK_BASE_URL}/{cat}/{fname}"
            if url not in used_urls:
                return url

    # Fallback: just return anything (shouldn't happen with 300+ images)
    cat = CATEGORIES_POOL[cat_start % len(CATEGORIES_POOL)]
    fname = STOCK_FILES[cat][0]
    return f"{STOCK_BASE_URL}/{cat}/{fname}"

def process_salon(slug):
    site_dir = os.path.join(SITES_DIR, slug)
    config_path = os.path.join(site_dir, "config", "salon.json")

    if not os.path.isfile(config_path):
        return None, "no salon.json"

    try:
        with open(config_path, 'r') as f:
            data = json.load(f)
    except Exception as e:
        return None, f"json parse error: {e}"

    # Find gallery key (case-insensitive)
    gallery_key = None
    for k in data:
        if k.lower() == 'gallery':
            gallery_key = k
            break

    if gallery_key is None or not data[gallery_key]:
        return None, "no gallery"

    gallery = data[gallery_key]
    if not isinstance(gallery, list):
        return None, "gallery not a list"

    kept = 0
    replaced = 0
    used_urls = set()

    # First pass: collect already-real URLs to avoid duplication
    for item in gallery:
        src = item.get('src', '')
        if src.startswith('/assets/') or src.startswith('/images/'):
            # Local file - check existence
            rel = src.lstrip('/')
            full_path = os.path.join(site_dir, 'public', rel)
            if os.path.isfile(full_path):
                kept += 1
                # Don't add to used_urls - stock images won't conflict with local paths
        elif src.startswith('https://cms.enrichco.us/stock/'):
            used_urls.add(src)

    modified = False
    slot_replace_idx = 0

    for i, item in enumerate(gallery):
        src = item.get('src', '')

        # Determine if this is a local file reference
        if src.startswith('/assets/') or src.startswith('/images/') or (src.startswith('/') and not src.startswith('//')):
            rel = src.lstrip('/')
            full_path = os.path.join(site_dir, 'public', rel)
            if os.path.isfile(full_path):
                # Real file exists, keep it
                kept += 1
            else:
                # File missing, replace with stock
                new_url = pick_stock_image(slug, slot_replace_idx, used_urls)
                used_urls.add(new_url)
                slot_replace_idx += 1
                item['src'] = new_url
                replaced += 1
                modified = True
        elif src.startswith('https://cms.enrichco.us/stock/'):
            # Already a stock URL - verify it still exists on disk
            parts = src.replace('https://cms.enrichco.us/stock/', '').split('/')
            if len(parts) == 2:
                fs_path = os.path.join(STOCK_FS_BASE, parts[0], parts[1])
                if os.path.isfile(fs_path):
                    kept += 1
                    used_urls.add(src)
                else:
                    # Stock file also missing, replace
                    new_url = pick_stock_image(slug, slot_replace_idx, used_urls)
                    used_urls.add(new_url)
                    slot_replace_idx += 1
                    item['src'] = new_url
                    replaced += 1
                    modified = True
        else:
            # External URL or unknown format - keep as-is
            kept += 1

    if not modified:
        return (kept, 0, kept), "no changes needed"

    if not DRY_RUN:
        ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        backup_path = config_path + f'.bak.gallery-repair-{ts}'
        os.system(f'cp "{config_path}" "{backup_path}"')

        with open(config_path, 'w') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write('\n')

    return (kept, replaced, kept + replaced), "ok"


def main():
    if DRY_RUN:
        print("=== DRY RUN MODE ===")

    slugs = []
    for entry in sorted(os.listdir(SITES_DIR)):
        if entry.startswith('_removed_') or entry.startswith('.'):
            continue
        site_dir = os.path.join(SITES_DIR, entry)
        if not os.path.isdir(site_dir):
            continue
        slugs.append(entry)

    if SINGLE:
        slugs = [s for s in slugs if s == SINGLE]
        if not slugs:
            print(f"ERROR: salon '{SINGLE}' not found")
            sys.exit(1)

    total_salons_modified = 0
    total_kept = 0
    total_replaced = 0
    errors = []
    no_gallery = 0
    no_changes = 0

    for slug in slugs:
        result, msg = process_salon(slug)
        if result is None:
            if msg == "no gallery":
                no_gallery += 1
            else:
                errors.append(f"{slug}: {msg}")
            continue

        kept, replaced, total = result
        total_kept += kept
        total_replaced += replaced

        if replaced > 0:
            total_salons_modified += 1
            print(f"{slug}: kept {kept} real, added {replaced} stock → total {total}")
        else:
            no_changes += 1

    print()
    print("=" * 60)
    print(f"SUMMARY:")
    print(f"  Salons scanned:   {len(slugs)}")
    print(f"  Salons modified:  {total_salons_modified}")
    print(f"  No changes needed: {no_changes}")
    print(f"  No gallery:       {no_gallery}")
    print(f"  Total real kept:  {total_kept}")
    print(f"  Total stock added: {total_replaced}")
    if errors:
        print(f"  ERRORS ({len(errors)}):")
        for e in errors:
            print(f"    {e}")
    print("=" * 60)
    if DRY_RUN:
        print("DRY RUN — no files were modified")


if __name__ == '__main__':
    main()
