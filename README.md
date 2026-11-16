# Agentic Waterfall

Tell the feed, "I already bought the camera. Show me how to film from the sidelines." Waterfall uses the request, recent browsing, and what it knows about you to decide what to search for, what to move up in the feed, and what to remember.

[Waterfall Dataset](https://github.com/XiaoLuoLYG/agentic-waterfall-dataset) · [Results and replay](docs/reproduce.md)

![The Waterfall agent looks up filming tips, updates the feed, and keeps the user's camera in mind.](docs/assets/waterfall-method.png)

## Run the demo

Use Node.js 22.13 or newer.

```sh
git clone https://github.com/XiaoLuoLYG/waterfall-anything.git
cd waterfall-anything
node demos/agentic-feed-site/scripts/local-demo.mjs
```

Open `http://127.0.0.1:4196`. Make a local account, choose an interest, and browse the feed. Give the feed a new instruction and open the trace to see the next decision. The sample catalog runs without API keys. It uses scripted decisions so you can try the feed and the same action runtime locally.

To use your own model and content providers, see the [demo setup](demos/agentic-feed-site/README.md).

## Run the core

```sh
node examples/run-core.mjs
```

The example searches two sample cards and recommends the one about filming. It prints the IDs and action receipts so you can see what the runtime did. The browser demo and benchmark runners load the same [Waterfall core](demos/agentic-feed-site/lib/waterfall/waterfall-core.mjs).

## Reproduce the paper results

Start with the [replay guide](docs/reproduce.md). It links the frozen rankings and labels used to recompute scores, the public datasets, and the commands to run the benchmark adapters.

![The replay protocol freezes a browsing history and asks each system for a ranking at the same checkpoint.](docs/assets/waterfall-dataset.png)

`demos/` has the browser app and core. `experiments/` prepares inputs and runs evaluations. `methods/` has the baselines, including RecAgent's MIND-small adapter. `docs/` has results and setup instructions.
