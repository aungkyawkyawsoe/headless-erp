import json
import urllib.request

TOKEN = "dev-token"
BASE = "http://localhost:8788/api/collections"


def get(url: str):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


cols = get(BASE)["data"]
for c in cols:
    slug = c["slug"]
    d = get(f"{BASE}/{slug}")["data"]
    s = d["schema_json"] if isinstance(d["schema_json"], dict) else json.loads(d["schema_json"])
    so = d.get("system_field_options") or {}
    tags = []
    if so.get("doc_status"):
        tags.append("DOCSTATUS")
    if so.get("display_number"):
        tags.append("DISPNUM")
    if d.get("naming_series"):
        tags.append(f"NAMING={d['naming_series']}")
    rel = [
        (f["name"], f.get("type"), f.get("related_collection"), f.get("foreign_key", ""))
        for f in s.get("fields", [])
        if f.get("type") in ("o2m", "m2o", "m2m", "m2a", "table")
    ]
    print(f"{slug:24} {' '.join(tags):24} rel={rel}")
