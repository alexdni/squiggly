-- Label EO/EC recordings that were uploaded unlabelled although their filename names the condition
-- (e.g. '…AGE 35 EC.edf', '…AGE47EC.edf', 'EC_.edf', 'Eyes_Closed_…'). Same rule as
-- conditionFromFilename in lib/eeg-condition.ts, which the upload route now uses: an EO/EC (or
-- "eyes open/closed") token with no letter either side, extension excluded; names with both
-- tokens, or none, are left for the analyst to label. Whole file = that condition.
-- Supersedes fix_eo_ec_recordings.sql, whose word-boundary match missed '45EC' and 'EC_'.
-- Applied 2026-10-25. Existing analyses of these recordings keep their results; the app reads
-- results filed under the other condition under the recording's own (lib/server/relabel.ts) and
-- the analysis view offers a re-run.

with base as (
  select id, regexp_replace(filename, '\.[^.[:space:]]{1,5}$', '') as b
  from recordings
  where eo_start is null and ec_start is null and duration_seconds is not null
), hit as (
  select id,
    b ~* '(^|[^a-z])(eo|eyes[[:space:]_-]?open)($|[^a-z])' as eo,
    b ~* '(^|[^a-z])(ec|eyes[[:space:]_-]?closed)($|[^a-z])' as ec
  from base
)
update recordings r
set
  eo_start = case when h.eo then 0 end,
  eo_end = case when h.eo then r.duration_seconds end,
  eo_label = case when h.eo then 'EO' end,
  ec_start = case when h.ec then 0 end,
  ec_end = case when h.ec then r.duration_seconds end,
  ec_label = case when h.ec then 'EC' end,
  condition_type = case when h.eo then 'EO' else 'EC' end
from hit h
where r.id = h.id and (h.eo <> h.ec);

-- condition_type follows the segments (older scripts set segments without it)
update recordings
set condition_type = case
  when eo_start is not null and ec_start is null then 'EO'
  when ec_start is not null and eo_start is null then 'EC'
  else 'BOTH' end
where condition_type is distinct from case
  when eo_start is not null and ec_start is null then 'EO'
  when ec_start is not null and eo_start is null then 'EC'
  else 'BOTH' end;
