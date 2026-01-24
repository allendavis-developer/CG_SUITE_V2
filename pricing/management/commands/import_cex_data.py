"""
Django management command to import CeX JSONL data with bulk operations.

Usage:
    python manage.py import_cex_data path/to/cex_data.jsonl

Features:
- Streams JSONL file line-by-line (memory efficient)
- Bulk creates/updates with minimal queries
- Pre-loads lookups to avoid N+1 queries
- Transaction-safe with batch commits
"""

import json
from decimal import Decimal
from collections import defaultdict
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from pricing.models_v2 import (
    ProductCategory, Product, Attribute, AttributeValue,
    ConditionGrade, Variant, VariantAttributeValue, VariantPriceHistory
)


class Command(BaseCommand):
    help = 'Import CeX JSONL data into the database with bulk operations'

    def add_arguments(self, parser):
        parser.add_argument(
            'jsonl_file',
            type=str,
            help='Path to the JSONL file to import'
        )
        parser.add_argument(
            '--batch-size',
            type=int,
            default=500,
            help='Number of records to process per batch (default: 500)'
        )
        parser.add_argument(
            '--skip-errors',
            action='store_true',
            help='Skip error records without stopping'
        )

    def handle(self, *args, **options):
        jsonl_file = options['jsonl_file']
        batch_size = options['batch_size']
        skip_errors = options['skip_errors']

        self.stdout.write(self.style.SUCCESS(f'Starting import from {jsonl_file}'))

        # Ensure root category and default condition grades exist
        self._ensure_defaults()

        stats = {
            'total': 0,
            'processed': 0,
            'errors': 0,
            'skipped': 0,
            'products_created': 0,
            'variants_created': 0,
            'variants_updated': 0,
            'price_changes': 0,
        }

        batch = []
        
        try:
            with open(jsonl_file, 'r', encoding='utf-8') as f:
                for line_num, line in enumerate(f, 1):
                    stats['total'] += 1
                    
                    try:
                        data = json.loads(line.strip())
                        
                        # Skip error records
                        if 'error' in data:
                            stats['errors'] += 1
                            if skip_errors:
                                continue
                            else:
                                raise CommandError(f"Line {line_num}: Error record found")
                        
                        batch.append(data)
                        
                        # Process in batches
                        if len(batch) >= batch_size:
                            self._process_batch(batch, stats)
                            batch = []
                            self.stdout.write(f"Processed {stats['processed']} records...")
                    
                    except json.JSONDecodeError as e:
                        self.stdout.write(
                            self.style.ERROR(f"Line {line_num}: Invalid JSON - {e}")
                        )
                        stats['skipped'] += 1
                    except Exception as e:
                        self.stdout.write(
                            self.style.ERROR(f"Line {line_num}: {e}")
                        )
                        stats['skipped'] += 1
                        if not skip_errors:
                            raise
                
                # Process remaining batch
                if batch:
                    self._process_batch(batch, stats)
        
        except FileNotFoundError:
            raise CommandError(f'File not found: {jsonl_file}')
        
        # Print summary
        self.stdout.write(self.style.SUCCESS('\n' + '='*60))
        self.stdout.write(self.style.SUCCESS('Import Summary'))
        self.stdout.write(self.style.SUCCESS('='*60))
        self.stdout.write(f"Total lines: {stats['total']}")
        self.stdout.write(f"Successfully processed: {stats['processed']}")
        self.stdout.write(f"Error records: {stats['errors']}")
        self.stdout.write(f"Skipped: {stats['skipped']}")
        self.stdout.write(f"Products created: {stats['products_created']}")
        self.stdout.write(f"Variants created: {stats['variants_created']}")
        self.stdout.write(f"Variants updated: {stats['variants_updated']}")
        self.stdout.write(f"Price changes recorded: {stats['price_changes']}")
        self.stdout.write(self.style.SUCCESS('='*60))

    def _ensure_defaults(self):
        """Ensure root category and default condition grades exist."""
        root, created = ProductCategory.objects.get_or_create(
            name='Root',
            defaults={'parent_category_id': None}
        )
        if created:
            root.parent_category = root
            root.save()
            self.stdout.write(self.style.SUCCESS('Created root category'))
        
        # Bulk create default condition grades
        default_grades = ['A', 'B', 'C', 'BOXED', 'UNBOXED', 'DISCOUNTED', 'UNKNOWN']
        existing = set(ConditionGrade.objects.values_list('code', flat=True))
        to_create = [
            ConditionGrade(code=code) 
            for code in default_grades 
            if code not in existing
        ]
        if to_create:
            ConditionGrade.objects.bulk_create(to_create)

    @transaction.atomic
    def _process_batch(self, batch, stats):
        """Process a batch of records with bulk operations."""
        
        # PHASE 1: Pre-load all lookups
        lookups = self._preload_lookups(batch)
        
        # PHASE 2: Prepare data structures
        parsed_data = []
        for record in batch:
            parsed = self._parse_record(record, lookups)
            if parsed:
                parsed_data.append(parsed)
        
        # PHASE 3: Bulk create missing entities
        self._bulk_create_missing_entities(parsed_data, lookups, stats)
        
        # PHASE 4: Bulk upsert variants
        self._bulk_upsert_variants(parsed_data, lookups, stats)
        
        stats['processed'] += len(batch)

    def _preload_lookups(self, batch):
        """Pre-load all necessary lookups for the batch."""
        
        # Extract all unique values from batch
        category_names = set()
        product_names_by_category = defaultdict(set)
        condition_codes = set()
        attr_codes_by_category = defaultdict(set)
        attr_values_by_attr = defaultdict(set)
        cex_skus = set()
        
        for record in batch:
            if 'error' in record:
                continue
            
            # Navigate to boxDetails
            box_details = record.get('response', {}).get('response', {}).get('data', {}).get('boxDetails', [])
            if not box_details:
                continue
            
            box = box_details[0]

            stable_id = record.get('stable_id', '')
            box_name = box.get('boxName', '')
            category_name = box.get('categoryFriendlyName', 'Mobile Phones')
            
            category_names.add(category_name)
            product_name = None
            raw_attrs = box.get('attributeInfo')

            if raw_attrs is None:
                self.stdout.write(
                    self.style.WARNING(
                        f"[attributeInfo NULL] SKU={stable_id}"
                    )
                )
                attributes = []
            else:
                attributes = raw_attrs
                        
            for attr in attributes:
                if attr.get('attributeName', '').lower() == 'phone_modelname':
                    product_name = attr.get('attributeValue')
                    if isinstance(product_name, list):
                        product_name = product_name[0] if product_name else None
                    break
            
            if not product_name:
                product_name = f"Product {stable_id}"
            
            product_names_by_category[category_name].add(product_name)
            condition_code = 'UNKNOWN'
            
            for attr in attributes:
                if attr.get('attributeName', '').lower() == 'grade':
                    grade_val = attr.get('attributeValue')
                    if isinstance(grade_val, list):
                        grade_val = grade_val[0] if grade_val else 'UNKNOWN'
                    condition_code = str(grade_val)
                    break

            condition_codes.add(condition_code)
            cex_skus.add(stable_id)
            
            for attr in attributes:
                attr_name = attr.get('attributeName')
                is_variant = attr.get('isVariant', '0')
                
                # Skip if not a variant attribute
                if is_variant != '1':
                    continue
                
                if not attr_name or attr_name.lower() == 'phone_modelname':
                    continue

                attr_value = attr.get('attributeValue')
                if not attr_value:
                    continue
                attr_codes_by_category[category_name].add(attr_name)
                if isinstance(attr_value, list):
                    attr_value = attr_value[0] if attr_value else ''
                attr_values_by_attr[attr_name].add(str(attr_value))

        # Bulk load categories
        categories = {
            cat.name: cat 
            for cat in ProductCategory.objects.filter(name__in=category_names)
        }
        
        # Bulk load products
        products = {}
        for cat_name, prod_names in product_names_by_category.items():
            if cat_name in categories:
                cat_id = categories[cat_name].category_id
                prods = Product.objects.filter(
                    category_id=cat_id,
                    name__in=prod_names
                )
                for prod in prods:
                    products[(cat_name, prod.name)] = prod
        
        # Bulk load condition grades
        condition_grades = {
            cg.code: cg 
            for cg in ConditionGrade.objects.filter(code__in=condition_codes)
        }
        
        # Bulk load attributes
        attributes = {}
        category_ids = [cat.category_id for cat in categories.values()]
        for attr in Attribute.objects.filter(category_id__in=category_ids):
            key = (attr.category.name, attr.code)
            attributes[key] = attr
        
        # Bulk load attribute values
        attribute_values = {}
        attr_ids = [attr.attribute_id for attr in attributes.values()]
        for av in AttributeValue.objects.filter(attribute_id__in=attr_ids):
            key = (av.attribute.code, av.value)
            attribute_values[key] = av
        
        # Bulk load existing variants
        variants = {
            v.cex_sku: v 
            for v in Variant.objects.filter(cex_sku__in=cex_skus).select_related(
                'product', 'condition_grade'
            )
        }
        
        return {
            'categories': categories,
            'products': products,
            'condition_grades': condition_grades,
            'attributes': attributes,
            'attribute_values': attribute_values,
            'variants': variants,
            'category_names': category_names,
            'product_names_by_category': product_names_by_category,
            'attr_codes_by_category': attr_codes_by_category,
            'attr_values_by_attr': attr_values_by_attr,
        }

    def _parse_record(self, record, lookups):
        if 'error' in record:
            return None

        stable_id = record.get('stable_id')
        
        # Navigate to boxDetails array
        box_details = record.get('response', {}).get('response', {}).get('data', {}).get('boxDetails', [])
        if not box_details:
            return None
        
        # Process first box (could loop through all if needed)
        box = box_details[0]
        
        box_name = box.get('boxName', '')
        sell_price = Decimal(str(box.get('sellPrice', 0)))
        cash_price = Decimal(str(box.get('cashPrice', 0)))
        exchange_price = Decimal(str(box.get('exchangePrice', 0)))
        category_name = box.get('categoryFriendlyName', 'Mobile Phones')
        out_of_stock = bool(box.get('outOfStock', 0))
        last_price_updated = box.get('lastPriceUpdatedDate')
        
        raw_attrs = box.get('attributeInfo')

        if raw_attrs is None:
            self.stdout.write(
                self.style.WARNING(
                    f"[attributeInfo NULL] SKU={stable_id} (parse)"
                )
            )

        attributes = raw_attrs or []

        # Default product name if attribute not found
        # Step 1: extract product name from phone_modelname
        product_name = None
        for attr in attributes:
            if attr.get('attributeName', '').lower() == 'phone_modelname':
                val = attr.get('attributeValue')
                if isinstance(val, list):
                    val = val[0] if val else None
                product_name = str(val).strip()
                break

        # Fallback to boxName if NULL
        if not product_name:
            product_name = f"Product {stable_id}"

        condition_code = 'UNKNOWN'
        parsed_attrs = []
        variant_signature_parts = []

        for attr in attributes:
            attr_name = attr.get('attributeName')
            attr_friendly = attr.get('attributeFriendlyName')
            attr_value = attr.get('attributeValue')
            is_variant = attr.get('isVariant', '0')

            if not attr_name or not attr_value:
                continue

            # Use grade for condition
            if attr_name.lower() == 'grade':
                if isinstance(attr_value, list):
                    attr_value = attr_value[0] if attr_value else 'UNKNOWN'
                condition_code = str(attr_value)

            # Skip non-variant attributes
            if is_variant != '1':
                continue

            if isinstance(attr_value, list):
                attr_value = attr_value[0] if attr_value else ''
            attr_value = str(attr_value)

            # Keep all variant attributes (isVariant=1)
            parsed_attrs.append({
                'code': attr_name,
                'label': attr_friendly or attr_name,
                'value': attr_value,
            })
            variant_signature_parts.append(f"{attr_name}={attr_value}")

        variant_signature_parts.sort()
        variant_signature = '|'.join(variant_signature_parts)

        # Parse the date string to datetime
        price_updated_dt = None
        if last_price_updated:
            from datetime import datetime
            try:
                # Format: "2023-03-16 03:04:14"
                price_updated_dt = datetime.strptime(last_price_updated, '%Y-%m-%d %H:%M:%S')
                # Make it timezone-aware
                from django.utils.timezone import make_aware
                price_updated_dt = make_aware(price_updated_dt)
            except (ValueError, TypeError):
                self.stdout.write(
                    self.style.WARNING(
                        f"[Invalid date] SKU={stable_id}, date={last_price_updated}"
                    )
                )

        return {
            'stable_id': stable_id,
            'box_name': box_name,
            'sell_price': sell_price,
            'cash_price': cash_price,
            'exchange_price': exchange_price,
            'category_name': category_name,
            'product_name': product_name,
            'condition_code': condition_code,
            'attributes': parsed_attrs,
            'variant_signature': variant_signature,
            'out_of_stock': out_of_stock,
            'price_updated_dt': price_updated_dt,
        }

    def _bulk_create_missing_entities(self, parsed_data, lookups, stats):
        """Bulk create all missing categories, products, attributes, and values."""
        
        root = ProductCategory.objects.get(name='Root')
        
        # Bulk create missing categories
        missing_categories = []
        for cat_name in lookups['category_names']:
            if cat_name not in lookups['categories']:
                missing_categories.append(
                    ProductCategory(name=cat_name, parent_category=root)
                )
        
        if missing_categories:
            created = ProductCategory.objects.bulk_create(missing_categories)
            for cat in created:
                lookups['categories'][cat.name] = cat
        
        # Bulk create missing products
        missing_products = []
        for cat_name, prod_names in lookups['product_names_by_category'].items():
            if cat_name in lookups['categories']:
                category = lookups['categories'][cat_name]
                for prod_name in prod_names:
                    if (cat_name, prod_name) not in lookups['products']:
                        missing_products.append(
                            Product(category=category, name=prod_name)
                        )
        
        if missing_products:
            created = Product.objects.bulk_create(missing_products)
            for prod in created:
                lookups['products'][(prod.category.name, prod.name)] = prod
            stats['products_created'] += len(created)
        
        # Bulk create missing attributes
        missing_attributes = []
        for cat_name, attr_codes in lookups['attr_codes_by_category'].items():
            if cat_name in lookups['categories']:
                category = lookups['categories'][cat_name]
                for attr_code in attr_codes:
                    if (cat_name, attr_code) not in lookups['attributes']:
                        # Find label from parsed data
                        label = attr_code
                        for data in parsed_data:
                            if data['category_name'] == cat_name:
                                for attr in data['attributes']:
                                    if attr['code'] == attr_code:
                                        label = attr['label']
                                        break
                        
                        missing_attributes.append(
                            Attribute(category=category, code=attr_code, label=label)
                        )
        
        if missing_attributes:
            created = Attribute.objects.bulk_create(missing_attributes, ignore_conflicts=True)
            # Reload attributes to get IDs
            category_ids = [cat.category_id for cat in lookups['categories'].values()]
            for attr in Attribute.objects.filter(category_id__in=category_ids):
                key = (attr.category.name, attr.code)
                lookups['attributes'][key] = attr
        
        # Bulk create missing attribute values
        missing_attr_values = []
        for attr_code, values in lookups['attr_values_by_attr'].items():
            # Find attribute
            for (cat_name, code), attr in lookups['attributes'].items():
                if code == attr_code:
                    for value in values:
                        if (attr_code, value) not in lookups['attribute_values']:
                            missing_attr_values.append(
                                AttributeValue(attribute=attr, value=value)
                            )
        
        if missing_attr_values:
            created = AttributeValue.objects.bulk_create(missing_attr_values, ignore_conflicts=True)
            # Reload attribute values to get IDs
            attr_ids = [attr.attribute_id for attr in lookups['attributes'].values()]
            for av in AttributeValue.objects.filter(attribute_id__in=attr_ids):
                key = (av.attribute.code, av.value)
                lookups['attribute_values'][key] = av

    def _bulk_upsert_variants(self, parsed_data, lookups, stats):
        """Bulk create/update variants and related data."""
        
        variants_to_create = []
        variants_to_update = []
        variant_attr_values = []
        price_history_entries = []
        now = timezone.now()
        
        for data in parsed_data:
            stable_id = data['stable_id']
            category = lookups['categories'][data['category_name']]
            product = lookups['products'][(data['category_name'], data['product_name'])]
            condition_grade = lookups['condition_grades'].get(data['condition_code'])
            if not condition_grade:
                condition_grade = ConditionGrade.objects.get_or_create(
                    code=data['condition_code']
                )[0]
                lookups['condition_grades'][data['condition_code']] = condition_grade

            sell_price = data['sell_price']
            cash_price = data['cash_price']
            exchange_price = data['exchange_price']
            variant_signature = data['variant_signature']
            out_of_stock = data['out_of_stock']
            price_updated_dt = data['price_updated_dt'] or now
            
            # Check if variant exists
            existing_variant = lookups['variants'].get(stable_id)
            
            if existing_variant:
                # Track if we need to update
                needs_update = False
                
                if existing_variant.current_price_gbp != sell_price:
                    existing_variant.current_price_gbp = sell_price
                    needs_update = True
                    
                    price_history_entries.append(
                        VariantPriceHistory(
                            variant=existing_variant,
                            price_gbp=sell_price,
                            recorded_at=now
                        )
                    )
                    stats['price_changes'] += 1
                
                if existing_variant.tradein_cash != cash_price:
                    existing_variant.tradein_cash = cash_price
                    needs_update = True
                
                if existing_variant.tradein_voucher != exchange_price:
                    existing_variant.tradein_voucher = exchange_price
                    needs_update = True
                
                if existing_variant.cex_out_of_stock != out_of_stock:
                    existing_variant.cex_out_of_stock = out_of_stock
                    needs_update = True
                
                if existing_variant.cex_price_last_updated_date != price_updated_dt:
                    existing_variant.cex_price_last_updated_date = price_updated_dt
                    needs_update = True
                
                if needs_update:
                    variants_to_update.append(existing_variant)
            else:
                # Create new variant
                variant = Variant(
                    product=product,
                    condition_grade=condition_grade,
                    cex_sku=stable_id,
                    current_price_gbp=sell_price,
                    tradein_cash=cash_price,
                    tradein_voucher=exchange_price,
                    variant_signature=variant_signature,
                    title=data['box_name'],
                    cex_out_of_stock=out_of_stock,
                    cex_price_last_updated_date=price_updated_dt
                )
                variants_to_create.append(variant)
                
                # Store attributes for later linking
                variant._pending_attrs = []
                for attr in data['attributes']:
                    attr_key = (attr['code'], attr['value'])
                    if attr_key in lookups['attribute_values']:
                        variant._pending_attrs.append(
                            lookups['attribute_values'][attr_key]
                        )
        
        # Bulk create new variants
        if variants_to_create:
            # Deduplicate by SKU
            unique_variants = {}
            for variant in variants_to_create:
                if variant.cex_sku not in unique_variants:
                    unique_variants[variant.cex_sku] = variant
            variants_to_create = list(unique_variants.values())

            created = Variant.objects.bulk_create(variants_to_create)
            stats['variants_created'] += len(created)

            # Bulk create variant-attribute links
            for variant in created:
                for attr_val in variant._pending_attrs:
                    variant_attr_values.append(
                        VariantAttributeValue(
                            variant=variant,
                            attribute_value=attr_val
                        )
                    )
                
                # Add price history
                price_history_entries.append(
                    VariantPriceHistory(
                        variant=variant,
                        price_gbp=variant.current_price_gbp,
                        recorded_at=now
                    )
                )
                stats['price_changes'] += 1
                
                # Update lookups
                lookups['variants'][variant.cex_sku] = variant
        
        # Bulk update existing variants
        if variants_to_update:
            Variant.objects.bulk_update(
                variants_to_update, 
                ['current_price_gbp', 'tradein_cash', 'tradein_voucher', 'cex_out_of_stock', 'cex_price_last_updated_date'],
                batch_size=1000
            )
            stats['variants_updated'] += len(variants_to_update)
        
        # Bulk create variant attribute values
        if variant_attr_values:
            VariantAttributeValue.objects.bulk_create(
                variant_attr_values,
                ignore_conflicts=True,
                batch_size=1000
            )
        
        # Bulk create price history
        if price_history_entries:
            VariantPriceHistory.objects.bulk_create(
                price_history_entries,
                batch_size=1000
            )

    def _extract_product_name(self, box_name, stable_id):
        """Extract product name from box_name or stable_id."""
        if not box_name:
            return f"Product {stable_id}"
        
        base_name = box_name.split(',')[0].strip()
        parts = base_name.split()
        
        product_parts = []
        for part in parts:
            if any(x in part.upper() for x in ['GB', 'TB']) and any(c.isdigit() for c in part):
                break
            product_parts.append(part)
        
        if product_parts:
            return ' '.join(product_parts)
        
        return base_name

    def _extract_condition_from_boxname(self, box_name):
        """Extract condition grade from box_name."""
        if not box_name:
            return 'UNKNOWN'
        
        parts = box_name.split(',')
        if len(parts) > 1:
            last_part = parts[-1].strip()
            condition = last_part.split()[-1]
            return condition
        
        return 'UNKNOWN'