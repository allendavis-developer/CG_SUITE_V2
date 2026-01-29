from django.core.management.base import BaseCommand
import json
import time
import requests
from pathlib import Path


class Command(BaseCommand):
    help = "Fetch CeX box details from all JSON files in an input folder and save to a single output file"

    def add_arguments(self, parser):
        parser.add_argument(
            "--input-folder",
            required=True,
            help="Path to folder containing input JSON files"
        )
        parser.add_argument(
            "--output-folder",
            required=True,
            help="Folder where the output JSONL file will be saved"
        )
        parser.add_argument(
            "--output-file",
            required=True,
            help="Name of the output JSONL file (e.g., cex_data.jsonl)"
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=50,
            help="Number of stable_ids per batch (default: 50)"
        )

    def _fetch_and_log_batch(self, stable_ids, batch_number, headers, base_url, output_file_path):
        batch_results = []

        for stable_id in stable_ids:
            url = base_url.format(stable_id=stable_id)

            for attempt in range(3):
                try:
                    response = requests.get(url, headers=headers, timeout=15)
                    response.raise_for_status()
                    payload = response.json()
                    batch_results.append({
                        "stable_id": stable_id,
                        "response": payload
                    })
                    break

                except requests.RequestException as exc:
                    if attempt < 2:
                        wait = 2 ** attempt
                        self.stdout.write(
                            self.style.WARNING(
                                f"Retrying {stable_id} in {wait}s due to error: {exc}"
                            )
                        )
                        time.sleep(wait)
                    else:
                        batch_results.append({
                            "stable_id": stable_id,
                            "error": str(exc)
                        })
                        self.stdout.write(
                            self.style.ERROR(
                                f"Failed to fetch {stable_id} after 3 attempts: {exc}"
                            )
                        )

        with open(output_file_path, "a", encoding="utf-8") as f:
            for item in batch_results:
                f.write(json.dumps(item) + "\n")

        self.stdout.write(
            self.style.SUCCESS(
                f"Fetched batch {batch_number} ({len(stable_ids)} stable IDs) → saved to {output_file_path}"
            )
        )

    def _load_stable_ids_from_file(self, input_file):
        """Load stable IDs from a JSON file with a top-level 'listings' array."""
        with open(input_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        stable_ids = []
        for listing in data.get("listings", []):
            stable_id = listing.get("id")
            if stable_id:
                stable_ids.append(stable_id)

        return stable_ids


    def handle(self, *args, **options):
        input_folder = Path(options["input_folder"])
        output_folder = Path(options["output_folder"])
        output_file_name = options["output_file"]
        batch_size = options["batch_size"]

        if not input_folder.exists() or not input_folder.is_dir():
            self.stdout.write(self.style.ERROR(f"Input folder does not exist: {input_folder}"))
            return

        output_folder.mkdir(parents=True, exist_ok=True)
        output_file_path = output_folder / output_file_name

        # Clear or create output file
        output_file_path.write_text("", encoding="utf-8")

        # Gather all stable_ids from all JSON files
        stable_ids = []
        for file_path in sorted(input_folder.glob("*.json")):
            self.stdout.write(f"Loading stable_ids from: {file_path}")
            stable_ids.extend(self._load_stable_ids_from_file(file_path))

        if not stable_ids:
            self.stdout.write(self.style.WARNING("No stable_ids found in input folder."))
            return

        self.stdout.write(self.style.SUCCESS(f"Loaded {len(stable_ids)} stable_ids in total."))

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/118.0.5993.117 Safari/537.36"
            ),
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Referer": "https://www.cex.uk/",
        }

        base_url = "https://wss2.cex.uk.webuy.io/v3/boxes/{stable_id}/detail"

        batch = []
        batch_number = 1

        for stable_id in stable_ids:
            self.stdout.write(f"Fetching → {stable_id}")
            batch.append(stable_id)

            if len(batch) == batch_size:
                self._fetch_and_log_batch(batch, batch_number, headers, base_url, output_file_path)
                batch.clear()
                batch_number += 1

        if batch:
            self._fetch_and_log_batch(batch, batch_number, headers, base_url, output_file_path)
