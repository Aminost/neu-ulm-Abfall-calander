"""Builds templates/default.docx -- a clean, ATS-friendly one-column CV template.

Run:  python templates/build_default_template.py

The template is an ordinary Word file containing Jinja tags ({{ name }}, {%p for ... %}).
Open it in Word, change fonts/colours/layout as you like, keep the tags, and save it as your own
template. See README.md -> "Using your own template".
"""

from pathlib import Path

from docx import Document
from docx.enum.text import WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

ACCENT = RGBColor(0x1F, 0x3A, 0x5F)   # deep navy
MUTED = RGBColor(0x55, 0x5F, 0x6D)
FONT = "Calibri"

OUT = Path(__file__).with_name("default.docx")


def bottom_border(paragraph, color="1F3A5F", size=6):
    pPr = paragraph._p.get_or_add_pPr()
    pbdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), str(size))
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), color)
    pbdr.append(bottom)
    pPr.append(pbdr)


def para(doc, text="", size=10.5, bold=False, color=None, italic=False, space_after=2,
         space_before=0, align=None, style=None):
    p = doc.add_paragraph(style=style)
    pf = p.paragraph_format
    pf.space_after = Pt(space_after)
    pf.space_before = Pt(space_before)
    pf.line_spacing = 1.08
    if align is not None:
        p.alignment = align
    if text:
        r = p.add_run(text)
        r.font.size = Pt(size)
        r.font.bold = bold
        r.font.italic = italic
        r.font.name = FONT
        if color is not None:
            r.font.color.rgb = color
    return p


def tag(doc, text):
    """A paragraph that only holds a docxtpl {%p ... %} control tag (removed when rendered)."""
    return para(doc, text, size=2, space_after=0)


def heading(doc, text):
    p = para(doc, text.upper(), size=11, bold=True, color=ACCENT, space_before=10, space_after=4)
    p.runs[0].font.spacing = Pt(1)  # letter spacing is ignored by python-docx; harmless
    bottom_border(p)
    p.paragraph_format.keep_with_next = True
    return p


def entry_line(doc, left_bold, left_rest, right, usable_width):
    """'Title — Company ........ Dates' with a right-aligned tab stop."""
    p = para(doc, space_before=6, space_after=0)
    p.paragraph_format.tab_stops.add_tab_stop(usable_width, WD_TAB_ALIGNMENT.RIGHT)
    p.paragraph_format.keep_with_next = True
    r = p.add_run(left_bold)
    r.font.bold = True
    r.font.size = Pt(11)
    r.font.name = FONT
    r = p.add_run(left_rest)
    r.font.size = Pt(11)
    r.font.name = FONT
    r = p.add_run("\t" + right)
    r.font.size = Pt(10)
    r.font.color.rgb = MUTED
    r.font.name = FONT
    return p


def main():
    doc = Document()
    sec = doc.sections[0]
    sec.page_height, sec.page_width = Cm(29.7), Cm(21.0)  # A4
    sec.left_margin = sec.right_margin = Cm(1.9)
    sec.top_margin = Cm(1.6)
    sec.bottom_margin = Cm(1.5)
    usable = sec.page_width - sec.left_margin - sec.right_margin

    normal = doc.styles["Normal"]
    normal.font.name = FONT
    normal.font.size = Pt(10.5)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)

    lb = doc.styles["List Bullet"]
    lb.font.name = FONT
    lb.font.size = Pt(10.5)

    # ---------------- Header ----------------
    para(doc, "{{ name }}", size=24, bold=True, color=ACCENT, space_after=0)
    para(doc, "{{ headline }}", size=13, color=MUTED, space_after=4)
    para(doc,
         "{{ location }}{% if email %}  |  {{ email }}{% endif %}{% if phone %}  |  {{ phone }}{% endif %}"
         "{% for l in links %}  |  {{ l.url }}{% endfor %}",
         size=9.5, color=MUTED, space_after=6)

    # ---------------- Summary ----------------
    tag(doc, "{%p if summary %}")
    heading(doc, "Profile")
    para(doc, "{{ summary }}", space_after=2)
    tag(doc, "{%p endif %}")

    # ---------------- Experience ----------------
    heading(doc, "Professional Experience")
    tag(doc, "{%p for job in experience %}")
    entry_line(doc, "{{ job.title }}", "  —  {{ job.company }}", "{{ job.dates }}", usable)
    para(doc, "{{ job.location }}{% if job.employment_type %} · {{ job.employment_type }}{% endif %}",
         size=9.5, italic=True, color=MUTED, space_after=2)
    tag(doc, "{%p for b in job.bullets %}")
    bp = para(doc, "{{ b.text }}", style="List Bullet", space_after=1)
    bp.paragraph_format.left_indent = Cm(0.6)
    tag(doc, "{%p endfor %}")
    tag(doc, "{%p endfor %}")

    # ---------------- Skills ----------------
    tag(doc, "{%p if skill_groups %}")
    heading(doc, "Skills")
    tag(doc, "{%p for g in skill_groups %}")
    p = para(doc, space_after=2)
    r = p.add_run("{{ g.category }}: ")
    r.font.bold = True
    r.font.name = FONT
    r = p.add_run("{{ g.joined }}")
    r.font.name = FONT
    tag(doc, "{%p endfor %}")
    tag(doc, "{%p endif %}")

    # ---------------- Projects ----------------
    tag(doc, "{%p if projects %}")
    heading(doc, "Selected Projects")
    tag(doc, "{%p for pr in projects %}")
    entry_line(doc, "{{ pr.name }}", "{% if pr.role %}  —  {{ pr.role }}{% endif %}", "{{ pr.date }}", usable)
    para(doc, "{{ pr.description }}", space_after=2)
    tag(doc, "{%p endfor %}")
    tag(doc, "{%p endif %}")

    # ---------------- Education ----------------
    heading(doc, "Education")
    tag(doc, "{%p for e in education %}")
    entry_line(doc, "{{ e.degree }}", "  —  {{ e.institution }}", "{{ e.dates }}", usable)
    para(doc, "{{ e.location }}{% if e.grade %} · Grade: {{ e.grade }}{% endif %}",
         size=9.5, italic=True, color=MUTED, space_after=1)
    tag(doc, "{%p for d in e.details %}")
    dp = para(doc, "{{ d }}", style="List Bullet", space_after=1)
    dp.paragraph_format.left_indent = Cm(0.6)
    tag(doc, "{%p endfor %}")
    tag(doc, "{%p endfor %}")

    # ---------------- Certifications ----------------
    tag(doc, "{%p if certifications %}")
    heading(doc, "Certifications")
    tag(doc, "{%p for c in certifications %}")
    p = para(doc, space_after=1)
    p.paragraph_format.tab_stops.add_tab_stop(usable, WD_TAB_ALIGNMENT.RIGHT)
    r = p.add_run("{{ c.name }}")
    r.font.bold = True
    r = p.add_run("{% if c.issuer %} — {{ c.issuer }}{% endif %}\t{{ c.date }}")
    tag(doc, "{%p endfor %}")
    tag(doc, "{%p endif %}")

    # ---------------- Languages & interests ----------------
    heading(doc, "Languages")
    para(doc, "{{ languages_joined }}", space_after=2)
    tag(doc, "{%p if interests %}")
    heading(doc, "Interests")
    para(doc, "{{ interests_joined }}", space_after=2)
    tag(doc, "{%p endif %}")

    doc.core_properties.title = "Curriculum Vitae"
    doc.save(OUT)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
