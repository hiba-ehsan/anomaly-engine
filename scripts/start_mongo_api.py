"""Start Mongo-API (Express, the E in MERN) detached on :8081 via WMI.

Mirrors start-dev.ps1's launcher pattern (WMI + CurrentDirectory + cmd shim)
so process survival is not tied to the spawning command's shell lifetime.
"""

from __future__ import annotations

import subprocess
import sys
import time

SERVICE_NAME = "mongo-api (Express :8081)"
CMD_LAUNCHER = r"D:\Anomaly Engine\scripts\run-mongo-api.cmd"
WORKDIR = r"D:\Anomaly Engine\services\mongo-api"


def main() -> int:
    import wmi  # type: ignore

    conn = wmi.WMI()
    result, pid, ret = conn.Win32_Process.Create(
        CommandLine=f'cmd.exe /c "{CMD_LAUNCHER}"',
        CurrentDirectory=WORKDIR,
    )
    if result != 0:
        print(f"[mongo-api] Win32_Process.Create failed rc={result}")
        return 1
    print(f"[mongo-api] detached pid={pid} (rc={result})")

    ok = False
    for _ in range(15):
        time.sleep(1)
        try:
            r = subprocess.run(
                ["curl", "-s", "-o", "NUL", "-w", "%{http_code}", "http://127.0.0.1:8081/health"],
                capture_output=True,
                text=True,
                timeout=20,
            )
            if r.returncode == 0 and r.stdout.strip().startswith("2"):
                ok = True
                break
        except Exception:
            pass
    print(f"[mongo-api] health {'UP' if ok else 'NOT up after 15s'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
