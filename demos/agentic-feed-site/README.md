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

The local server binds to loopback. The hosted app uses the Cloudflare Worker, D1 and R2. See [hosted setup](WATERFALL.md) for the hosting-specific environment. Keep model keys and real account exports outside Git.
