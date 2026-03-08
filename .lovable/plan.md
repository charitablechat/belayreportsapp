

## Diagnosis: All Database Triggers Are Missing

### What happened

Your migrations historically created triggers across multiple migration files. However, the current database state shows **zero triggers**. This is not caused by any migration in the codebase — none of the recent migrations drop notification triggers.

The most likely cause is a platform-level database restore or schema reset that replayed the `CREATE OR REPLACE FUNCTION` statements (which is why all your trigger *functions* still exist) but failed to replay the `CREATE TRIGGER` statements. This can happen when migrations are re-applied in a way that skips idempotent trigger creation.

### What's broken

Every trigger is gone — not just notification ones. This includes:
- Notification triggers (push + email for inspections, trainings, daily assessments, sync conflicts)
- Audit triggers (inspection completion audit, user role change audit, notification send audit)
- Utility triggers (auto-link organization, updated_at management, inspector_id protection, profile name history)

### Fix: One migration to recreate all triggers

A single migration will recreate every trigger that was originally defined across the migration history. Using `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` for safety.

**Triggers to restore (14 total):**

| Trigger | Table | Function |
|---------|-------|----------|
| `update_inspections_updated_at` | inspections | `update_updated_at_column()` |
| `update_trainings_updated_at` | trainings | `update_updated_at_column()` |
| `update_daily_assessments_updated_at` | daily_assessments | `update_updated_at_column()` |
| `trigger_auto_link_organization` | inspections | `auto_link_organization()` |
| `prevent_inspector_id_change_inspections` | inspections | `prevent_inspector_id_change()` |
| `prevent_inspector_id_change_trainings` | trainings | `prevent_inspector_id_change()` |
| `prevent_inspector_id_change_daily_assessments` | daily_assessments | `prevent_inspector_id_change()` |
| `on_inspection_completed` | inspections | `notify_super_admins_inspection_completed()` |
| `on_inspection_completed_email` | inspections | `notify_super_admins_inspection_email()` |
| `on_training_completed` | trainings | `notify_super_admins_training_completed()` |
| `on_training_completed_email` | trainings | `notify_super_admins_training_email()` |
| `on_daily_assessment_completed` | daily_assessments | `notify_super_admins_daily_assessment_completed()` |
| `on_daily_assessment_completed_email` | daily_assessments | `notify_super_admins_daily_assessment_email()` |
| `trigger_sync_conflict` | sync_conflicts | `notify_super_admins_sync_conflict()` |

Plus the audit triggers:
| `audit_inspection_completion_trigger` | inspections | `audit_inspection_completion()` |
| `audit_user_role_changes_trigger` | user_roles | `audit_user_role_changes()` |
| `audit_notification_send_trigger` | notifications_log | `audit_notification_send()` |
| `add_name_to_history_trigger` | profiles | `add_name_to_field_history()` |

No code file changes needed — only the database migration.

