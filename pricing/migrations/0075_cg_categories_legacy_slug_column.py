# Align cg_categories with CGCategory model if an older 0074 created `slug` without category_path.

from django.db import migrations


def forwards(apps, schema_editor):
    conn = schema_editor.connection
    with conn.cursor() as cursor:
        if conn.vendor == 'sqlite':
            cursor.execute("PRAGMA table_info(cg_categories)")
            col_names = [r[1] for r in cursor.fetchall()]
            if not col_names:
                return
            if 'slug' in col_names and 'collection_slug' not in col_names:
                cursor.execute('ALTER TABLE cg_categories RENAME COLUMN slug TO collection_slug')
            if 'category_path' not in col_names:
                cursor.execute(
                    "ALTER TABLE cg_categories ADD COLUMN category_path varchar(1024) NOT NULL DEFAULT ''"
                )
            return
        if conn.vendor == 'postgresql':
            cursor.execute(
                """
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = 'cg_categories'
                """
            )
            col_names = {r[0] for r in cursor.fetchall()}
            if not col_names:
                return
            if 'slug' in col_names and 'collection_slug' not in col_names:
                cursor.execute('ALTER TABLE cg_categories RENAME COLUMN slug TO collection_slug')
            if 'category_path' not in col_names:
                cursor.execute(
                    "ALTER TABLE cg_categories ADD COLUMN category_path varchar(1024) NOT NULL DEFAULT ''"
                )


class Migration(migrations.Migration):

    dependencies = [
        ('pricing', '0074_cg_categories'),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
