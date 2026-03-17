from django.db import migrations, models


def consolidate_duplicate_rules(apps, schema_editor):
    """
    Before dropping movement_class we may have up to 3 rows per scope
    (one per FAST/MEDIUM/SLOW). Keep the FAST rule if present, otherwise
    the first row ordered by movement_class, and delete the rest.
    """
    PricingRule = apps.get_model('pricing', 'PricingRule')

    def keep_one(qs):
        rules = list(qs.order_by('movement_class'))
        if len(rules) <= 1:
            return
        fast = next((r for r in rules if r.movement_class == 'FAST'), None)
        keep = fast or rules[0]
        for r in rules:
            if r.pk != keep.pk:
                r.delete()

    # Global defaults
    keep_one(PricingRule.objects.filter(is_global_default=True))

    # Per-category
    for cat_id in PricingRule.objects.filter(
        category__isnull=False
    ).values_list('category_id', flat=True).distinct():
        keep_one(PricingRule.objects.filter(category_id=cat_id))

    # Per-product
    for prod_id in PricingRule.objects.filter(
        product__isnull=False
    ).values_list('product_id', flat=True).distinct():
        keep_one(PricingRule.objects.filter(product_id=prod_id))


class Migration(migrations.Migration):

    dependencies = [
        ('pricing', '0028_pricingrule_first_offer_pct_of_cex'),
    ]

    operations = [
        # 1. Deduplicate rows that differ only by movement_class
        migrations.RunPython(consolidate_duplicate_rules, migrations.RunPython.noop),

        # 2. Drop the old movement-class-aware unique constraints
        migrations.RemoveConstraint(model_name='pricingrule', name='uniq_product_movement_rule'),
        migrations.RemoveConstraint(model_name='pricingrule', name='uniq_category_movement_rule'),
        migrations.RemoveConstraint(model_name='pricingrule', name='uniq_global_default_movement_rule'),

        # 3. Drop the old indexes that included movement_class
        migrations.RemoveIndex(model_name='pricingrule', name='pricing_rul_product_0efe47_idx'),
        migrations.RemoveIndex(model_name='pricingrule', name='pricing_rul_categor_04488e_idx'),
        migrations.RemoveIndex(model_name='pricingrule', name='pricing_rul_is_glob_9bd63d_idx'),

        # 4. Drop the movement_class column
        migrations.RemoveField(model_name='pricingrule', name='movement_class'),

        # 5. Add new per-scope unique constraints
        migrations.AddConstraint(
            model_name='pricingrule',
            constraint=models.UniqueConstraint(
                condition=models.Q(product__isnull=False),
                fields=['product'],
                name='uniq_product_rule',
            ),
        ),
        migrations.AddConstraint(
            model_name='pricingrule',
            constraint=models.UniqueConstraint(
                condition=models.Q(category__isnull=False),
                fields=['category'],
                name='uniq_category_rule',
            ),
        ),
        migrations.AddConstraint(
            model_name='pricingrule',
            constraint=models.UniqueConstraint(
                condition=models.Q(is_global_default=True),
                fields=['is_global_default'],
                name='uniq_global_default_rule',
            ),
        ),
    ]
