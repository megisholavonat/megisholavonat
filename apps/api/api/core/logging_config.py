"""Logging configuration for the application"""

import logging
import sys

from api.core.config import settings

# Define our application's logger namespace
APP_LOGGER_NAME = "app"


def setup_logging():
    """Configure logging for the application"""
    log_level = logging.DEBUG if settings.DEBUG else logging.INFO

    # Create formatter
    formatter = logging.Formatter(
        fmt="[%(asctime)s] %(levelname)s [%(name)s] %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S%z",
    )

    # Get our application logger (not root logger)
    app_logger = logging.getLogger(APP_LOGGER_NAME)
    app_logger.setLevel(log_level)
    app_logger.propagate = False  # Don't propagate to root logger

    # Remove existing handlers
    app_logger.handlers.clear()

    # Create console handler for our app
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(log_level)
    console_handler.setFormatter(formatter)

    # Add handler only to our app logger
    app_logger.addHandler(console_handler)

    return app_logger


def get_logger(name: str) -> logging.Logger:
    """Get a logger instance for a specific module under the app namespace"""
    # Use child loggers under the app namespace
    return logging.getLogger(f"{APP_LOGGER_NAME}.{name}")
