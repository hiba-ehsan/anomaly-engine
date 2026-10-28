"""Quick MongoDB debug helper for Anomaly Engine (native Windows)."""

import re
import sys

try:
    from pymongo import MongoClient
except ImportError:
    sys.exit("pymongo not installed: python -m pip install pymongo")

URI = "mongodb://127.0.0.1:27017/anomaly_engine"


def main() -> int:
    try:
        c = MongoClient(URI, serverSelectionTimeoutMS=3000)
        c.admin.command("ping")
    except Exception as e:
        sys.exit(f"mongod NOT reachable @27017: {e}")

    db = c.get_database("anomaly_engine")
    print(f"mongod: ONLINE @127.0.0.1:27017  dbs={c.list_database_names()}")
    print(f"collections: {db.list_collection_names()}")
    for name in db.list_collection_names():
        if not name.startswith("raw_"):
            cnt = db[name].count_documents({})
            print(f"  {name}: {cnt} docs")
            if cnt and name not in ("engine_meta",):
                one = db[name].find_one()
                sample = str(one)[:220]
                print(f"    sample: {sample}")


if __name__ == "__main__":
    raise SystemExit(main())
