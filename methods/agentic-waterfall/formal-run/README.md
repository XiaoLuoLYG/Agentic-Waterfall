# Isolated formal-run scheduler

These scripts are a snapshot of the scheduler used for the 2026-10-29 isolated run. Copy them into the `formal/` directory of an independently prepared experiment checkout: their paths assume that directory is directly under the experiment root. They are not a standalone setup: they require frozen preflight manifests, experiment plans, datasets, indexes, weights, an independent model control and ledger, and the provider config through `MODEL_CONFIG_FILE`. No credentials, model outputs, user data, datasets, or weights belong in this directory.

- `run_fixed.py --workers 1`: MIND and KuaiRand fixed-candidate methods.
- `plan_additional.py` and `run_agents.py`: AgentRecBench, SimBench and KuaiRec agent queues.
- `run_local.py`: SimBench and KuaiRec fixed BM25/BGE baselines.
- `gpu_lock.py`: cross-process lock for BGE inference shared by RecBot and fixed retrieval.

The scheduler preserves each attempt and resumes completed cases without recomputing them. Model or formatting failures are retained and retried once, with the queue stopping if they recur; infrastructure failures stop after three attempts, and SimBench subsequent events are blocked if the preceding event failed. A graceful SIGTERM stops scheduling and waits for the active case. Restart only one instance of each queue, and keep the per-run model ledger and output paths separate from all other runs. Inputs and weights may be shared by read-only convention; symlinks alone do not enforce read-only access. The queues produce predictions, logs and receipts; they do not automatically freeze predictions, run judges, or score results.

For KuaiRand i²Agent the fixed-candidate runner passes the task protocol’s 8192-token output limit. The 2026-10-29 run initially used 4096, then retained all earlier attempts and reran the entire affected method cohort under 8192 before any score inspection. The runner expects the isolated ClawRec and generic-agent `runs/` directories to exist.

Local fixed retrieval pauses 15 seconds between completed cases (reduced from20seconds on2026-10-30 at the user's request). It keeps the shared single-inference lock and reduced OS CPU priority. This changes scheduling only, not ranking or inputs.

Output reliability amendment: KuaiRand i²Agent requests one compact explanation while preserving its complete ranking. Both SimBench agent methods use a concise-state request and an 8192-token state limit. The run archive records the amended sources and reruns all previously produced outputs for the affected methods.
