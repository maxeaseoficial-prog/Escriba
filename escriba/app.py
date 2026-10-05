from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit
import re
import secrets

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import ValidationError
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import Config
from .engine import WhisperEngine
from .export import pdf_bytes, plain_text
from .ingest import AUDIO
from .jobs import Jobs, TERMINAL
from .models import Options

STATIC = Path(__file__).parent / "static"


def create_app(config=None, engine=None):
    config = config or Config()
    engine = engine or WhisperEngine(config)

    @asynccontextmanager
    async def lifespan(app):
        app.state.jobs = Jobs(config, engine)
        yield
        app.state.jobs.close()

    app = FastAPI(title="Escriba", version="1.0.0", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(config.hosts))

    @app.middleware("http")
    async def protect(request, call_next):
        if request.url.path.startswith("/api/") and request.url.path != "/api/health":
            if config.token:
                expected = "Bearer " + config.token
                if not secrets.compare_digest(request.headers.get("authorization", "").encode(), expected.encode()):
                    return JSONResponse({"detail": "Informe a chave de acesso nas configurações."}, status_code=401)
            if request.method not in {"GET", "HEAD", "OPTIONS"}:
                origin = request.headers.get("origin")
                if request.headers.get("x-escriba-client") != "1" or (origin and urlsplit(origin).netloc != request.url.netloc):
                    return JSONResponse({"detail": "Origem da solicitação não autorizada."}, status_code=403)
        response = await call_next(request)
        response.headers.update({"X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
                                 "X-Frame-Options": "DENY", "Cache-Control": "no-store",
                                 "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"})
        return response

    @app.get("/api/health")
    def health():
        return {"ok": True, "engine_installed": engine.available(), "model": config.model,
                "auth_required": bool(config.token), "max_upload_mb": config.max_upload // 1024 // 1024,
                "max_files": config.max_files, "retention_hours": config.retention_seconds // 3600}

    @app.post("/api/jobs", status_code=202)
    async def upload(request: Request, filename: str = Query(min_length=1, max_length=250), options: str = "{}"):
        if not engine.available():
            raise HTTPException(503, "Whisper ou FFmpeg não instalado. Siga a instalação no README do Escriba.")
        if len(options) > 2000:
            raise HTTPException(422, "Configurações excedem o tamanho permitido.")
        try:
            settings = Options.model_validate_json(options)
        except ValidationError:
            raise HTTPException(422, "Configurações inválidas.")
        name = filename.replace("\\", "/").split("/")[-1]
        suffix = Path(name).suffix.lower()
        if suffix not in AUDIO | {".zip"}:
            raise HTTPException(415, "Envie um áudio compatível ou um ZIP com áudios.")
        try:
            length = int(request.headers.get("content-length", "0"))
            if length < 0:
                raise ValueError()
        except ValueError:
            raise HTTPException(400, "Tamanho de arquivo inválido.")
        if length > config.max_upload:
            raise HTTPException(413, "O arquivo excede o limite de 500 MB.")
        manager = request.app.state.jobs
        job_id = manager.allocate(name, settings)
        if not job_id:
            raise HTTPException(429, "A fila está cheia. Conclua ou cancele uma transcrição antes de enviar outra.")
        source = manager.root / job_id / ("upload" + suffix)
        size = 0
        try:
            with source.open("wb") as out:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > config.max_upload:
                        raise HTTPException(413, "O arquivo excede o limite de 500 MB.")
                    out.write(chunk)
            if not size:
                raise HTTPException(400, "O arquivo está vazio.")
            manager.submit(job_id, source)
        except BaseException:
            manager.discard_upload(job_id)
            raise
        return {"id": job_id}

    def get_job(request, job_id):
        if not re.fullmatch(r"[0-9a-f]{32}", job_id):
            raise HTTPException(404, "Transcrição não encontrada.")
        record = request.app.state.jobs.snapshot(job_id)
        if not record:
            raise HTTPException(404, "Transcrição não encontrada ou expirada. Os resultados ficam disponíveis por 24 horas.")
        return record

    @app.get("/api/jobs/{job_id}")
    def status(request: Request, job_id: str):
        return get_job(request, job_id)

    @app.post("/api/jobs/{job_id}/cancel")
    def cancel(request: Request, job_id: str):
        get_job(request, job_id)
        request.app.state.jobs.cancel(job_id)
        return {"ok": True}

    @app.delete("/api/jobs/{job_id}")
    def delete(request: Request, job_id: str):
        get_job(request, job_id)
        try:
            request.app.state.jobs.delete(job_id)
        except ValueError as exc:
            raise HTTPException(409, str(exc))
        return {"ok": True}

    @app.get("/api/jobs/{job_id}/download")
    def download(request: Request, job_id: str, format: Literal["pdf", "txt"] = "pdf"):
        record = get_job(request, job_id)
        if record["status"] not in {"completed", "partial"}:
            raise HTTPException(409, "A transcrição ainda não está disponível para download.")
        content = pdf_bytes(record) if format == "pdf" else plain_text(record).encode("utf-8")
        return Response(content, media_type="application/pdf" if format == "pdf" else "text/plain; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="escriba-{job_id[:8]}.{format}"'})

    @app.get("/")
    def index():
        return FileResponse(STATIC / "index.html")

    @app.get("/static/{filename}")
    def static_file(filename: str):
        if filename not in {"app.js", "styles.css", "favicon.svg"}:
            raise HTTPException(404)
        return FileResponse(STATIC / filename)

    return app


app = create_app()
