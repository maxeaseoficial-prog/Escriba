"""Fixtures sintéticas SOMENTE nos testes. O aplicativo usa Whisper real."""
import io
import json
import shutil
import stat
import threading
import time
import wave
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from escriba.app import create_app
from escriba.config import Config
from escriba.engine import WhisperEngine
from escriba.export import pdf_bytes, plain_text
from escriba.ingest import date_from_name, natural_key, prepare
from escriba.models import Options

HEADERS = {"X-Escriba-Client": "1"}


def wav_bytes():
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(16000)
        file.writeframes(b"\x00\x00" * 16000)
    return buffer.getvalue()


def make_zip(entries):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in entries:
            archive.writestr(name, content)
    return buffer.getvalue()


class FakeEngine:
    """Controlled test double; never imported by production modules."""
    def available(self):
        return True

    def load(self):
        pass

    def transcribe(self, path, language, on_segment, cancelled):
        if Path(path).read_bytes().startswith(b"INVALID"):
            raise ValueError("Áudio inválido de teste")
        on_segment(0.5)
        return {"text": "Olá, esta é uma transcrição de teste. Ação e organização.",
                "segments": [{"start": 0, "end": 1, "text": "Olá, esta é uma transcrição de teste. Ação e organização."}],
                "duration": 1, "language": "pt"}


@pytest.fixture
def config(tmp_path):
    return Config(data_dir=tmp_path, hosts=("testserver", "localhost", "127.0.0.1"))


@pytest.fixture
def client(config):
    with TestClient(create_app(config, FakeEngine())) as instance:
        yield instance


def submit(client, filename="audio.wav", content=None, options=None, headers=None):
    return client.post("/api/jobs", params={"filename": filename, "options": json.dumps(options or {})},
                       content=content if content is not None else wav_bytes(), headers=headers or HEADERS)


def finish(client, job_id):
    for _ in range(150):
        response = client.get(f"/api/jobs/{job_id}")
        record = response.json()
        if record.get("status") in {"completed", "partial", "failed", "cancelled"}:
            return record
        time.sleep(0.02)
    raise AssertionError("Test job did not finish")


def test_static_and_health(client):
    assert client.get("/").status_code == 200
    assert "Escriba" in client.get("/").text
    assert client.get("/static/app.js").status_code == 200
    assert client.get("/static/secrets.txt").status_code == 404
    assert client.get("/api/health").json()["engine_installed"] is True
    assert "frame-ancestors 'none'" in client.get("/").headers["content-security-policy"]


def test_upload_transcribe_pdf_txt_delete(client, config):
    response = submit(client)
    assert response.status_code == 202
    job_id = response.json()["id"]
    record = finish(client, job_id)
    assert record["status"] == "completed"
    assert "transcrição" in record["text"]
    pdf = client.get(f"/api/jobs/{job_id}/download?format=pdf")
    assert pdf.content.startswith(b"%PDF-")
    assert "attachment" in pdf.headers["content-disposition"]
    txt = client.get(f"/api/jobs/{job_id}/download?format=txt")
    assert "organização" in txt.text
    assert client.get(f"/api/jobs/{job_id}/download?format=exe").status_code == 422
    # Download does not invoke the recognizer again.
    assert client.delete(f"/api/jobs/{job_id}", headers=HEADERS).status_code == 200
    assert client.get(f"/api/jobs/{job_id}").status_code == 404
    assert not (config.data_dir / "jobs" / job_id).exists()


def test_zip_merges_all_and_natural_order(client):
    archive = make_zip([("audio10.wav", wav_bytes()), ("audio2.wav", wav_bytes()), ("audio1.wav", wav_bytes()), ("_chat.txt", b"metadata")])
    response = submit(client, "lote.zip", archive)
    record = finish(client, response.json()["id"])
    assert [r["name"] for r in record["results"]] == ["audio1.wav", "audio2.wav", "audio10.wav"]
    assert len(record["results"]) == 3 and record["ignored"] == ["_chat.txt"]
    assert record["text"].count("transcrição de teste") == 3


