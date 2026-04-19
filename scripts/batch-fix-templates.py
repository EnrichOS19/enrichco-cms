#!/usr/bin/env python3
"""
Batch fix salon templates:
1. Logo support: inject branding.logo conditional into Navbar/Navigation + Footer
2. Services format: migrate old object-key access to array iteration

Run on server: python3 /opt/enrich-cms/scripts/batch-fix-templates.py
"""

import os, re, json, sys

SITES_DIR = os.environ.get("SITES_DIR", "/opt/enrich-cms/sites")
DRY_RUN = "--dry-run" in sys.argv

fixed_logo_nav = []
fixed_logo_footer = []
fixed_services = []
skipped = []
errors = []

def read_file(path):
    with open(path, "r") as f:
        return f.read()

def write_file(path, content):
    if DRY_RUN:
        return
    # Backup first
    backup = path + ".bak.batch"
    if not os.path.exists(backup):
        with open(path, "r") as f:
            with open(backup, "w") as b:
                b.write(f.read())
    with open(path, "w") as f:
        f.write(content)

# ─── Logo fix snippet ───
LOGO_IMG = 'salon.branding?.logo ? (<img src={salon.branding.logo} alt={salon.name} className="h-10 w-auto object-contain" />) : ('
LOGO_IMG_CLOSE = ')'

def fix_nav_logo(filepath, slug):
    """Inject logo conditional into nav component."""
    content = read_file(filepath)

    # Skip if already has logo.png img
    if "logo.png" in content and ("<img" in content or "<Image" in content):
        return False

    # Ensure salon import exists
    if "salon" not in content:
        # Try to add import
        if "from '@/lib/salon'" not in content and 'from "@/lib/salon"' not in content:
            # Add import after last import line
            lines = content.split('\n')
            last_import = 0
            for i, line in enumerate(lines):
                if line.strip().startswith('import '):
                    last_import = i
            lines.insert(last_import + 1, "import { salon } from '@/lib/salon'")
            content = '\n'.join(lines)

    # Pattern 1: Old template — <div> with initials like <span className="...">FN</span>
    # Find the logo/brand area: usually a <div> with initials text
    pattern_initials = re.compile(
        r'(<div[^>]*(?:flex items-center justify-center|bg-rust|bg-primary|rounded-full)[^>]*>[\s\S]*?'
        r'<span[^>]*(?:font-heading|text-lg|text-xl)[^>]*>[A-Z]{1,3}</span>[\s\S]*?</div>)',
        re.MULTILINE
    )

    match = pattern_initials.search(content)
    if match:
        old_div = match.group(1)
        # Wrap with logo conditional
        replacement = f"""{{salon.branding?.logo ? (
            <img src={{salon.branding.logo}} alt={{salon.name}} className="h-10 w-auto object-contain" />
          ) : (
            {old_div}
          )}}"""
        content = content.replace(old_div, replacement, 1)
        write_file(filepath, content)
        return True

    # Pattern 2: New template — salon name text without any logo image
    # Look for Link href="/" with salon name span inside
    pattern_name_only = re.compile(
        r'(<Link\s+href="/"\s*className="[^"]*">\s*)'
        r'(\s*<(?:span|h1|p)[^>]*>[^<]*(?:salon\.name|{salon\.name})[^<]*</(?:span|h1|p)>)',
        re.MULTILINE
    )

    match2 = pattern_name_only.search(content)
    if match2:
        link_open = match2.group(1)
        name_el = match2.group(2)
        replacement = f"""{link_open}
          {{salon.branding?.logo && (
            <img src={{salon.branding.logo}} alt={{salon.name}} className="h-8 w-auto object-contain mr-2" />
          )}}
          {name_el}"""
        content = content[:match2.start()] + replacement + content[match2.end():]
        write_file(filepath, content)
        return True

    # Pattern 3: Simple — just inject a logo img before the first salon name reference
    if 'salon.name' in content or 'salon.' in content:
        # Find the nav brand area — usually first Link href="/"
        link_match = re.search(r'(<Link\s+href="/"[^>]*>)', content)
        if link_match:
            insert_pos = link_match.end()
            logo_snippet = """
          {salon.branding?.logo && (
            <img src={salon.branding.logo} alt={salon.name} className="h-8 w-auto object-contain" />
          )}"""
            content = content[:insert_pos] + logo_snippet + content[insert_pos:]
            write_file(filepath, content)
            return True

    return False

def fix_footer_logo(filepath, slug):
    """Inject logo into footer component."""
    content = read_file(filepath)

    if "logo.png" in content and ("<img" in content or "<Image" in content):
        return False

    # Ensure salon import
    if 'salon' not in content:
        if "from '@/lib/salon'" not in content and 'from "@/lib/salon"' not in content:
            lines = content.split('\n')
            last_import = 0
            for i, line in enumerate(lines):
                if line.strip().startswith('import '):
                    last_import = i
            lines.insert(last_import + 1, "import { salon } from '@/lib/salon'")
            content = '\n'.join(lines)

    # Pattern: Footer brand area with initials div (same as nav)
    pattern_initials = re.compile(
        r'(<div[^>]*(?:flex items-center justify-center|bg-rust|bg-primary|rounded-full)[^>]*>[\s\S]*?'
        r'<span[^>]*(?:font-heading|text-lg|text-xl)[^>]*>[A-Z]{1,3}</span>[\s\S]*?</div>)',
        re.MULTILINE
    )

    match = pattern_initials.search(content)
    if match:
        old_div = match.group(1)
        replacement = f"""{{salon.branding?.logo ? (
            <img src={{salon.branding.logo}} alt={{salon.name}} className="h-10 w-auto object-contain" />
          ) : (
            {old_div}
          )}}"""
        content = content.replace(old_div, replacement, 1)
        write_file(filepath, content)
        return True

    return False

