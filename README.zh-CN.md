# dsh-llm-newapi

为 [DeepSeek Harness（dsh）](https://github.com/deepseek-ai/deepseek-harness) 添加 NewAPI 网关和 DeepSeek 官方直连支持。插件包含宿主适配器和 Web 设置页，无需修改 dsh 核心。

[English](README.md) | **中文**

## 功能

- 多网关配置，每组可独立选择接口协议、模型和密钥。
- 支持 OpenAI Chat Completions（`POST /chat/completions`）、Responses API（`POST /responses`）和 Claude Messages（`POST /messages`）。
- Claude Messages 使用 `x-api-key` 与 `anthropic-version` 鉴权头，并支持流式响应和工具调用。
- 设置页提供可编辑的 curl 示例。修改后点击“应用到网关配置”，插件会解析 URL、协议、模型、密钥和 token 上限并保存；只解析受支持的 curl 参数，不会执行命令。
- 可从网关获取模型；支持模型参数信息和代理配置。
- 可按网关组切换 DeepSeek 官方直连模式，密钥与网关密钥分开保存。

## 安装与配置

将插件安装到 dsh 的 `web` profile，并在插件设置中添加网关。网关地址填写 API 前缀，例如 `https://api.example.com/v1`；选择对应接口类型，设置密钥并获取或添加模型。保存后即可在模型选择器中使用。

也可以在插件配置中定义网关组：

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

密钥在 Web 设置页保存至 dsh credentials，不要写入配置文件。`baseURL` 不包含具体接口路径；插件会按接口类型追加 `/chat/completions`、`/responses` 或 `/messages`。

## 开发

```sh
npm install
npm run build
npm test
```

构建会更新 `lib/`。提交源码改动时也要提交构建产物。

更多设计背景见 [DESIGN.md](DESIGN.md)。
