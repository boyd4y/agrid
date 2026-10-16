UPDATE agent_profile
SET persona = jsonb_set(persona, '{defaultModel}', '"__harness_default__"'::jsonb)
WHERE COALESCE(persona->>'defaultHarness', 'pi') = 'pi'
  AND persona->>'defaultModel' IN ('openrouter/free', 'openrouter/auto');
