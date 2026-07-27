-- Relax `project` from a fixed enum to any non-empty label.
--
-- 001 originally pinned the column to a CHECK list, which meant adding a new
-- project needed a schema change, and the list itself disclosed who was being
-- monitored. Existing rows stay valid: this only widens what is accepted.

alter table ops.agents
  drop constraint if exists agents_project_check;

alter table ops.agents
  add constraint agents_project_check check (project <> '');
