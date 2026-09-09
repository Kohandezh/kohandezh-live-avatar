FROM python:3.12-slim-bookworm

# Paths inside the image mirror the repository, so pytest's rootdir, `testpaths` in
# pyproject.toml and tracebacks read the same on the host and in the container.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app/apps/api

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY apps/api/services/orchestrator/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
# pytest/ruff configuration lives at the repository root; ship it so in-container test runs
# use the same rootdir and registered markers as host runs.
COPY pyproject.toml /app/pyproject.toml
COPY apps/api/services /app/apps/api/services

RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --create-home app \
    && chown -R app:app /app
USER app

EXPOSE 8000
CMD ["uvicorn", "services.orchestrator.src.main:app", "--host", "0.0.0.0", "--port", "8000"]
