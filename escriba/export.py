from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape
import os
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, KeepTogether


def timestamp(seconds):
    total = int(seconds)
    return f"{total // 3600:02d}:{total // 60 % 60:02d}:{total % 60:02d}"


def clean(value):
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", str(value))


def display_date(value):
    if not value:
        return ""
    date = datetime.fromisoformat(value)
    return date.strftime("%d/%m/%Y às %H:%M:%S" if "T" in value else "%d/%m/%Y")


def plain_text(job):
    options = job["options"]
    sections = []
    for index, item in enumerate(job.get("results", []), 1):
        text = item.get("text") or "[Nenhuma fala identificada.]"
        if options["timestamps"]:
            text = "\n".join(f'[{timestamp(s["start"])}] {s["text"]}' for s in item["segments"]) or text
        if options["organized"]:
            header = f'{index:02d}. {item["name"]}'
            if item.get("date"):
                header += f'\nData identificada no nome: {display_date(item["date"])}'
            text = header + "\n\n" + text
        sections.append(text)
    # Never silently omit failures when exporting a partial batch.
    if job.get("errors"):
        sections.append("ÁUDIOS NÃO TRANSCRITOS\n" + "\n".join(f'{e["name"]}: {e["error"]}' for e in job["errors"]))
    return clean("\n\n".join(sections))


def fonts():
    candidates = [os.getenv("ESCRIBA_FONT_PATH", ""), "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                  "/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf", "/Library/Fonts/Arial.ttf",
                  "C:/Windows/Fonts/arial.ttf"]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            if "Escriba" not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont("Escriba", candidate))
            return "Escriba"
    return "Helvetica"


def pdf_bytes(job):
    buffer = BytesIO()
    font = fonts()
    def safe(text):
        value = clean(text)
        if font == "Helvetica":
            value = value.encode("cp1252", "replace").decode("cp1252")
        return escape(value).replace("\n", "<br/>")
    title = job["options"]["title"]
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=48, leftMargin=48,
                            topMargin=65, bottomMargin=54, title=title, author="Escriba")
    body = ParagraphStyle("body", fontName=font, fontSize=10, leading=16,
                          textColor=colors.HexColor("#33323D"), spaceAfter=12, splitLongWords=True)
    heading = ParagraphStyle("heading", parent=body, fontSize=12, leading=18,
                             spaceBefore=16, spaceAfter=6, textColor=colors.HexColor("#7753B5"))
    meta = ParagraphStyle("meta", parent=body, fontSize=8, leading=12,
                          textColor=colors.HexColor("#74717F"))
    headline = ParagraphStyle("title", parent=body, fontSize=23, leading=30, spaceAfter=12)
    story = [Paragraph(safe(title), headline)]
    duration = sum(r["duration"] for r in job.get("results", []))
    generated = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC")
    story += [Paragraph(safe(f'{len(job.get("results", []))} áudio(s) • {timestamp(duration)} de áudio • Gerado em {generated}'), meta), Spacer(1, 12)]
    for index, item in enumerate(job.get("results", []), 1):
        if job["options"]["organized"]:
            block = [Paragraph(safe(f'{index:02d}. {item["name"]}'), heading)]
            if item.get("date"):
                block.append(Paragraph(safe("Data identificada no nome: " + display_date(item["date"])), meta))
            # Keep the heading with a small spacer, not with an unbounded transcript.
            block.append(Spacer(1, 4))
            story.append(KeepTogether(block))
        if job["options"]["timestamps"] and item["segments"]:
            for segment in item["segments"]:
                story.append(Paragraph(safe(f'[{timestamp(segment["start"])}] {segment["text"]}'), body))
        else:
            # Bound paragraph size for very long recordings; do not summarize content.
            text = item["text"] or "[Nenhuma fala identificada.]"
            words = text.split()
            for start in range(0, len(words), 220):
                story.append(Paragraph(safe(" ".join(words[start:start + 220])), body))
    if job.get("errors"):
        story.append(Paragraph("Áudios não transcritos", heading))
        for error in job["errors"]:
            story.append(Paragraph(safe(f'{error["name"]}: {error["error"]}'), body))
    def footer(canvas, document):
        canvas.saveState()
        canvas.setFont(font, 10)
        canvas.setFillColor(colors.HexColor("#7753B5"))
        canvas.drawString(48, A4[1] - 35, "ESCRIBA")
        canvas.setStrokeColor(colors.HexColor("#EBE8F0"))
        canvas.line(48, 40, A4[0] - 48, 40)
        canvas.setFont(font, 8)
        canvas.setFillColor(colors.HexColor("#74717F"))
        canvas.drawString(48, 27, "Transcrição automática • Revise nomes e informações importantes.")
        canvas.drawRightString(A4[0] - 48, 27, str(document.page))
        canvas.restoreState()
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()
