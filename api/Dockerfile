FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    APP_HOME=/workspace

WORKDIR $APP_HOME

# System deps (add curl for diagnostics)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates tzdata git \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy app source
COPY app ./app
COPY shared ./shared

# Make sure shared is importable
ENV PYTHONPATH="${APP_HOME}:${APP_HOME}/app:${APP_HOME}/shared"

# Non-root user
RUN useradd -m appuser
USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -f http://127.0.0.1:8080/healthz || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
