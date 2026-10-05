"""Whisper real, carregado sob demanda. Não há transcrição simulada em produção."""
from pathlib import Path
import importlib.util
import shutil
import subprocess
import wave


class WhisperEngine:
    def __init__(self, config):
        self.config = config
        self.model = None

    def available(self):
        return bool(importlib.util.find_spec("faster_whisper")) and bool(shutil.which("ffmpeg"))

    def load(self):
        if self.model is None:
            from faster_whisper import WhisperModel
            self.model = WhisperModel(self.config.model, device=self.config.device,
                                      compute_type=self.config.compute_type,
                                      download_root=str(self.config.data_dir / "models"))

    def transcribe(self, path, language, on_segment, cancelled):
        normalized = Path(path).with_name(Path(path).stem + ".normalized.wav")
        try:
            # Only local media demuxers; do not follow playlists or network URLs.
            command = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-protocol_whitelist", "file,pipe",
                       "-format_whitelist", "mp3,wav,mov,ogg,flac,aac,aiff,asf,matroska,webm",
                       "-i", str(path), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000",
                       "-t", str(self.config.max_seconds + 1), "-c:a", "pcm_s16le", str(normalized)]
            result = subprocess.run(command, capture_output=True, timeout=300, check=False)
            if result.returncode:
                raise ValueError("Áudio inválido, sem faixa de áudio ou com formato não reconhecido.")
            with wave.open(str(normalized)) as wav:
                duration = wav.getnframes() / wav.getframerate()
            if duration > self.config.max_seconds:
                raise ValueError("O áudio excede o limite de 2 horas. Divida-o em partes menores.")
            if duration <= 0:
                raise ValueError("O áudio está vazio.")
            if cancelled():
                return None
            segments, info = self.model.transcribe(str(normalized), language=None if language == "auto" else language,
                                                  beam_size=5, vad_filter=True, condition_on_previous_text=False)
            output = []
            for segment in segments:
                if cancelled():
                    return None
                text = segment.text.strip()
                if text:
                    output.append({"start": round(segment.start, 2), "end": round(segment.end, 2), "text": text})
                on_segment(min(segment.end / max(duration, 1), 0.99))
            return {"text": " ".join(s["text"] for s in output), "segments": output,
                    "duration": round(duration, 2), "language": info.language}
        except subprocess.TimeoutExpired as exc:
            raise ValueError("O áudio demorou demais para ser decodificado.") from exc
        finally:
            normalized.unlink(missing_ok=True)
