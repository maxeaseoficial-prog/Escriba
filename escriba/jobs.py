from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import copy
import json
import logging
import shutil
import threading
import time
import uuid

from .export import plain_text
from .ingest import prepare

log = logging.getLogger(__name__)
TERMINAL = {"completed", "partial", "failed", "cancelled"}


class Jobs:
    def __init__(self, config, engine):
        self.config, self.engine = config, engine
        self.root = config.data_dir / "jobs"
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.slots = threading.BoundedSemaphore(config.max_active)
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="escriba")
        self.records, self.cancellations = {}, {}
        for path in self.root.glob("*/job.json"):
            try:
                record = json.loads(path.read_text("utf-8"))
                if record["status"] not in TERMINAL:
                    record.update(status="failed", message="Processamento interrompido pelo reinício. Envie o arquivo novamente.")
                self.records[record["id"]] = record
                self.save(record)
                self.clean_media(record["id"])
            except (ValueError, KeyError, OSError):
                log.warning("Registro de trabalho inválido: %s", path.name)
        self.cleanup()
        self.stop = threading.Event()
        self.sweeper = threading.Thread(target=self.sweep, daemon=True, name="escriba-cleanup")
        self.sweeper.start()

    def save(self, record):
        directory = self.root / record["id"]
        directory.mkdir(parents=True, exist_ok=True)
        temporary = directory / "job.tmp"
        temporary.write_text(json.dumps(record, ensure_ascii=False), "utf-8")
        temporary.replace(directory / "job.json")

    def patch(self, job_id, **values):
        with self.lock:
            record = self.records[job_id]
            record.update(values)
            record["updated_at"] = time.time()
            self.save(record)

    def allocate(self, filename, options):
        if not self.slots.acquire(blocking=False):
            return None
        job_id = uuid.uuid4().hex
        record = {"id": job_id, "name": filename, "options": options.model_dump(),
                  "status": "receiving", "message": "Recebendo arquivo", "progress": 0,
                  "created_at": time.time(), "updated_at": time.time(),
                  "results": [], "errors": [], "ignored": [], "total": 0}
        try:
            with self.lock:
                self.records[job_id] = record
                self.cancellations[job_id] = threading.Event()
                self.save(record)
            return job_id
        except Exception:
            with self.lock:
                self.records.pop(job_id, None)
                self.cancellations.pop(job_id, None)
            shutil.rmtree(self.root / job_id, ignore_errors=True)
            self.slots.release()
            raise

    def discard_upload(self, job_id):
        with self.lock:
            self.records.pop(job_id, None)
            self.cancellations.pop(job_id, None)
            shutil.rmtree(self.root / job_id, ignore_errors=True)
        self.slots.release()

    def submit(self, job_id, source):
        self.patch(job_id, status="queued", message="Na fila de transcrição")
        self.pool.submit(self.run, job_id, source)

    def snapshot(self, job_id):
        with self.lock:
            record = copy.deepcopy(self.records.get(job_id))
        if record and record["status"] in {"completed", "partial"}:
            record["text"] = plain_text(record)
        return record

    def cancel(self, job_id):
        with self.lock:
            record = self.records.get(job_id)
            if not record:
                return False
            if record["status"] not in TERMINAL:
                self.cancellations[job_id].set()
                self.patch(job_id, message="Interrupção solicitada; aguardando o trecho atual terminar.")
        return True

    def clean_media(self, job_id):
        folder = self.root / job_id
        shutil.rmtree(folder / "media", ignore_errors=True)
        for source in folder.glob("upload.*"):
            source.unlink(missing_ok=True)

    def run(self, job_id, source):
        record = self.snapshot(job_id)
        cancel = self.cancellations[job_id].is_set
        try:
            if cancel():
                return
            self.patch(job_id, status="preparing", message="Conferindo os áudios")
            items, ignored = prepare(source, record["name"], source.parent / "media", self.config, record["options"]["order"])
            self.patch(job_id, total=len(items), ignored=ignored, message="Carregando Whisper. O primeiro uso baixa o modelo e pode demorar.")
            if cancel():
                return
            try:
                self.engine.load()
            except Exception as exc:
                log.exception("Falha ao carregar o modelo")
                raise ValueError("Não foi possível carregar o Whisper. Confira a instalação, a conexão para o primeiro download e o espaço disponível.") from exc
            results, errors = [], []
            last_update = [0.0]
            for index, item in enumerate(items):
                if cancel():
                    return
                self.patch(job_id, status="transcribing", current=item["name"], progress=round(index / len(items) * 100),
                           message=f"Transcrevendo áudio {index + 1} de {len(items)}")
                def progress(fraction):
                    if time.monotonic() - last_update[0] > 0.6:
                        self.patch(job_id, progress=round((index + fraction) / len(items) * 100))
                        last_update[0] = time.monotonic()
                try:
                    output = self.engine.transcribe(item["path"], record["options"]["language"], progress, cancel)
                    if cancel() or output is None:
                        return
                    results.append({"name": item["name"], "date": item["date"], **output})
                except Exception as exc:
                    log.warning("Falha em um áudio: %s", type(exc).__name__)
                    message = str(exc) if isinstance(exc, ValueError) else "Falha ao transcrever este áudio. Confira o arquivo e a memória disponível."
                    errors.append({"name": item["name"], "error": message})
                self.patch(job_id, results=results, errors=errors)
            status = "partial" if results and errors else "completed" if results else "failed"
            message = "Transcrição concluída" if status == "completed" else "Concluído com avisos" if results else "Nenhum áudio pôde ser transcrito."
            self.patch(job_id, status=status, message=message, progress=100)
        except Exception as exc:
            log.exception("Falha no trabalho de transcrição")
            self.patch(job_id, status="failed", message=str(exc) if isinstance(exc, ValueError) else "Não foi possível processar o arquivo. Verifique o ZIP e tente novamente.")
        finally:
            with self.lock:
                current = self.records.get(job_id)
                if cancel() and current and current["status"] not in TERMINAL:
                    self.patch(job_id, status="cancelled", message="Transcrição cancelada", results=[], errors=[])
            self.clean_media(job_id)
            with self.lock:
                self.cancellations.pop(job_id, None)
            self.slots.release()

    def delete(self, job_id):
        with self.lock:
            record = self.records.get(job_id)
            if not record:
                return False
            if record["status"] not in TERMINAL:
                raise ValueError("Cancele o processamento antes de excluir.")
            # Worker may be in its final cleanup block; it no longer needs job.json.
            shutil.rmtree(self.root / job_id, ignore_errors=True)
            del self.records[job_id]
            return True

    def cleanup(self):
        with self.lock:
            for job_id, record in list(self.records.items()):
                if record["status"] in TERMINAL and time.time() - record["updated_at"] > self.config.retention_seconds:
                    self.delete(job_id)
            for folder in self.root.iterdir():
                if folder.is_dir() and folder.name not in self.records:
                    shutil.rmtree(folder, ignore_errors=True)

    def sweep(self):
        while not self.stop.wait(60):
            try:
                self.cleanup()
            except Exception:
                log.exception("Falha na limpeza automática")

    def close(self):
        self.stop.set()
        with self.lock:
            for event in self.cancellations.values():
                event.set()
        self.pool.shutdown(wait=True)
        self.sweeper.join(timeout=2)
