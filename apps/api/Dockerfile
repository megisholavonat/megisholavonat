FROM python:3.13-alpine

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/

COPY pyproject.toml uv.lock .
COPY api/ api/

RUN uv sync --no-dev --locked

ENV PATH="/app/.venv/bin:$PATH"

RUN addgroup -S app && adduser -S -G app app
RUN chown -R app:app /app

USER app

EXPOSE 8000

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]