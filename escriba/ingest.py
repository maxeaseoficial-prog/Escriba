"""Extração limitada: nunca extrai caminhos enviados pelo usuário."""
from datetime import datetime
from pathlib import Path, PurePosixPath
import re
import stat
import zipfile

AUDIO = {".mp3", ".wav", ".m4a", ".ogg", ".opus", ".flac", ".aac", ".aiff", ".aif", ".wma", ".webm", ".mp4"}


def natural_key(value):
    return tuple((0, int(p)) if p.isdigit() else (1, p.casefold()) for p in re.split(r"(\d+)", value))


def date_from_name(name):
    match = re.search(r"(?<!\d)(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)(?:[T _-]+(?:at[ _-]+)?([0-2]\d)[.:-]([0-5]\d)[.:-]([0-5]\d))?", name)
    if not match:
        return None
    y, m, d, h, minute, s = match.groups()
    try:
        dt = datetime(int(y), int(m), int(d), int(h or 0), int(minute or 0), int(s or 0))
        return dt.isoformat(timespec="seconds") if h is not None else dt.date().isoformat()
    except ValueError:
        return None


def prepare(source: Path, original_name: str, target: Path, config, order="date"):
    target.mkdir(parents=True, exist_ok=True)
    if Path(original_name).suffix.lower() != ".zip":
        return [{"path": str(source), "name": original_name, "date": date_from_name(original_name)}], []
    items, ignored = [], []
    try:
        with zipfile.ZipFile(source) as archive:
            entries = archive.infolist()
            if len(entries) > config.max_entries:
                raise ValueError("O ZIP contém entradas demais. Divida-o em arquivos menores.")
            total = sum(i.file_size for i in entries)
            if total > config.max_expanded:
                raise ValueError("O conteúdo descompactado excede 1 GB.")
            for info in entries:
                name = info.filename.replace("\\", "/")
                parts = PurePosixPath(name)
                if parts.is_absolute() or ".." in parts.parts or ":" in name or "\x00" in name:
                    raise ValueError("ZIP recusado: caminho de arquivo inseguro.")
                if stat.S_ISLNK(info.external_attr >> 16):
                    raise ValueError("ZIP recusado: links simbólicos não são permitidos.")
                if info.is_dir() or "__MACOSX" in parts.parts or parts.name.startswith("."):
                    continue
                if parts.suffix.lower() not in AUDIO:
                    ignored.append(name)
                    continue
                if info.flag_bits & 1:
                    raise ValueError("Remova a senha do ZIP antes de enviar.")
                if info.file_size > config.max_entry or info.file_size / max(1, info.compress_size) > 200:
                    raise ValueError("ZIP recusado: tamanho ou taxa de compressão fora do limite seguro.")
                if len(items) >= config.max_files:
                    raise ValueError(f"Envie no máximo {config.max_files} áudios por ZIP.")
                dest = target / f"{len(items):04d}{parts.suffix.lower()}"
                written = 0
                with archive.open(info) as src, dest.open("wb") as out:
                    while chunk := src.read(1024 * 1024):
                        written += len(chunk)
                        if written > min(config.max_entry, info.file_size):
                            raise ValueError("ZIP recusado: tamanho descompactado inconsistente.")
                        out.write(chunk)
                items.append({"path": str(dest), "name": name, "date": date_from_name(parts.name)})
    except (zipfile.BadZipFile, NotImplementedError, RuntimeError) as exc:
        raise ValueError("Não foi possível abrir o ZIP. Verifique se ele está íntegro e sem senha.") from exc
    if not items:
        raise ValueError("Nenhum áudio compatível foi encontrado no ZIP.")
    if order == "name":
        items.sort(key=lambda i: natural_key(i["name"]))
    elif order == "date":
        items.sort(key=lambda i: (i["date"] is None, i["date"] or "", natural_key(i["name"])))
    return items, ignored
