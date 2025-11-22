from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DEBUG: bool = False
    REDIS_HOST: str = "localhost"
    SOCKS5_PROXY_HOST: str | None = None
    SOCKS5_PROXY_PORT: int | None = None
    SOCKS5_PROXY_USERNAME: str | None = None
    SOCKS5_PROXY_PASSWORD: str | None = None
    SOCKS5_PROXY_ENABLE: bool = False
    GRAPHQL_ENDPOINT: str = ""

    # Caching Constants
    CACHE_DURATION: int = 15 * 60  # 15 minutes
    MAX_STALE_DATA_AGE: int = 15 * 60 * 1000  # 15 minutes in ms
    REVALIDATE_DURATION: int = 60  # 60 seconds
    REVALIDATE_LOCK_DURATION: int = 30  # 30 seconds

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )


settings = Settings()
