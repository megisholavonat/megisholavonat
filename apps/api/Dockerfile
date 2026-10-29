# Two images from one file, both with the repo root as context:
#   API (the last stage, the default):  docker build -f apps/api/Dockerfile .
#   delay forecast trainer:             ... --target trainer
# Only the trainer has LightGBM (the `train` dependency group); the API serves
# its exported trees with numpy.

# --- delay forecast trainer ---

FROM python:3.13-alpine AS trainer-build

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/

# LightGBM publishes no musllinux wheels, so it is compiled from the sdist
RUN apk add --no-cache build-base cmake

COPY apps/api/pyproject.toml apps/api/uv.lock ./

RUN uv sync --no-dev --group train --locked

FROM python:3.13-alpine AS trainer

WORKDIR /app

# OpenMP and the C++ runtime for LightGBM
RUN apk add --no-cache libgomp libstdc++

COPY --from=trainer-build /app/.venv .venv
COPY apps/api/api/ api/

ENV PATH="/app/.venv/bin:$PATH"

RUN addgroup -S app && adduser -S -G app app

USER app

CMD ["python", "-m", "api.forecast", "train"]

# --- API ---

FROM python:3.13-alpine

RUN addgroup -S app && adduser -S -G app app

WORKDIR /app

# Everything under /app belongs to app. Files are copied with that owner and
# the venv is created by app, instead of a `chown -R` layer that would store
# all of /app a second time.
RUN chown app:app /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/

USER app

COPY --chown=app:app apps/api/pyproject.toml apps/api/uv.lock ./
COPY --chown=app:app apps/api/api/ api/
COPY --chown=app:app apps/api/alembic.ini ./
COPY --chown=app:app apps/api/migrations/ migrations/

RUN uv sync --no-dev --locked

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000

CMD ["uvicorn", "api.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--app-dir", ".", "--no-proxy-headers"]
