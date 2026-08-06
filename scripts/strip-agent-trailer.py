"""Remove Co-authored-by: Cursor lines from a git commit message (stdin -> stdout)."""
import sys

msg = sys.stdin.read()
lines = msg.splitlines(keepends=True)
out = "".join(l for l in lines if not l.strip().startswith("Co-authored-by: Cursor"))
out = out.rstrip("\n") + "\n" if out.strip() else ""
sys.stdout.write(out)
