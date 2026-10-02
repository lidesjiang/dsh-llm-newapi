# dsh-llm-newapi

Adds a NewAPI gateway plugin to [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness), connecting services compatible with OpenAI or Anthropic APIs.

[English](README.md) | [中文](README.zh-CN.md)

## Features

- Configure multiple gateways, each with its own protocol, models, and credentials.
- Supports OpenAI Chat Completions (`POST /chat/completions`), Responses API (`POST /responses`), and Claude Messages (`POST /messages`).
- Claude Messages uses `x-api-key` and `anthropic-version` headers, with streaming and tool-call support.
- The Web settings page includes an editable curl example. Choose **Apply to gateway settings** to parse and save its URL, protocol, model, API key, and token limit. Only supported curl options are parsed; the command is never executed.
- Discover models from a gateway; configure model parameters and a proxy.

## Install and configure

Install the plugin into the dsh `web` profile, then add a gateway in the plugin settings. Enter the API base URL, such as `https://api.example.com/v1`, select the protocol, configure a key, and fetch or add models. Save the settings and select a model in the composer.

Legacy DeepSeek direct-mode settings no longer call the official API. Configure a gateway URL and protocol, then enter its API key in the settings page.

A gateway can also be configured in the plugin config:

```yaml
- id: llm-newapi
  name: dsh-llm-newapi
  config:
    groups:
      - id: ginka
        name: Ginka
        baseURL: https://api.ginka.cloud/v1
        apiType: messages # chat | responses | messages
        models:
          - id: your-model-id
```

Save API keys in the Web settings page, where they are stored in dsh credentials. Do not put keys in the config file. `baseURL` is the API prefix; the plugin appends `/chat/completions`, `/responses`, or `/messages` according to the selected protocol.

## Development

```sh
npm install
npm run build
npm test
```

The build updates `lib/`. Commit generated artifacts together with source changes.

See [DESIGN.md](DESIGN.md) for design details.
