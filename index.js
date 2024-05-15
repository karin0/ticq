import log4js from 'log4js'
import { segment } from 'icqq'
import { EventEmitter } from 'events'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { Telegraf, Input } from 'telegraf'
import { message } from 'telegraf/filters'

const log = log4js.getLogger('ticq')

if (process.env.NODE_ENV === 'development') {
  log.level = 'debug'
}

const allowed_chats = undefined

if (process.env.TICQ_ALLOWED_CHATS) {
  const allowed_chats = process.env.TICQ_ALLOWED_CHATS.split(',').map(Number)
  log.info('Allowed chats:', allowed_chats)
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
    this.bot = new Telegraf(
      process.env.TICQ_BOT_TOKEN,
      proxy
        ? {
            telegram: {
              agent: new HttpsProxyAgent(proxy),
            },
          }
        : undefined,
    )
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
        if (f instanceof Buffer) images.push(Input.fromBuffer(f))
        else if (f.startsWith('http:')) images.push(Input.fromURL(f))
        else
          images.push(
            Input.fromLocalFile(f.startsWith('file://') ? f.slice(7) : f),
          )
      } else if (m.type === 'at') texts.push('@' + m.text)
      else texts.push(JSON.stringify(m))
    }

    if (Array.isArray(msg)) msg.forEach(push)
    else push(msg)

    const tg = this.bot.telegram
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

    const opts = {
      reply_to_message_id: ctx.message.message_id,
      message_id: ctx.message.message_id,
    }
    const sender = {
      user_id: ctx.from.id,
      nickname: ctx.from.username,
    }
    const { text } = ctx.message
    const e = {
      post_type: 'message',
      message_type: 'group',
      sub_type: 'normal',
      message: [{ type: 'text', text }],
      from_id: ctx.from.id,
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

    bot.on(message('text'), this._on_msg)

    bot.launch(() => {
      log.info('Bot started')
      this.emit('system.online')
    })

    process.once('SIGINT', () => bot.stop('SIGINT'))
    process.once('SIGTERM', () => bot.stop('SIGTERM'))
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