def fix_services_page(filepath, slug):
    """Migrate old object-key services to array iteration."""
    content = read_file(filepath)

    # Check if it uses old format: salon.services.nails, salon.services.pedicures, etc.
    if not re.search(r'salon\.services\.\w+', content):
        return False  # Already uses array format

    # Skip if already has Array.isArray or .map on salon.services directly
    if 'Array.isArray(salon.services)' in content or 'salon.services.map' in content:
        return False

    # Find the categories definition — usually a const categories = [...]
    cat_pattern = re.compile(
        r'(const\s+categories\s*=\s*\[[\s\S]*?\])',
        re.MULTILINE
    )

    match = cat_pattern.search(content)
    if match:
        old_categories = match.group(1)

        # Extract color values from the old definition
        colors = re.findall(r"'(bg-[a-z-]+)'", old_categories)
        if not colors:
            colors = ['bg-rust', 'bg-gold', 'bg-ink', 'bg-deep-brown']
        colors_str = ', '.join(f"'{c}'" for c in colors[:4])

        # Check if ServiceItem type is defined
        has_type = 'ServiceItem' in content or 'type Service' in content
        type_annotation = ': { category: string; items: any[] }' if not has_type else ''

        replacement = f"""const accentColors = [{colors_str}]
  const services = Array.isArray(salon.services) ? salon.services : []
  const categories = services.map((cat{type_annotation}, i: number) => ({{
    title: cat.category,
    items: cat.items || [],
    color: accentColors[i % accentColors.length],
  }}))"""

        content = content.replace(old_categories, replacement)

        # Also fix any remaining salon.services.xxx references
        content = re.sub(r'salon\.services\.\w+', 'cat.items', content)

        write_file(filepath, content)
        return True

    return False

# ─── Main ───
print(f"{'DRY RUN — ' if DRY_RUN else ''}Batch template fix starting...")
print(f"Sites directory: {SITES_DIR}\n")

for slug in sorted(os.listdir(SITES_DIR)):
    site_dir = os.path.join(SITES_DIR, slug)
    if not os.path.isdir(site_dir) or slug.startswith("_removed"):
        continue

    config_path = os.path.join(site_dir, "config", "salon.json")
    if not os.path.exists(config_path):
        continue

    # Find nav component
    nav_paths = [
        os.path.join(site_dir, "components", "layout", "Navbar.tsx"),
        os.path.join(site_dir, "src", "components", "Navigation.tsx"),
    ]

    footer_paths = [
        os.path.join(site_dir, "components", "layout", "Footer.tsx"),
        os.path.join(site_dir, "src", "components", "Footer.tsx"),
    ]

    services_path = os.path.join(site_dir, "app", "services", "page.tsx")
    if not os.path.exists(services_path):
        services_path = os.path.join(site_dir, "src", "app", "services", "page.tsx")

    # Fix nav logo
    for nav_path in nav_paths:
        if os.path.exists(nav_path):
            try:
                if fix_nav_logo(nav_path, slug):
                    fixed_logo_nav.append(slug)
                    print(f"  ✓ Logo nav: {slug}")
            except Exception as e:
                errors.append(f"Nav logo {slug}: {e}")
                print(f"  ✗ Logo nav ERROR {slug}: {e}")
            break

    # Fix footer logo
    for footer_path in footer_paths:
        if os.path.exists(footer_path):
            try:
                if fix_footer_logo(footer_path, slug):
                    fixed_logo_footer.append(slug)
                    print(f"  ✓ Logo footer: {slug}")
            except Exception as e:
                errors.append(f"Footer logo {slug}: {e}")
                print(f"  ✗ Logo footer ERROR {slug}: {e}")
            break

    # Fix services
    if os.path.exists(services_path):
        try:
            if fix_services_page(services_path, slug):
                fixed_services.append(slug)
                print(f"  ✓ Services: {slug}")
        except Exception as e:
            errors.append(f"Services {slug}: {e}")
            print(f"  ✗ Services ERROR {slug}: {e}")

print(f"\n{'='*60}")
print(f"RESULTS {'(DRY RUN)' if DRY_RUN else ''}")
print(f"{'='*60}")
print(f"Nav logo fixed:     {len(fixed_logo_nav)}")
print(f"Footer logo fixed:  {len(fixed_logo_footer)}")
print(f"Services fixed:     {len(fixed_services)}")
print(f"Errors:             {len(errors)}")

if errors:
    print(f"\nErrors:")
    for e in errors:
        print(f"  - {e}")

if fixed_logo_nav:
    print(f"\nNav logo sites: {', '.join(fixed_logo_nav)}")
if fixed_services:
    print(f"\nServices sites: {', '.join(fixed_services)}")
