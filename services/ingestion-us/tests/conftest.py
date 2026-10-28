import sys
from pathlib import Path

# Make `app.*` importable when pytest is invoked from the repository root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
