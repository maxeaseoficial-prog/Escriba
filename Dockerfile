FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 ESCRIBA_DATA_DIR=/app/data
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 escriba
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=escriba:escriba escriba ./escriba
RUN mkdir -p /app/data && chown escriba:escriba /app/data
USER escriba
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"
CMD ["python", "-m", "uvicorn", "escriba.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
