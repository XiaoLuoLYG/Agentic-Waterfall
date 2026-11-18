"""Keep operational interruptions separate from model output failures."""
OPERATIONAL=('budget_exhausted','model_calls_not_enabled','model_slots_busy','model_timeout','model_transport_error','model_http_','runner_before_result','snapshot search failed','local_inference_failed','interrupted before result was committed')
def operational_failure(result):return any(code in str(result.get('error','')) for code in OPERATIONAL)