def test_zip_dates_and_archive_order(client):
    archive = make_zip([("AUDIO-2026-10-05-14-12-31.opus", wav_bytes()), ("AUDIO-2026-10-04-08-30-00.opus", wav_bytes())])
    first = finish(client, submit(client, "data.zip", archive).json()["id"])
    assert first["results"][0]["date"] == "2026-10-04T08:30:00"
    second = finish(client, submit(client, "data.zip", archive, {"order": "archive"}).json()["id"])
    assert second["results"][0]["date"] == "2026-10-05T14:12:31"


def test_continuous_text_and_timestamps(client):
    record = finish(client, submit(client, options={"organized": False, "timestamps": False, "output": "txt"}).json()["id"])
    assert record["text"].startswith("Olá") and "audio.wav" not in record["text"]
    timed = finish(client, submit(client, options={"timestamps": True}).json()["id"])
    assert "[00:00:00]" in timed["text"]


def test_partial_failure_is_explicit(client):
    archive = make_zip([("ok.wav", wav_bytes()), ("broken.wav", b"INVALID")])
    record = finish(client, submit(client, "partial.zip", archive).json()["id"])
    assert record["status"] == "partial" and len(record["results"]) == 1
    assert "ÁUDIOS NÃO TRANSCRITOS" in record["text"] and "broken.wav" in record["text"]


def test_all_failures_no_download(client):
    record = finish(client, submit(client, content=b"INVALID").json()["id"])
    assert record["status"] == "failed"
    assert client.get(f'/api/jobs/{record["id"]}/download').status_code == 409


@pytest.mark.parametrize("name", ["../../escape.wav", "..\\escape.wav", "/tmp/escape.wav", "C:\\escape.wav"])
def test_zip_slip_rejected(client, name):
    record = finish(client, submit(client, "evil.zip", make_zip([(name, wav_bytes())])).json()["id"])
    assert record["status"] == "failed" and "inseguro" in record["message"]


def test_zip_symlink_rejected(client):
    buffer = io.BytesIO()
    info = zipfile.ZipInfo("link.wav")
    info.create_system = 3
    info.external_attr = (stat.S_IFLNK | 0o777) << 16
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(info, "/etc/passwd")
    record = finish(client, submit(client, "link.zip", buffer.getvalue()).json()["id"])
    assert record["status"] == "failed" and "simbólicos" in record["message"]


def test_compression_bomb_rejected(client):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("zero.wav", b"0" * 1000000)
    record = finish(client, submit(client, "bomb.zip", buffer.getvalue()).json()["id"])
    assert record["status"] == "failed" and "compressão" in record["message"]


@pytest.mark.parametrize("content", [b"not a zip", make_zip([("document.txt", b"hello")])])
def test_invalid_or_no_audio_zip(client, content):
    record = finish(client, submit(client, "bad.zip", content).json()["id"])
    assert record["status"] == "failed"


def test_invalid_input_and_settings(client, config):
    assert submit(client, "malware.exe").status_code == 415
    assert submit(client, content=b"").status_code == 400
    assert submit(client, options={"output": "exe"}).status_code == 422
    assert submit(client, options={"title": "x" * 121}).status_code == 422
    assert submit(client, headers={**HEADERS, "Content-Length": str(config.max_upload + 1)}).status_code == 413
    assert client.get("/api/jobs/not-a-job").status_code == 404


def test_security_origin_and_host(client):
    assert submit(client, headers={"X-Escriba-Client": "0"}).status_code == 403
    assert submit(client, headers={**HEADERS, "Origin": "https://evil.example"}).status_code == 403
    assert client.get("/", headers={"Host": "evil.example"}).status_code == 400
    assert submit(client, headers={**HEADERS, "Origin": "http://testserver"}).status_code == 202


def test_auth_required(config):
    config.token = "a" * 40
    with TestClient(create_app(config, FakeEngine())) as client:
        assert client.get("/").status_code == 200
        assert client.get("/api/health").json()["auth_required"] is True
        assert submit(client).status_code == 401
        assert submit(client, headers={**HEADERS, "Authorization": "Bearer " + config.token}).status_code == 202


