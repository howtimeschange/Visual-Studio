-- Runs use the existing durable jobs/items/credential contract.
CREATE INDEX IF NOT EXISTS idx_canvas_agent_jobs_project
ON jobs(json_extract(config_json, '$.inputProjectId'), created_at)
WHERE type = 'canvas_agent';
