import nodeFetch from 'node-fetch'
import log4js from 'log4js'
import { segment } from 'icqq'
import { EventEmitter } from 'events'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { Bot, InputFile } from 'grammy'
import { setDefaultResultOrder } from 'node:dns'

setDefaultResultOrder('ipv4first')

const log = log4js.getLogger('ticq')

if (process.env.NODE_ENV === 'development') {
  log.level = 'debug'
}

let allowed_chats = undefined

if (process.env.TICQ_ALLOWED_CHATS) {
  allowed_chats = process.env.TICQ_ALLOWED_CHATS.split(',').map(Number)
  log.info('Allowed chats:', allowed_chats)
}

let relay_allowed_ids = undefined
if (process.env.TICQ_RELAY_ALLOWED_IDS) {
  relay_allowed_ids = process.env.TICQ_RELAY_ALLOWED_IDS.split(',').map(Number)
  log.info('Relay allowed ids:', relay_allowed_ids)
}

class FriendMap {
  get(user_id) {
    return { user_id }
  }
}

class User {
  constructor(user_id, client) {
    this.user_id = user_id
    this.client = client
  }

  sendMsg(msg) {
    log.debug('User', this.user_id, 'send message:', msg)
    return this.client._send(this.user_id, msg)
  }
}

class Client extends EventEmitter {
  constructor() {
    super()
    log.debug('Client created:', arguments)
    const proxy =
      process.env.TICQ_PROXY ||
      process.env.HTTPS_PROXY ||
      process.env.HTTP_PROXY
    const apiRoot = process.env.TICQ_API_ROOT
    const agent = proxy
      ? new HttpsProxyAgent(proxy, {
          timeout: 30000,
          autoSelectFamily: false,
        })
      : undefined

    this.bot = new Bot(process.env.TICQ_BOT_TOKEN, {
      client: {
        apiRoot,
        fetch: proxy
          ? (url, options) => {
              options.agent = agent
              return nodeFetch(url, options)
            }
          : undefined,
      },
    })
    this.fl = new FriendMap()
    this.uin = 1234567890
  }

  async _send(chat_id, msg, opts) {
    log.debug('Send to', chat_id, ':', msg, opts)

    const texts = []
    const images = []

    function push(m) {
      if (typeof m === 'string') texts.push(m)
      else if (m.type === 'text') texts.push(m.text)
      else if (m.type === 'image') {
        const f = m.file
        if (f instanceof Buffer) images.push(new InputFile(f, 'image.jpg'))
        else if (f.startsWith('http:')) images.push(new InputFile({ url: f }))
        else {
          const filePath = f.startsWith('file://') ? f.slice(7) : f
          images.push(new InputFile(filePath))
        }
      } else if (m.type === 'at') texts.push('@' + m.text)
      else texts.push(JSON.stringify(m))
    }

    if (Array.isArray(msg)) msg.forEach(push)
    else push(msg)

    const tg = this.bot.api
    const text = texts.join('')
    if (images.length > 0) {
      await tg.sendPhoto(chat_id, images[0], { caption: text, ...opts })
      for (let i = 1; i < images.length; i++)
        await tg.sendPhoto(chat_id, images[i], opts)
    } else await tg.sendMessage(chat_id, text, opts)
  }

  async _on_msg(ctx) {
    const chat_id = ctx.chat.id

    if (allowed_chats && !allowed_chats.includes(chat_id)) {
      log.warn('Bad chat:', ctx)
      return
    }
    let msg = ctx.message
    log.debug('Msg:', msg, ctx.from)

    const opts = {
      reply_to_message_id: msg.message_id,
      message_id: msg.message_id,
    }

    let { text } = msg
    if (
      relay_allowed_ids &&
      msg.reply_to_message &&
      relay_allowed_ids.includes(msg.from.id) &&
      text.startsWith('/relay')
    ) {
      msg = msg.reply_to_message
      text = text.slice(6).trim()
      if (!text.length) text = msg.text
      log.debug('Relay msg:', text)
    }

    const sender = {
      user_id: msg.from.id,
      nickname: msg.from.username,
    }
    const e = {
      post_type: 'message',
      message_type: 'group',
      sub_type: 'normal',
      message: [{ type: 'text', text }],
      from_id: msg.from.id,
      text,
      sender,
      ...sender,
      reply: msg => this._send(chat_id, msg, opts),
    }
    const { type } = ctx.chat
    if (type === 'group' || type === 'supergroup') {
      e.message_type = 'group'
      e.sub_type = 'normal'
      e.group_id = chat_id
      e.group_name = ctx.chat.title
    } else if (type == 'private') {
      e.message_type = 'private'
      e.sub_type = 'friend'
    }
    log.debug('Emitting message:', e)
    this.emit('message', e)
  }

  async login() {
    log.info('Client logged in')
    const bot = this.bot

    bot.on('message:text', ctx => this._on_msg(ctx))

    bot
      .start({
        onStart: botInfo => {
          log.info(`Bot started as ${botInfo.username}`)
          this.emit('system.online')
        },
      })
      .catch(err => {
        log.error('Bot polling error:', err)
      })

    // A signal listener keeps Node from exiting, and the host's other handles
    // keep the process alive, so the signal is raised again once the listener
    // is gone.
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () =>
        bot.stop().finally(() => process.kill(process.pid, signal)),
      )
    }
  }

  on(event, callback) {
    log.debug('Client event:', event, callback)
    super.on(event, callback)
    return this
  }

  pickUser(user_id) {
    return new User(user_id, this)
  }
}

export { Client, segment }
