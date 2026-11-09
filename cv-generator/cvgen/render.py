"""Render the CV context into a Word template (docxtpl / Jinja tags) and convert to PDF."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from docx.shared import Mm
from docxtpl import DocxTemplate, InlineImage


class RenderError(RuntimeError):
    pass


def template_variables(template_path: str | Path) -> set[str]:
    return DocxTemplate(str(template_path)).get_undeclared_template_variables()


def render_docx(context: dict, template_path: str | Path, out_path: str | Path,
                photo_width_mm: float = 32) -> Path:
    tpl = DocxTemplate(str(template_path))
    ctx = dict(context)
    photo = ctx.get("photo_path")
    if photo and Path(photo).exists():
        ctx["photo"] = InlineImage(tpl, str(photo), width=Mm(photo_width_mm))
    else:
        ctx["photo"] = ""
    tpl.render(ctx, autoescape=True)
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    tpl.save(str(out))
    return out


def _find_soffice() -> str | None:
    for name in ("soffice", "libreoffice"):
        p = shutil.which(name)
        if p:
            return p
    mac = Path("/Applications/LibreOffice.app/Contents/MacOS/soffice")
    if mac.exists():
        return str(mac)
    win = Path(r"C:\Program Files\LibreOffice\program\soffice.exe")
    if win.exists():
        return str(win)
    return None


def docx_to_pdf(docx_path: str | Path, out_dir: str | Path | None = None) -> Path:
    """Convert with LibreOffice (preferred, cross-platform) or MS Word via docx2pdf."""
    docx_path = Path(docx_path)
    out_dir = Path(out_dir or docx_path.parent)
    soffice = _find_soffice()
    if soffice:
        with tempfile.TemporaryDirectory() as profile_dir:
            cmd = [soffice, f"-env:UserInstallation=file://{profile_dir}", "--headless",
                   "--convert-to", "pdf", "--outdir", str(out_dir), str(docx_path)]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        pdf = out_dir / (docx_path.stem + ".pdf")
        if res.returncode != 0 or not pdf.exists():
            raise RenderError(f"LibreOffice PDF conversion failed: {res.stderr or res.stdout}")
        return pdf
    try:
        from docx2pdf import convert  # type: ignore  # uses MS Word on Windows/macOS
    except ImportError as exc:
        raise RenderError(
            "No PDF converter found. Install LibreOffice (recommended) or `pip install docx2pdf` "
            "(requires Microsoft Word)."
        ) from exc
    pdf = out_dir / (docx_path.stem + ".pdf")
    convert(str(docx_path), str(pdf))
    return pdf


def pdf_to_images(pdf_path: str | Path, out_dir: str | Path, prefix: str = "page",
                  scale: float = 1.5) -> int:
    """Render each PDF page to ``<prefix>-<n>.png`` (for previews that work in every browser).

    Returns the number of pages rendered (0 if no renderer is available).
    """
    out_dir = Path(out_dir)
    for old in out_dir.glob(f"{prefix}-*.png"):
        old.unlink()
    try:
        import pypdfium2 as pdfium
    except ImportError:
        return 0
    pdf = pdfium.PdfDocument(str(pdf_path))
    try:
        for i in range(len(pdf)):
            img = pdf[i].render(scale=scale).to_pil()
            img.save(out_dir / f"{prefix}-{i + 1}.png", optimize=True)
        return len(pdf)
    finally:
        pdf.close()
