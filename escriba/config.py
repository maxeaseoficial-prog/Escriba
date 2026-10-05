from dataclasses import dataclass, field
from pathlib import Path
import os


@dataclass
class Config:
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("ESCRIBA_DATA_DIR", "./data")).resolve())
    model: str = field(default_factory=lambda: os.getenv("ESCRIBA_MODEL", "small"))
    device: str = field(default_factory=lambda: os.getenv("ESCRIBA_DEVICE", "cpu"))
    compute_type: str = field(default_factory=lambda: os.getenv("ESCRIBA_COMPUTE_TYPE", "int8"))
    token: str = field(default_factory=lambda: os.getenv("ESCRIBA_ACCESS_TOKEN", ""))
    hosts: tuple[str, ...] = field(default_factory=lambda: tuple(os.getenv("ESCRIBA_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]").split(",")))
    max_upload: int = 500 * 1024 * 1024
    max_expanded: int = 1024 * 1024 * 1024
    max_entry: int = 300 * 1024 * 1024
    max_files: int = 100
    max_entries: int = 2000
    max_seconds: int = 7200
    max_active: int = 4
    retention_seconds: int = 24 * 60 * 60

    def __post_init__(self):
        local = {"localhost", "127.0.0.1", "[::1]", "testserver"}
        if not set(self.hosts) <= local and len(self.token) < 32:
            raise ValueError("Acesso remoto exige ESCRIBA_ACCESS_TOKEN com pelo menos 32 caracteres.")
