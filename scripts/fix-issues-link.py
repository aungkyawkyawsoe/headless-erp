import json
import urllib.request

TOKEN = "dev-token"
BASE = "http://localhost:8788/api/collections"


def get(url: str):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def put(url: str, body):
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method="PUT",
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def fields_of(slug):
    d = get(f"{BASE}/{slug}")["data"]
    s = d["schema_json"] if isinstance(d["schema_json"], dict) else json.loads(d["schema_json"])
    return d, s


# 1) fleet_issue_logs gains an m2o back-reference to the maintenance log it belongs to.
issue_slug = "fleet_issue_logs"
issue_d, issue_s = fields_of(issue_slug)
names = {f["name"] for f in issue_s["fields"]}
if "maintenance_log" in names:
    print(f"{issue_slug}: already has maintenance_log m2o — nothing to add")
else:
    issue_s["fields"].append(
        {
            "name": "maintenance_log",
            "type": "m2o",
            "label": "Maintenance Log",
            "required": False,
            "related_collection": "fleet_maintenance_logs",
        }
    )
    put(f"{BASE}/{issue_slug}", {"fields": issue_s["fields"]})
    print(f"{issue_slug}: added maintenance_log m2o -> fleet_maintenance_logs")

# 2) fleet_maintenance_logs.issues must link through that back-reference.
log_slug = "fleet_maintenance_logs"
log_d, log_s = fields_of(log_slug)
for f in log_s["fields"]:
    if f.get("type") == "o2m" and f.get("related_collection") == issue_slug and f.get("foreign_key") != "maintenance_log":
        f["foreign_key"] = "maintenance_log"
        put(f"{BASE}/{log_slug}", {"fields": log_s["fields"]})
        print(f"{log_slug}: issues.foreign_key -> maintenance_log")
        break
else:
    print(f"{log_slug}: issues o2m already points at maintenance_log (or missing)")
