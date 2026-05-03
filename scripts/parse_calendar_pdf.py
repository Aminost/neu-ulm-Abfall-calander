"""Final 2026 calendar parser. Iterate to the actual grid footer (Wertstoffhof line)."""
import re, json, subprocess
from datetime import date

text = subprocess.check_output(
    ["pdftotext", "-layout",
     "/sessions/stoic-ecstatic-hamilton/mnt/uploads/Neu-Ulm_Abfallkalender-2026_Web.pdf", "-"],
).decode("utf-8")
lines = text.split("\n")

MONTHS = [("Januar",1),("Februar",2),("März",3),("April",4),("Mai",5),("Juni",6),
          ("Juli",7),("August",8),("September",9),("Oktober",10),("November",11),("Dezember",12)]

# Grid bounds: header line idx (top) and footer line idx (bottom).
GRIDS = [(67, 123, MONTHS[:6]), (127, 193, MONTHS[6:])]

PAD = 2  # 2-digit days right-aligned: "10 Sa" starts 2 cols before header.

events = {b: set() for b in range(1, 9)}

def parse_cell(cell):
    m = re.match(r"\s*(\d{1,2})\s+(Mo|Di|Mi|Do|Fr|Sa|So)\b(.*)", cell)
    if not m:
        return None
    day = int(m.group(1))
    rest = m.group(3)
    items = []
    for n in re.findall(r"R/B\s*(\d)", rest):
        items.append(("Rest- & Biomüll", int(n)))
    for grp in re.findall(r"GS\s*([\d/]+)", rest):
        for n in grp.split("/"):
            items.append(("Gelber Sack", int(n)))
    for grp in re.findall(r"\bP\s+(\d(?:\s*,\s*\d)*)", rest):
        for n in re.findall(r"\d", grp):
            items.append(("Papiertonne", int(n)))
    return day, items

for header_idx, footer_idx, months_in_grid in GRIDS:
    header_line = lines[header_idx]
    starts = [header_line.find(name) for name, num in months_in_grid]
    cols = []
    for i, (name, num) in enumerate(months_in_grid):
        s = max(0, starts[i] - PAD)
        e = (starts[i+1] - PAD) if i+1 < len(months_in_grid) else len(header_line) + 200
        cols.append((name, num, s, e))

    for raw in lines[header_idx+1 : footer_idx]:
        for name, num, s, e in cols:
            cell = raw[s:e] if s < len(raw) else ""
            if not cell.strip():
                continue
            res = parse_cell(cell)
            if not res:
                continue
            day, items = res
            try:
                d = date(2026, num, day)
            except ValueError:
                continue
            for typ, bez in items:
                events[bez].add((d.isoformat(), typ))

# Summary
total = 0
for b in range(1, 9):
    n = len(events[b])
    total += n
    types = {}
    for _, t in events[b]:
        types[t] = types.get(t, 0) + 1
    print(f"Bezirk {b}: {n:3d}   {types}")
print(f"TOTAL: {total}")

# Spot check Bezirk 1 R/B (Mo gerade Woche) for the year — should be ~26 events
print("\nBezirk 1 R/B all year:")
b1rb = sorted([d for d, t in events[1] if t == "Rest- & Biomüll"])
print(f"  count: {len(b1rb)}")
for d in b1rb:
    from datetime import date as D
    print(f"    {d} ({D.fromisoformat(d).strftime('%a')})")

# Save
out = {str(b): sorted(events[b]) for b in range(1,9)}
with open("/tmp/abfall2026_events.json", "w") as f:
    json.dump(out, f, indent=2, ensure_ascii=False)
print("\nWrote /tmp/abfall2026_events.json")
