import json
import sys
import urllib.request

TOKEN = "dev-token"
BASE = "http://localhost:8788/api/collections"


def get(url: str):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


for slug in sys.argv[1:]:
    d = get(f"{BASE}/{slug}")["data"]
    s = d["schema_json"] if isinstance(d["schema_json"], dict) else json.loads(d["schema_json"])
    print(f"===== {slug} =====  naming={d.get('naming_series')}")
    for f in s.get("fields", []):
        extra = ""
        if f.get("type") in ("o2m", "m2o", "m2m", "m2a", "table"):
            extra = f"  rel={f.get('related_collection')} fk={f.get('foreign_key', '')}"
        print(
            f"  {f.get('name'):24} {f.get('type'):10} req={str(f.get('required')):5} def={str(f.get('default')):12} label={f.get('label', '')!r}{extra}"
        )
