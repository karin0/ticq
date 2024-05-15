# ticq

A minimal [Telegraf](https://github.com/telegraf/telegraf) adapter that behaves like [oicq](https://oicqjs.github.io/oicq/index.html)/[icqq](https://github.com/icqqjs/icqq) but drives a Telegram bot.

This is indented for use in [Miao-Yunzai](https://github.com/yoimiya-kokomi/Miao-Yunzai), and only the minimal features are implemented to be compatible with it. Credit goes to the original authors of all these projects.

## Usage

In a pnpm-managed project with `icqq` as its dependency:

```console
$ pnpm link <path-to-ticq>
```

In case `oicq` is depended on instead, modify the `"name"` in ticq's `package.json` to `oicq`.

ticq expects `TICQ_BOT_TOKEN` to be set in the environment. Optionally, the following variables are also available:

- `TICQ_PROXY`
- `TICQ_ALLOWED_CHATS`

## License

MPL-2.0
