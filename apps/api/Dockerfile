FROM python:3.13-alpine

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/

COPY apps/api/pyproject.toml apps/api/uv.lock ./
COPY apps/api/api/ api/
COPY apps/api/alembic.ini ./
COPY apps/api/migrations/ migrations/

RUN uv sync --no-dev --locked

ENV PATH="/app/.venv/bin:$PATH"

RUN addgroup -S app && adduser -S -G app app
RUN chown -R app:app /app

USER app

EXPOSE 8000

CMD ["uvicorn", "api.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--app-dir", ".", "--no-proxy-headers"]