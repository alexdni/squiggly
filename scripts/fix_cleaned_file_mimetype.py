#!/usr/bin/env python3
"""
One-off repair: fix cleaned EEG exports stored with the wrong mimetype.

Before commit 4bd9a3d the worker uploaded cleaned_raw.{edf,bdf,csv} to the
'visuals' bucket with content-type image/png, so browsers rendered the file as
a broken image instead of downloading it. This script:

  1. Finds every completed analysis whose results carry a cleaned_file_url.
  2. Checks the stored object's mimetype in Supabase Storage.
  3. If wrong, downloads the bytes and re-uploads them (upsert) with the
     correct content type.
  4. Mints a fresh signed URL with download=<filename> (forces
     Content-Disposition: attachment) and writes it back to
     analyses.results.cleaned_file_url, preserving the rest of results.

Dry-run by default. Pass --apply to make changes.

Usage:
  python scripts/fix_cleaned_file_mimetype.py            # report only
  python scripts/fix_cleaned_file_mimetype.py --apply    # fix
  python scripts/fix_cleaned_file_mimetype.py --apply --analysis <uuid>

Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
environment, falling back to .env.local in the repo root.
Requires: supabase==2.10.0 (same pin as api/workers/requirements.txt).
"""

import argparse
import os
import sys
from pathlib import Path

BUCKET = "visuals"
SIGNED_URL_TTL = 60 * 60 * 24 * 365  # 1 year, matches the worker

CONTENT_TYPES = {
    ".edf": "application/octet-stream",
    ".bdf": "application/octet-stream",
    ".csv": "text/csv",
}


def load_env():
    """Populate os.environ from .env.local if the keys are not already set."""
    env_path = Path(__file__).resolve().parents[1] / ".env.local"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def normalise_url(url: str) -> str:
    url = url.strip().rstrip("/")
    if not url.startswith("http"):
        url = "https://" + url
    return url


def get_object_mimetype(bucket, analysis_id: str, file_name: str):
    """Return the stored mimetype for {analysis_id}/{file_name}, or None if missing."""
    for obj in bucket.list(analysis_id, {"limit": 1000}):
        if obj.get("name") == file_name:
            return (obj.get("metadata") or {}).get("mimetype")
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--apply", action="store_true", help="make changes (default: dry run)")
    parser.add_argument("--analysis", help="only process this analysis id")
    args = parser.parse_args()

    load_env()
    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not supabase_key:
        print("error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required", file=sys.stderr)
        return 2

    from supabase import create_client

    client = create_client(normalise_url(supabase_url), supabase_key)
    bucket = client.storage.from_(BUCKET)

    query = client.table("analyses").select("id, results").eq("status", "completed")
    if args.analysis:
        query = query.eq("id", args.analysis)
    rows = query.execute().data or []

    candidates = [r for r in rows if (r.get("results") or {}).get("cleaned_file_url")]
    print(f"{'APPLY' if args.apply else 'DRY RUN'}: {len(candidates)} completed analyses have a cleaned file")

    fixed = skipped = missing = failed = 0
    for row in candidates:
        analysis_id = row["id"]
        results = row["results"]
        ext = results.get("cleaned_file_format", ".edf")
        expected_type = CONTENT_TYPES.get(ext, "application/octet-stream")
        file_name = f"cleaned_raw{ext}"
        object_path = f"{analysis_id}/{file_name}"

        try:
            current_type = get_object_mimetype(bucket, analysis_id, file_name)
        except Exception as e:
            print(f"  {object_path}: FAILED to list ({e})")
            failed += 1
            continue

        if current_type is None:
            print(f"  {object_path}: object not found in storage, skipping")
            missing += 1
            continue

        url_has_download = "download=" in results["cleaned_file_url"]
        if current_type == expected_type and url_has_download:
            skipped += 1
            continue

        print(f"  {object_path}: mimetype {current_type} -> {expected_type}, url download param: {url_has_download}")
        if not args.apply:
            fixed += 1
            continue

        try:
            if current_type != expected_type:
                data = bucket.download(object_path)
                bucket.upload(
                    object_path,
                    data,
                    file_options={"content-type": expected_type, "upsert": "true"},
                )

            signed = bucket.create_signed_url(
                object_path, SIGNED_URL_TTL, options={"download": file_name}
            )
            new_url = signed.get("signedURL") if isinstance(signed, dict) else None
            if not new_url:
                raise RuntimeError(f"no signedURL in response: {signed!r}")

            # Re-read results immediately before writing to avoid clobbering
            # anything (e.g. ai_interpretation) that changed since the select.
            fresh = client.table("analyses").select("results").eq("id", analysis_id).single().execute()
            merged = dict(fresh.data.get("results") or {})
            merged["cleaned_file_url"] = new_url
            client.table("analyses").update({"results": merged}).eq("id", analysis_id).execute()

            print(f"    fixed")
            fixed += 1
        except Exception as e:
            print(f"    FAILED: {e}")
            failed += 1

    verb = "fixed" if args.apply else "would fix"
    print(f"\n{verb}: {fixed}, already ok: {skipped}, missing object: {missing}, failed: {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
