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
