"""
Scan all plot .txt files and print the unique set of tag names found.

Tags are square-bracket directives like [Background(...)], [name="..."], [Dialog].
Only the tag name (the first identifier inside '[') is extracted, lowercased.
Lines are read one at a time to avoid loading large files into memory.

Usage:
    python scripts/list_tags.py
"""

import os
import re

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "plots")

# Matches the tag name at the start of a [...] block, e.g.
#   [Background(...]  →  "Background"
#   [name="..."]      →  "name"
#   [Dialog]          →  "Dialog"
TAG_RE = re.compile(r"\[([A-Za-z_][A-Za-z0-9_]*)")

# tag → (relative_path, line_number, raw_line)
examples: dict[str, tuple[str, int, str]] = {}

for root, _, files in os.walk(DATA_DIR):
    for fname in files:
        if not fname.endswith(".txt"):
            continue
        fpath = os.path.join(root, fname)
        rel = os.path.relpath(fpath, DATA_DIR)
        with open(fpath, encoding="utf-8") as f:
            for lineno, line in enumerate(f, 1):
                for match in TAG_RE.finditer(line):
                    tag = match.group(1).lower()
                    if tag not in examples:
                        examples[tag] = (rel, lineno, line.rstrip())

print(f"Found {len(examples)} unique tags:\n")
for tag in sorted(examples):
    path, lineno, raw = examples[tag]
    print(f"  {tag}")
    print(f"    {path}:{lineno}")
    print(f"    {raw[:120]}")
    print()