def test_remote_requires_long_token(tmp_path):
    with pytest.raises(ValueError):
        Config(data_dir=tmp_path, hosts=("example.org",), token="short")


def test_missing_engine_not_simulated(config):
    engine = FakeEngine()
    engine.available = lambda: False
    with TestClient(create_app(config, engine)) as client:
        assert submit(client).status_code == 503
        assert not client.get("/api/health").json()["engine_installed"]


def test_loading_model_failure_is_actionable(config):
    engine = FakeEngine()
    def fail():
        raise RuntimeError("network unavailable")
    engine.load = fail
    with TestClient(create_app(config, engine)) as client:
        record = finish(client, submit(client).json()["id"])
        assert record["status"] == "failed" and "carregar o Whisper" in record["message"]


def test_cancel_and_queue_bound(config):
    config.max_active = 1
    engine = FakeEngine()
    barrier = threading.Event()
    def hold(path, language, progress, cancelled):
        barrier.set()
        while not cancelled():
            time.sleep(.01)
        return None
    engine.transcribe = hold
    with TestClient(create_app(config, engine)) as client:
        job_id = submit(client).json()["id"]
        assert barrier.wait(3)
        assert submit(client).status_code == 429
        assert client.delete(f"/api/jobs/{job_id}", headers=HEADERS).status_code == 409
        assert client.post(f"/api/jobs/{job_id}/cancel", headers=HEADERS).status_code == 200
        assert finish(client, job_id)["status"] == "cancelled"


def test_persistence_and_audio_removal(config):
    with TestClient(create_app(config, FakeEngine())) as client:
        record = finish(client, submit(client).json()["id"])
        job_id = record["id"]
    assert not list((config.data_dir / "jobs" / job_id).glob("upload.*"))
    with TestClient(create_app(config, FakeEngine())) as client:
        assert client.get(f"/api/jobs/{job_id}").json()["status"] == "completed"


def test_retention_cleanup(config):
    with TestClient(create_app(config, FakeEngine())) as client:
        record = finish(client, submit(client).json()["id"])
    config.retention_seconds = -1
    with TestClient(create_app(config, FakeEngine())) as client:
        assert client.get(f'/api/jobs/{record["id"]}').status_code == 404


def test_dates_not_invented():
    assert date_from_name("audio1.opus") is None
    assert date_from_name("PTT-20261005-WA0001.opus") == "2026-10-05"
    assert date_from_name("2026-10-05 at 13.42.10.wav") == "2026-10-05T13:42:10"
    assert date_from_name("2026-02-31.wav") is None
    assert sorted(["10.wav", "2.wav", "1.wav"], key=natural_key) == ["1.wav", "2.wav", "10.wav"]


def test_pdf_long_text_markup_and_accents():
    record = {"options": Options(title="Reunião <2026> & decisões").model_dump(), "results": [
        {"name": "Áudio & <dados>.wav", "date": None, "duration": 10, "text": "Olá, ação e organização. " * 1400, "segments": []}], "errors": []}
    data = pdf_bytes(record)
    assert data.startswith(b"%PDF-") and len(data) > 10000
    # Optional PDF inspector is not a runtime dependency.
    try:
        import fitz
        doc = fitz.open(stream=data, filetype="pdf")
        text = " ".join(p.get_text() for p in doc)
        assert len(doc) > 2 and "Reunião" in text and "organização" in text
    except ImportError:
        pass


def test_ffmpeg_real_decode_with_test_model(config, tmp_path):
    if not shutil.which("ffmpeg"):
        pytest.skip("FFmpeg is not installed")
    source = tmp_path / "sample.wav"
    source.write_bytes(wav_bytes())
    engine = WhisperEngine(config)
    engine.model = SimpleNamespace(transcribe=lambda *a, **k: (iter([SimpleNamespace(start=0, end=1, text="Teste do pipeline")]), SimpleNamespace(language="pt")))
    result = engine.transcribe(str(source), "pt", lambda p: None, lambda: False)
    assert result["text"] == "Teste do pipeline" and result["duration"] == 1
    assert not (tmp_path / "sample.normalized.wav").exists()
