import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.main import create_app


def generate_openapi_spec():
    openapi_schema = create_app().openapi()
    output_dir = Path(".")
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "openapi.json"

    with open(output_path, "w") as f:
        json.dump(openapi_schema, f, indent=2)
    print(f"OpenAPI spec generated at: {output_path.resolve()}")


if __name__ == "__main__":
    generate_openapi_spec()
