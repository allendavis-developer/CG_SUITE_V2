from django.core.management.base import BaseCommand
from django.db.models import Q

from pricing.models import CompetitorListing
from pricing.models import Subcategory
from pricing.models_v2 import ProductCategory


class Command(BaseCommand):
    def _fetch_and_log_batch(self, stable_ids, batch_number, headers, base_url, output_file_path):
        import requests
        import json
        import time

        batch_results = []

        for stable_id in stable_ids:
            url = base_url.format(stable_id=stable_id)

            # Retry loop
            for attempt in range(3):
                try:
                    response = requests.get(url, headers=headers, timeout=15)
                    response.raise_for_status()
                    payload = response.json()
                    
                    # Store the entire response for this stable_id
                    batch_results.append({
                        "stable_id": stable_id,
                        "response": payload
                    })

                    break  # success, exit retry loop

                except requests.RequestException as exc:
                    if attempt < 2:
                        wait = 2 ** attempt  # 1s, 2s, 4s
                        self.stdout.write(
                            self.style.WARNING(
                                f"Retrying {stable_id} in {wait}s due to error: {exc}"
                            )
                        )
                        time.sleep(wait)
                    else:
                        # After last attempt, log the failure
                        batch_results.append({
                            "stable_id": stable_id,
                            "error": str(exc),
                        })
                        self.stdout.write(
                            self.style.ERROR(
                                f"Failed to fetch {stable_id} after 3 attempts: {exc}"
                            )
                        )

        # Append batch to file
        with open(output_file_path, "a", encoding="utf-8") as f:
            for item in batch_results:
                f.write(json.dumps(item) + "\n")

        self.stdout.write(
            self.style.SUCCESS(
                f"\nFetched CeX API batch {batch_number} ({len(stable_ids)} stable IDs) → saved to {output_file_path}"
            )
        )

    def fetch_and_log_cex_box_details(self, listings, batch_size=50):
        import requests
        import json

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/118.0.5993.117 Safari/537.36"
            ),
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Referer": "https://www.cex.uk/",
        }

        BASE_URL = "https://wss2.cex.uk.webuy.io/v3/boxes/{stable_id}/detail"

        stable_id_batch = []
        batch_number = 1
        output_file = "cex_data.jsonl"

        for listing in listings:
            category = listing.market_item.item_model.subcategory.category.name
            subcategory = listing.market_item.item_model.subcategory.name

            self.stdout.write(
                f"{category} → {subcategory} → {listing.stable_id}"
            )

            stable_id_batch.append(listing.stable_id)

            if len(stable_id_batch) == batch_size:
                self._fetch_and_log_batch(
                    stable_id_batch,
                    batch_number,
                    headers,
                    BASE_URL,
                    output_file
                )
                stable_id_batch.clear()
                batch_number += 1

        # Flush remaining stable_ids (< batch_size)
        if stable_id_batch:
            self._fetch_and_log_batch(
                stable_id_batch,
                batch_number,
                headers,
                BASE_URL,
                output_file
            )

    help = "List CeX stable_ids for Smartphones and Mobile categories"

    def handle(self, *args, **options):
        listings = (
            CompetitorListing.objects
            .filter(competitor__iexact="cex")
            .filter(
                Q(market_item__item_model__subcategory__category__name__iexact="smartphones and mobile")
            )
            .select_related(
                "market_item__item_model__subcategory__category"
            )
            .order_by(
                "market_item__item_model__subcategory__category__name",
                "market_item__item_model__subcategory__name",
            )
        )

        if not listings.exists():
            self.stdout.write(
                self.style.WARNING("No CeX listings found for Smartphones or Mobile categories.")
            )
            return
        
        self.fetch_and_log_cex_box_details(listings)

        # ---------------------------------------------------------
        # Temporary mapping: old Subcategory -> new ProductCategory
        # Android Phones, iPhones (case-insensitive)
        # ---------------------------------------------------------

        subcategory_to_category_map = {
            "android phones": "android phones",
            "iphone": "iphones",
        }

        old_subcategories = Subcategory.objects.filter(
            Q(name__iexact="android phones") |
            Q(name__iexact="iphone")
        )

        new_categories = ProductCategory.objects.filter(
            Q(name__iexact="android phones") |
            Q(name__iexact="iphones")
        )

        old_by_name = {
            sc.name.lower(): sc
            for sc in old_subcategories
        }

        new_by_name = {
            pc.name.lower(): pc
            for pc in new_categories
        }

        self.stdout.write("\nSubcategory → ProductCategory mapping:")

        for old_name, new_name in subcategory_to_category_map.items():
            old_sc = old_by_name.get(old_name)
            new_pc = new_by_name.get(new_name)

            if not old_sc:
                self.stdout.write(
                    self.style.WARNING(
                        f"✗ Old Subcategory '{old_name}' not found"
                    )
                )
                continue

            if not new_pc:
                self.stdout.write(
                    self.style.WARNING(
                        f"✗ No ProductCategory found for Subcategory '{old_sc.name}'"
                    )
                )
                continue

            self.stdout.write(
                self.style.SUCCESS(
                    f"✓ {old_sc.name} (old id={old_sc.id}) "
                    f"→ {new_pc.name} (new id={new_pc.category_id})"
                )
            )