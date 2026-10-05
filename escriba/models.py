from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class Options(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(default="Minha transcrição", min_length=1, max_length=120)
    output: Literal["pdf", "txt"] = "pdf"
    language: Literal["pt", "auto", "en", "es"] = "pt"
    organized: bool = True
    timestamps: bool = False
    order: Literal["name", "date", "archive"] = "date"
