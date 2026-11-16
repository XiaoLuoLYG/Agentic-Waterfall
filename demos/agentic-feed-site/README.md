# Waterfall demo

Use Node.js 22.13 or newer. From this directory, run `npm run demo`. You can also run `node scripts/local-demo.mjs` without installing npm dependencies. Open `http://127.0.0.1:4196`.

With a sample catalog, you can create a local account, scroll the feed, give it a new instruction, and open the decision trace. The app stores sample data in `.sites-runtime/local-demo-sample`. Set `LOCAL_DEMO_DATA_DIR` to use a different directory. Set `LOCAL_DEMO_PORT` if port 4196 is in use.

## Use a model

Save a private JSON file outside the repo with these fields. Use your provider's chat completions URL and model name.

```json
{
  "apiBase": "https://your-provider.example/v1/chat/completions",
  "modelName": "your-model"
}
```

Set `WATERFALL_API_KEY` in your shell, then point the demo at your file.

```sh
MODEL_CONFIG_FILE="$HOME/waterfall-model.json" node scripts/local-demo.mjs
```

The demo reads content provider settings from `providers` and `runtime.waterfall` in that file. Real source calls use the services you configure. Model runs use a separate SQLite directory at `../local-demo-data` by default.

Sample and model runs must use separate data directories. If a custom directory already has sessions from the other mode, startup stops and asks you to choose another directory. Existing records stay intact.

## Run the research panel

The research panel uses a separate process for the comparison methods. First prepare the [Python environments, author sources, and weights](../../docs/reproduce.md#run-a-new-waterfall-dataset-comparison). From this directory, start the service in one terminal:

```sh
export RESEARCH_TOKEN="$(openssl rand -hex 32)"
OPENAI_API_KEY="$WATERFALL_API_KEY" \
MODEL_CONFIG_FILE="$HOME/waterfall-model.json" \
WATERFALL_RESEARCH_ROOT="$PWD/../../methods/agentic-waterfall" \
RESEARCH_DATA_DIR="$HOME/waterfall-research-data" \
node scripts/research-service.mjs
```

In a second terminal, set `RESEARCH_BACKEND_TOKEN` to the same token, then run:

```sh
MODEL_CONFIG_FILE="$HOME/waterfall-model.json" \
RESEARCH_BACKEND_URL=http://127.0.0.1:4192 \
node scripts/local-demo.mjs
```

The service keeps its jobs and full method records in `RESEARCH_DATA_DIR`. The demo stores accounts, sessions, and export files in its own data directory. Research runs call the configured model and content sources. The sample catalog works without this service.

The local server binds to loopback. The hosted app uses the Cloudflare Worker, D1 and R2. See [hosted setup](WATERFALL.md) for the hosting-specific environment. Keep model keys and real account exports outside Git.
